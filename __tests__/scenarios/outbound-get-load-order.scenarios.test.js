/**
 * @file Scenarios: load order and module systems for outgoing `get` / `request`
 *
 * Domain: the ReadMe promises that with `headers` configured scribbles injects
 * the trace into outgoing http calls. Which function a service ends up calling
 * depends on how it imported `http`: an ES module's `import { get } from
 * 'node:http'` must be traced when scribbles was imported first, while a
 * function copied out of `http` BEFORE scribbles loaded (`const { request } =
 * require('http')` above `require('scribbles')`) is the native function and
 * cannot be reached. The ReadMe documents that limit and the last story pins it.
 *
 * Technical: each story runs a fresh Node child through the scenario harness
 * (load order is only observable in a clean process), serves a local
 * `http.createServer` on port 0 inside the child, and asserts on the headers
 * the server received. Lives under `scenarios/` so the child's coverage is
 * merged by `npm run test:full-coverage`.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScenario } = require('./harness/spawn.cjs');

const TRACEPARENT = /^00-order-61-[0-9a-f]+-01$/;

describe('Scenario: load order and module systems (fresh process)', () => {
  const INDEX = path.resolve(__dirname, '..', '..', 'index.js');
  const INDEX_MJS = path.resolve(__dirname, '..', '..', 'index.mjs');

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
