/**
 * @file Long-running child process that a story edits files under (hot reload, watch mode)
 *
 * Domain context
 * --------------
 * `bun --hot` and `bun --watch` never exit by themselves: a developer edits a file and
 * expects the running process to show the change. A story therefore starts the process,
 * waits until it has printed something, edits a file, and waits for the new output.
 *
 * Technical context
 * -----------------
 * - Output is polled rather than awaited by event so a story reads as "wait until stdout
 *   contains X"; the wait fails with the output seen so far, which is the diagnosis a failing
 *   story needs.
 * - The child is stopped through its own handle (`child.kill()`), never by process name.
 * - The `.cjs` extension keeps this helper out of Jest's test discovery.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Start a long-running runtime process and expose its output.
 *
 * @param {string} runtime - binary, e.g. `bun`
 * @param {string[]} args - full argument list
 * @param {string} cwd - working directory
 * @param {Object<string,string>} [env] - extra environment; `TMPDIR` defaults to a folder inside `cwd`
 *        so files the process leaves in its temp directory go away with the workspace
 * @returns {{ output: function(): string, until: function(RegExp, number=): Promise<string>, stop: function(): void }}
 */
function startLive(runtime, args, cwd, env = {}) {
  const tmp = path.join(cwd, '.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const child = spawn(runtime, args, {
    cwd, env: Object.assign({}, process.env, { TMPDIR: tmp }, env), stdio: ['ignore', 'pipe', 'pipe']
  });
  let seen = '';
  child.stdout.on('data', (chunk) => { seen += chunk; });
  child.stderr.on('data', (chunk) => { seen += chunk; });
  return {
    output: () => seen,
    until(pattern, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      return new Promise((resolve, reject) => {
        const poll = () => {
          if (pattern.test(seen)) return resolve(seen);
          if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${pattern}; output so far:\n${seen}`));
          return setTimeout(poll, 50);
        };
        poll();
      });
    },
    stop() { child.kill(); }
  };
}

module.exports = { startLive };
