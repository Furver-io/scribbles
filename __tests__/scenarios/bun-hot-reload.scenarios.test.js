/**
 * @file Scenarios: `bun --hot` and `bun --watch` pick up edits to files that log
 *
 * Domain context
 * --------------
 * A developer runs the service with `bun --hot server.ts` (or `--watch`) and edits a module
 * that calls `scribbles.log(...)`. The change must show up in the running process. Before
 * 2.1.1 it did not: scribbles rewrites those modules itself (variable names), and a module
 * Bun receives from a plugin or from a CommonJS extension hook is not on Bun's list of files
 * to watch, so the edit was silently ignored until the process was restarted by hand.
 * Modules that never log were never affected.
 *
 * Technical context
 * -----------------
 * - Needs the `bun` binary; the suite skips itself when Bun is not installed.
 * - Each story starts the real process (see `harness/live.cjs`), waits for its first line,
 *   rewrites a module on disk, and waits for the line that proves the new code ran. A story
 *   fails by timeout with the output so far.
 * - Stories cover both ways scribbles rewrites code under Bun: the ES-module preload plugin
 *   (`.mjs`, `.ts`) and the CommonJS extension hook (`.js` required after scribbles).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { hasBinary } = require('./harness/spawn.cjs');
const { startLive } = require('./harness/live.cjs');
const { makeWorkspace } = require('./harness/workspace.cjs');

const describeBun = hasBinary('bun') ? describe : describe.skip;

const CONFIG = "config({ colors: false, logLevel: 'info', dataOut: null, format: '{fileName} {message} {value}', stdOut: (line) => console.log(line) });";

const ESM_FILES = {
  'main.mjs': `import { config } from 'scribbles';\n${CONFIG}\nawait import('./lib.mjs');\nsetInterval(() => {}, 1e6);\n`,
  'lib.mjs': "import scribbles from 'scribbles';\nconst version = 1;\nscribbles.log('lib', version);\n"
};

const CJS_FILES = {
  'main.js': "const scribbles = require('scribbles');\n"
    + "scribbles.config({ colors: false, logLevel: 'info', dataOut: null, format: '{fileName} {message} {value}', stdOut: (line) => console.log(line) });\n"
    + "require('./lib.js');\nsetInterval(() => {}, 1e6);\n",
  'lib.js': "const scribbles = require('scribbles');\nconst version = 1;\nscribbles.log('lib', version);\n"
};

/**
 * Edit `file` in `dir` so its `version` constant becomes 2.
 *
 * @param {string} dir - workspace directory
 * @param {string} file - file name to edit
 * @param {number} from - the version number currently in the file
 * @param {number} to - the version number to write
 */
function editVersion(dir, file, from, to) {
  const target = path.join(dir, file);
  const edited = fs.readFileSync(target, 'utf8').replace(`version = ${from}`, `version = ${to}`);
  // Like an editor that saves in place: empty the file, then write it (two change events).
  fs.truncateSync(target);
  fs.writeFileSync(target, edited);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const countOf = (text, pattern) => text.split('\n').filter((line) => pattern.test(line)).length;

/**
 * Assert that one edit led to a bounded, finished burst of reloads: a save that empties the file
 * and then writes it is two change events, so a busy machine may show two reloads; a loop would
 * keep counting. Compares the count after a settle period with the count two seconds later.
 *
 * @param {{ output: function(): string }} live - the running process
 * @param {RegExp} pattern - the line each reload prints
 */
async function expectBoundedReloads(live, pattern) {
  await pause(2500);
  const settled = countOf(live.output(), pattern);
  await pause(2000);

  expect(settled).toBeGreaterThanOrEqual(1);
  expect(settled).toBeLessThanOrEqual(2);
  expect(countOf(live.output(), pattern)).toBe(settled);
}

describeBun.each([
  ['bun --hot with the scribbles preload, ES modules', ['--hot', '--preload', 'scribbles/register'], ESM_FILES, 'main.mjs', 'lib.mjs'],
  ['bun --watch with the scribbles preload, ES modules', ['--watch', '--preload', 'scribbles/register'], ESM_FILES, 'main.mjs', 'lib.mjs'],
  ['bun --hot, CommonJS modules', ['--hot'], CJS_FILES, 'main.js', 'lib.js'],
  ['bun --hot with the scribbles preload, CommonJS modules', ['--hot', '--preload', 'scribbles/register'], CJS_FILES, 'main.js', 'lib.js']
])('Scenario: %s', (name, args, files, entry, edited) => {
  let ws;
  let live;
  beforeEach(() => { ws = makeWorkspace(files); });
  afterEach(() => { if (live) live.stop(); ws.cleanup(); });

  it('shows the new code, with its variable name, after the developer edits a logging module', async () => {
    live = startLive('bun', [...args, entry], ws.dir);
    await live.until(/lib version:1/);

    editVersion(ws.dir, edited, 1, 2);
    await live.until(/lib version:2/);
    editVersion(ws.dir, edited, 2, 3);
    await live.until(/lib version:3/);
  }, 30000);

  it('reloads for an edit and then stops, not in a loop', async () => {
    live = startLive('bun', [...args, entry], ws.dir);
    await live.until(/lib version:1/);

    editVersion(ws.dir, edited, 1, 2);
    await live.until(/lib version:2/);
    await expectBoundedReloads(live, /lib version:2/);
  }, 30000);
});

describeBun('Scenario: bun --hot where the temp directory is awkward', () => {
  let ws;
  let live;
  beforeEach(() => { ws = makeWorkspace(CJS_FILES); });
  afterEach(() => { if (live) live.stop(); ws.cleanup(); });

  it('stops reloading after an edit when the temp directory is a symlink (as /var is on macOS)', async () => {
    fs.mkdirSync(path.join(ws.dir, 'real-tmp'));
    fs.symlinkSync(path.join(ws.dir, 'real-tmp'), path.join(ws.dir, 'linked-tmp'));
    live = startLive('bun', ['--hot', 'main.js'], ws.dir, { TMPDIR: path.join(ws.dir, 'linked-tmp') });
    await live.until(/lib version:1/);

    editVersion(ws.dir, 'lib.js', 1, 2);
    await live.until(/lib version:2/);
    await expectBoundedReloads(live, /lib version:2/);
  }, 30000);

  it('starts and logs normally, with one line of explanation, when the temp directory is not a directory', async () => {
    fs.writeFileSync(path.join(ws.dir, 'blocker'), '');
    live = startLive('bun', ['--hot', 'main.js'], ws.dir, { TMPDIR: path.join(ws.dir, 'blocker') });

    await live.until(/lib version:1/);
    await live.until(/scribbles: hot reload is off/);

    expect(countOf(live.output(), /hot reload is off/)).toBe(1);
  }, 30000);
});
