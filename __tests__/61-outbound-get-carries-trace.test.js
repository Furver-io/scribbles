/**
 * @file Scenarios: `http.get`, `https.get` and named imports carry the trace
 *
 * Domain: a service traces an incoming request and calls other services with
 * the conveniences Node offers: `http.get(url, cb)`, `https.get(url, cb)`, or
 * a destructured `const { get } = require('http')`. The ReadMe promises that
 * with `headers` configured scribbles injects the trace into outgoing http and
 * https calls, so each of these must reach the downstream service carrying
 * the same trace id as the request being handled.
 *
 * Known limit, pinned by the last stories: a function copied out of `http`
 * BEFORE scribbles loads (`const { request } = require('http')` above
 * `require('scribbles')`) is the native function and cannot be reached.
 *
 * Technical: loads scribbles once through `require('../index')` and calls a
 * REAL local `http.createServer` / `https.createServer` on port 0, asserting
 * on the headers the server received. The https server uses a throwaway
 * certificate made with `openssl` at test time (nothing secret is committed).
 * The ordering stories need a process where scribbles loads second, so they
 * run a fresh Node child through the scenario harness. Config is restored
 * afterwards so later test files in the same worker are unaffected.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runScenario } = require('./scenarios/harness/spawn.cjs');
const scribbles = require('../index');

const TRACEPARENT = /^00-order-61-[0-9a-f]+-01$/;

/**
 * Makes a throwaway self-signed certificate for 127.0.0.1.
 *
 * @returns {{key: string, cert: string}} PEM key and certificate
 */
function makeCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-tls-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')
  ], { stdio: 'ignore' });
  const pems = {
    key: fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'),
    cert: fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8')
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return pems;
}

