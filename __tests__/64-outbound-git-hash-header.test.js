/**
 * @file Scenarios: the `x-git-hash` header on outgoing requests
 *
 * Domain: a service is deployed from a build without a `.git` folder (a
 * Docker image, a CI artifact) so scribbles cannot learn the commit it runs.
 * It still calls other services inside a trace and expects those calls to
 * succeed. When a bundler did inject the commit through
 * `__scribbles_gitStatus__`, downstream services expect to see it.
 *
 * Technical: git information is read once when scribbles loads, so every
 * story boots scribbles in a fresh Node process whose working directory is an
 * empty temp folder. The child serves a local `http.createServer` on port 0,
 * makes one real `http.request` inside a trace and prints the headers the
 * server actually received. The tests assert only on that printed output.
 * Nothing is required from scribbles' private modules.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScenario } = require('./scenarios/harness/spawn.cjs');

const INDEX = path.resolve(__dirname, '..', 'index.js');

/**
 * Boots scribbles in a fresh process with no git repository around it, calls
 * a local server from inside a trace and reports what the server received.
 *
 * @param {Object} [injectedGit] - value for `__scribbles_gitStatus__`, the
 *        documented fallback bundlers use when `.git` is absent
 * @returns {{status: number, stderr: string, received: Object}} child exit
 *          status, its stderr and the headers the server saw
 */
function callFromBuildWithoutGit(injectedGit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-nogit-'));
  const entry = path.join(dir, 'entry.js');
  fs.writeFileSync(entry, `
    ${injectedGit ? `globalThis.__scribbles_gitStatus__ = ${JSON.stringify(injectedGit)};` : ''}
    const http = require('http');
    const scribbles = require(${JSON.stringify(INDEX)});
    scribbles.config({ stdOut: null, dataOut: null, vendor: 'acme', headers: ['x-request-id'] });
    const server = http.createServer((req, res) => {
      res.end(JSON.stringify(req.headers));
    });
    server.listen(0, () => {
      scribbles.trace({ traceId: 'order-1234' }, () => {
        http.request({ port: server.address().port, host: '127.0.0.1' }, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => { console.log('RECEIVED=' + body); server.close(); });
        }).end();
      });
    });
  `);
  const result = runScenario({ runtime: 'node', entry, cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  const line = result.stdout.split('\n').find((l) => l.startsWith('RECEIVED='));
  return {
    status: result.status,
    stderr: result.stderr,
    received: line ? JSON.parse(line.slice('RECEIVED='.length)) : null
  };
}

describe('Scenario: outgoing calls from a build that has no git information', () => {
  it('a service deployed without a .git folder still reaches downstream services with its trace id', () => {
    const run = callFromBuildWithoutGit();

    expect(run.stderr).not.toMatch(/Invalid value "undefined" for header/);
    expect(run.status).toBe(0);
    expect(run.received.traceparent).toMatch(/^00-order-1234-[0-9a-f]+-01$/);
  });

  it('the request does not claim a commit when the build has none', () => {
    const run = callFromBuildWithoutGit();

    expect(run.received).not.toBeNull();
    expect(run.received).not.toHaveProperty('x-git-hash');
  });

  it('a bundler that injects the commit gets it forwarded as x-git-hash', () => {
    const run = callFromBuildWithoutGit({ hash: 'build42', repo: 'shop', branch: 'main' });

    expect(run.status).toBe(0);
    expect(run.received['x-git-hash']).toBe('build42');
  });
});
