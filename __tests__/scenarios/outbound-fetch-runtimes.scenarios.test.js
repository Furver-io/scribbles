/**
 * @file Scenarios: outgoing `fetch` on runtimes that differ from the Jest process
 *
 * Domain: scribbles patches the global `fetch` when it loads. A runtime with no
 * global fetch (Node 16 and older) must still boot and keep tracing its `http`
 * calls, and on Bun the wrapped `fetch` must carry the trace and keep Bun's own
 * `fetch.preconnect`.
 *
 * Technical: each story runs a fresh child through the scenario harness: it
 * boots scribbles through the same entry users get from `require('scribbles')`,
 * serves a local `http.createServer` on port 0, calls it inside a trace and
 * prints what the server received. Lives under `scenarios/` so the child's
 * coverage is merged by `npm run test:full-coverage`. The Bun story is skipped
 * where Bun is not installed.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScenario, hasBinary } = require('./harness/spawn.cjs');

const TRACEPARENT = /^00-order-60-[0-9a-f]+-01$/;

describe('Scenario: fetch in a fresh process', () => {
  const INDEX = path.resolve(__dirname, '..', '..', 'index.js');

  /**
   * Runs a script in a fresh process: boots scribbles, serves a local port,
   * calls it with fetch inside a trace and prints what the server received
   * and a few facts about `fetch`.
   *
   * @param {'node'|'bun'} runtime - runtime to start
   * @param {string} beforeBoot - code to run before scribbles loads
   * @returns {{status: number, stderr: string, report: (Object|null)}}
   */
  function runChild(runtime, beforeBoot) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-fetch-'));
    const entry = path.join(dir, 'entry.js');
    fs.writeFileSync(entry, `
      ${beforeBoot}
      const http = require('http');
      const scribbles = require(${JSON.stringify(INDEX)});
      scribbles.config({ stdOut: null, dataOut: null, vendor: 'acme', headers: ['x-request-id'] });
      const server = http.createServer((req, res) => { res.end(JSON.stringify(req.headers)); });
      server.listen(0, () => {
        const url = 'http://127.0.0.1:' + server.address().port;
        scribbles.trace({ traceId: 'order-60' }, () => {
          const call = typeof fetch === 'function'
            ? fetch(url).then((res) => res.json())
            : new Promise((resolve) => http.get(url, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => resolve(JSON.parse(body)));
              }));
          call.then((received) => {
            console.log('REPORT=' + JSON.stringify({
              received,
              hasFetch: typeof fetch === 'function',
              hasPreconnect: typeof (typeof fetch === 'function' && fetch.preconnect) === 'function'
            }));
            server.close();
          });
        });
      });
    `);
    const result = runScenario({ runtime, entry, cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    const line = result.stdout.split('\n').find((l) => l.startsWith('REPORT='));
    return {
      status: result.status,
      stderr: result.stderr,
      report: line ? JSON.parse(line.slice('REPORT='.length)) : null
    };
  }

  it('a runtime without a global fetch still boots and traces its http calls', () => {
    const run = runChild('node', 'delete globalThis.fetch;');

    expect(run.status).toBe(0);
    expect(run.report.hasFetch).toBe(false);
    expect(run.report.received.traceparent).toMatch(TRACEPARENT);
  });

  const itBun = hasBinary('bun') ? it : it.skip;

  itBun('on Bun, fetch carries the trace and keeps fetch.preconnect', () => {
    const run = runChild('bun', '');

    expect(run.status).toBe(0);
    expect(run.report.hasFetch).toBe(true);
    expect(run.report.received.traceparent).toMatch(TRACEPARENT);
    expect(run.report.hasPreconnect).toBe(true);
  });
});