describe('Scenario: a traced service calls out with get()', () => {
  let httpServer;
  let httpsServer;
  let httpBase;
  let httpsBase;
  let landed;
  let landedResolve;

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {void}
   */
  const handle = (req, res) => {
    landedResolve({ method: req.method, url: req.url, headers: req.headers });
    res.end('ok');
  };

  beforeAll((done) => {
    httpServer = http.createServer(handle);
    httpsServer = https.createServer(makeCertificate(), handle);
    httpServer.listen(0, () => {
      httpBase = `http://127.0.0.1:${httpServer.address().port}`;
      httpsServer.listen(0, () => {
        httpsBase = `https://127.0.0.1:${httpsServer.address().port}`;
        done();
      });
    });
  });

  afterAll((done) => {
    scribbles.config({ headers: null, headersMapping: undefined });
    httpServer.close(() => httpsServer.close(done));
  });

  beforeEach(() => {
    landed = new Promise((resolve) => { landedResolve = resolve; });
    scribbles.config({
      stdOut: null,
      dataOut: null,
      vendor: 'acme',
      headers: ['x-request-id'],
      headersMapping: undefined
    });
  });

  /**
   * Starts a trace with a known id, runs `call` inside it and resolves with
   * what the server saw. Responses are drained, so `get(url)` with no callback
   * needs no special handling.
   *
   * @param {function(): http.ClientRequest} call - issues the request
   * @returns {Promise<{method: string, url: string, headers: Object}>}
   */
  const inTrace = (call) => new Promise((resolve, reject) => {
    scribbles.trace({ traceId: 'order-61' }, () => {
      const req = call();
      req.on('response', (res) => res.resume());
      req.on('error', reject);
      landed.then(resolve);
    });
  });

  it('a service traces an incoming request and its outgoing http.get carries the same trace id', async () => {
    const got = await inTrace(() => http.get(`${httpBase}/plain`, (res) => res.resume()));

    expect(got.method).toBe('GET');
    expect(got.url).toBe('/plain');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
    expect(got.headers.tracestate).toMatch(/^acme=/);
  });

  it('http.get(url) with no callback is traced too', async () => {
    const got = await inTrace(() => http.get(`${httpBase}/no-callback`));

    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('http.get(options, callback) keeps the developer headers and adds the trace', async () => {
    const got = await inTrace(() => http.get({
      host: '127.0.0.1',
      port: httpServer.address().port,
      path: '/options',
      headers: { authorization: 'Bearer get' }
    }, (res) => res.resume()));

    expect(got.url).toBe('/options');
    expect(got.headers.authorization).toBe('Bearer get');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('https.get carries the trace to an https service', async () => {
    const got = await inTrace(() => https.get(
      `${httpsBase}/secure`, { rejectUnauthorized: false }, (res) => res.resume()));

    expect(got.url).toBe('/secure');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('https.request carries the trace to an https service', async () => {
    const got = await inTrace(() => {
      const req = https.request(`${httpsBase}/secure-request`, { rejectUnauthorized: false });
      req.end();
      return req;
    });

    expect(got.url).toBe('/secure-request');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('a get destructured from http after scribbles loaded is traced', async () => {
    const { get } = require('http');

    const got = await inTrace(() => get(`${httpBase}/destructured`, (res) => res.resume()));

    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('a request destructured from http after scribbles loaded is traced', async () => {
    const { request } = require('http');

    const got = await inTrace(() => {
      const req = request(`${httpBase}/destructured-request`);
      req.end();
      return req;
    });

    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });
});

describe('Scenario: load order and module systems (fresh process)', () => {
  const INDEX = path.resolve(__dirname, '..', 'index.js');
  const INDEX_MJS = path.resolve(__dirname, '..', 'index.mjs');

  /**
   * Runs `source` as a script in a fresh Node process, with a local server
   * that prints the headers it receives, and returns those headers.
   *
   * @param {string} name - script file name (`.js` or `.mjs` picks the module system)
   * @param {string} source - script body; calls `serve(port => ...)`-style helpers defined here
   * @returns {{status: number, stderr: string, received: (Object|null)}}
   */
  function runChild(name, source) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-order-'));
    const entry = path.join(dir, name);
    fs.writeFileSync(entry, source);
    const result = runScenario({ runtime: 'node', entry, cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    const line = result.stdout.split('\n').find((l) => l.startsWith('RECEIVED='));
    return {
      status: result.status,
      stderr: result.stderr,
      received: line ? JSON.parse(line.slice('RECEIVED='.length)) : null
    };
  }

  it('an ES module that imports { get } from node:http after scribbles is traced', () => {
    const run = runChild('entry.mjs', `
      import { config, trace } from ${JSON.stringify(INDEX_MJS)};
      import { createServer, get } from 'node:http';
      config({ stdOut: null, dataOut: null, vendor: 'acme', headers: ['x-request-id'] });
      const server = createServer((req, res) => { res.end(JSON.stringify(req.headers)); });
      server.listen(0, () => {
        trace({ traceId: 'order-61' }, () => {
          get({ host: '127.0.0.1', port: server.address().port }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => { console.log('RECEIVED=' + body); server.close(); });
          });
        });
      });
    `);

    expect(run.status).toBe(0);
    expect(run.received.traceparent).toMatch(TRACEPARENT);
  });

  it('documented limit: a request function copied out of http before scribbles loads is not traced', () => {
    const run = runChild('entry.js', `
      const http = require('http');
      const { request } = http;
      const scribbles = require(${JSON.stringify(INDEX)});
      scribbles.config({ stdOut: null, dataOut: null, vendor: 'acme', headers: ['x-request-id'] });
      const server = http.createServer((req, res) => { res.end(JSON.stringify(req.headers)); });
      server.listen(0, () => {
        scribbles.trace({ traceId: 'order-61' }, () => {
          request({ host: '127.0.0.1', port: server.address().port }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => { console.log('RECEIVED=' + body); server.close(); });
          }).end();
        });
      });
    `);

    expect(run.status).toBe(0);
    expect(run.received).not.toBeNull();
    expect(run.received).not.toHaveProperty('traceparent');
  });
});
