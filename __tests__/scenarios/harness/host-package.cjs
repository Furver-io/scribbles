/**
 * @file Boot scribbles in a child process as if a host project had a package.json
 *
 * Domain context
 * --------------
 * `index.js` reads the host project's `scribbles` block from
 * `__dirname + '/../../package.json'` — in an installed package that is the app's own
 * package.json. Scenarios that prove this need a host package.json to exist.
 *
 * Technical context
 * -----------------
 * - Earlier scenarios planted a real file at that shared path outside the repo. Jest runs
 *   test files in parallel workers, so any worker booting scribbles while the file existed
 *   read it too and failed at random, and two scenarios planting it at once skipped
 *   silently. This helper never touches the filesystem: a preload in a fresh `node`
 *   child answers the two reads `index.js` makes (the existence probe and the `require`)
 *   with the synthetic package.json.
 * - The child loads the repo's real `index.js`, so coverage of it is attributed normally
 *   when the suite runs under nyc.
 * - The `.cjs` extension keeps this helper out of Jest's test discovery.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_INDEX = path.resolve(__dirname, '..', '..', '..', 'index.js');
const HOST_PACKAGE_PATH = path.normalize(path.dirname(REPO_INDEX) + '/../../package.json');

/**
 * Preload source: makes `HOST_PACKAGE_PATH` appear to exist with the synthetic body.
 *
 * @returns {string} CommonJS source for `node --require`
 */
function preloadSource() {
  return `
    const fs = require('fs');
    const Module = require('module');
    const target = process.env.SCRIBBLES_HOST_PACKAGE_PATH;
    const body = JSON.parse(process.env.SCRIBBLES_HOST_PACKAGE_JSON);
    const exists = fs.existsSync;
    fs.existsSync = (p) => (path_(p) === target ? true : exists(p));
    function path_(p) { return require('path').normalize(String(p)); }
    const load = Module._load;
    Module._load = function (request, parent, ...rest) {
      if (parent && parent.filename === process.env.SCRIBBLES_INDEX && path_(request) === target) {
        return body;
      }
      return load.call(this, request, parent, ...rest);
    };
  `;
}

/**
 * Run `probe` in a fresh node process after booting scribbles under a synthetic host package.json.
 *
 * @param {Object} hostPackage - JSON body the host project's package.json should have.
 * @param {string} probe - Script body; `scribbles` is the loaded module. Must print one JSON line.
 * @returns {{ status: number, stderr: string, result: * }} parsed JSON line printed by the probe
 */
function bootWithHostPackage(hostPackage, probe) {
  const script = `const scribbles = require(${JSON.stringify(REPO_INDEX)});\n${probe}`;
  const run = spawnSync(process.execPath, ['-e', preloadSource() + script], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      SCRIBBLES_HOST_PACKAGE_PATH: HOST_PACKAGE_PATH,
      SCRIBBLES_HOST_PACKAGE_JSON: JSON.stringify(hostPackage),
      SCRIBBLES_INDEX: REPO_INDEX
    })
  });
  const lastLine = (run.stdout || '').trim().split('\n').pop();
  let result;
  try { result = JSON.parse(lastLine); } catch (_) { result = undefined; }
  return { status: run.status, stderr: run.stderr, result };
}

module.exports = { bootWithHostPackage };
