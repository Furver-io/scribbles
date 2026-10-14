/**
 * @file Scenario: an app bundled with `bun build` still runs and keeps variable names
 *
 * Domain context
 * --------------
 * A team ships its service as one file produced by `Bun.build(...)`. The bundle must
 * start (scribbles' ESM entry may not rely on a runtime `require` of a file the
 * bundler cannot see) and, when the team adds the `scribbles/bun-plugin` build plugin,
 * the log lines in the bundle keep their variable names (`userName:alice`) because the
 * plugin rewrites call sites at bundle time.
 *
 * Technical context
 * -----------------
 * - Needs the `bun` binary; the suite skips itself when Bun is not installed.
 * - The app lives in a scratch workspace whose `node_modules/scribbles` symlinks back
 *   to the repo, so bare specifiers resolve through the package `exports` map exactly
 *   as an installed package would.
 * - Uses the built `dist/scribbles.js` (`npm test` builds it first via `pretest`).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runScenario, hasBinary } = require('./harness/spawn.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const describeBun = hasBinary('bun') ? describe : describe.skip;

const APP = [
  "import scribbles, { config } from 'scribbles';",
  "config({ mode: 'dev', logLevel: 'debug', colors: false, format: '{message} {value}',",
  "  stdOut: (line) => process.stdout.write(line + '\\n'), dataOut: null });",
  "const userName = 'alice';",
  "scribbles.log('user', userName);",
  ''
].join('\n');

/**
 * Build the app with `Bun.build` and run the produced bundle.
 *
 * @param {string} workspace - scratch directory with the app and `node_modules/scribbles`
 * @param {boolean} withPlugin - whether the build uses `scribbles/bun-plugin`
 * @returns {{ build: Object, run: Object }} results of the build and run steps
 */
function buildAndRun(workspace, withPlugin) {
  const script = [
    withPlugin ? "import scribblesPlugin from 'scribbles/bun-plugin';" : '',
    "const result = await Bun.build({ entrypoints: ['./app.mjs'], outdir: './out', target: 'bun',",
    `  plugins: [${withPlugin ? 'scribblesPlugin()' : ''}] });`,
    'if (!result.success) { console.error(result.logs.join("\\n")); process.exit(1); }',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(workspace, 'build.mjs'), script);
  const build = runScenario({ runtime: 'bun', entry: path.join(workspace, 'build.mjs'), cwd: workspace });
  const run = runScenario({ runtime: 'bun', entry: path.join(workspace, 'out', 'app.js'), cwd: workspace });
  return { build, run };
}

describeBun('Scenario: Bun — app bundled with `bun build`', () => {
  let workspace;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-bun-build-'));
    fs.mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
    fs.symlinkSync(REPO_ROOT, path.join(workspace, 'node_modules', 'scribbles'), 'dir');
    fs.writeFileSync(path.join(workspace, 'app.mjs'), APP);
  });

  afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

  it('starts and logs from a plain bundle (no plugin)', () => {
    const { build, run } = buildAndRun(workspace, false);

    expect(build.status).toBe(0);
    expect(run.stderr).not.toMatch(/Cannot find module/);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('user alice');
  });

  it('keeps variable names in the bundle when the scribbles bun plugin is used', () => {
    const { build, run } = buildAndRun(workspace, true);

    expect(build.stderr).toBe('');
    expect(build.status).toBe(0);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('user userName:alice');
  });
});
