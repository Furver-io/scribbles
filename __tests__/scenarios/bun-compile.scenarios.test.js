/**
 * @file Scenarios: a single-file executable made with `bun build --compile`
 *
 * Domain context
 * --------------
 * A team ships its service as one executable (`Bun.build({ compile: ... })`). Inside it there
 * are no source files and no preload, so scribbles cannot learn variable names or file names
 * at run time. Adding the `scribbles/bun-plugin` build plugin makes the build do that work:
 * the executable then prints `worker.mjs:5  total:6` (the file relative to the project, the
 * variable name next to its value) exactly as `bun run` does. Without the plugin the
 * executable still logs, but the file name is the name of the bundle and variable names are
 * missing; the docs say to use the plugin.
 *
 * Technical context
 * -----------------
 * - Needs the `bun` binary; the suite skips itself when Bun is not installed.
 * - The build runs with the project folder as its working directory, which is the folder the
 *   plugin names files against by default. The executable then runs from an unrelated
 *   directory so nothing it prints can depend on where it is started.
 * - Uses the built `dist/scribbles.js` (`npm run build` first).
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { runScenario, hasBinary } = require('./harness/spawn.cjs');
const { makeWorkspace } = require('./harness/workspace.cjs');

const describeBun = hasBinary('bun') ? describe : describe.skip;

const FILES = {
  'app.mjs': [
    "import scribbles, { config, trace } from 'scribbles';",
    "import { handleOrder } from './src/worker.mjs';",
    "config({ colors: false, logLevel: 'info', dataOut: null,",
    "  format: '{spanLabel} {fileName}:{lineNumber} {message} {value}',",
    "  stdOut: (line) => process.stdout.write(line + '\\n') });",
    "await trace('checkout', async () => {",
    '  await null;',
    '  const r = await handleOrder(2);',
    "  scribbles.log('done', r);",
    '});',
    ''
  ].join('\n'),
  'src/worker.mjs': [
    "import scribbles from 'scribbles';",
    'export async function handleOrder(qty) {',
    '  await new Promise((resolve) => setTimeout(resolve, 2));',
    '  const total = qty * 3;',
    '  scribbles.info(total);',
    '  return total;',
    '}',
    ''
  ].join('\n'),
  'build.mjs': [
    "import scribblesPlugin from 'scribbles/bun-plugin';",
    "const withPlugin = process.env.WITH_SCRIBBLES_PLUGIN === '1';",
    "const result = await Bun.build({ entrypoints: ['./app.mjs'], compile: { outfile: './service' },",
    '  plugins: withPlugin ? [scribblesPlugin()] : [] });',
    'if (!result.success) { console.error(result.logs.join("\\n")); process.exit(1); }',
    ''
  ].join('\n')
};

/**
 * Build the executable in `dir` and run it from `runFrom`.
 *
 * @param {string} dir - project folder (build working directory)
 * @param {boolean} withPlugin - whether the build uses the scribbles plugin
 * @param {string} runFrom - working directory of the executable
 * @returns {{ build: Object, run: Object }} results of the build and run steps
 */
function buildAndRun(dir, withPlugin, runFrom) {
  const build = runScenario({
    runtime: 'bun',
    entry: path.join(dir, 'build.mjs'),
    cwd: dir,
    env: { WITH_SCRIBBLES_PLUGIN: withPlugin ? '1' : '0' },
    timeoutMs: 120000
  });
  const executed = spawnSync(path.join(dir, 'service'), [], { cwd: runFrom, encoding: 'utf8', timeout: 20000 });
  return { build, run: { status: executed.status, stdout: executed.stdout, stderr: executed.stderr } };
}

describeBun('Scenario: bun build --compile executable', () => {
  let ws;
  let elsewhere;
  beforeEach(() => {
    ws = makeWorkspace(FILES);
    elsewhere = makeWorkspace({});
  });
  afterEach(() => { ws.cleanup(); elsewhere.cleanup(); });

  it('with the scribbles plugin the executable names files and variables like bun run', () => {
    const { build, run } = buildAndRun(ws.dir, true, elsewhere.dir);

    expect(build.status).toBe(0);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout.trim().split('\n').map((line) => line.replace(/ [0-9a-f]{32}$/, '')))
      .toEqual(['checkout src/worker.mjs:5  total:6', 'checkout app.mjs:9 done r:6']);
  });

  it('without the plugin it still logs, but names the bundle and no variables', () => {
    const { build, run } = buildAndRun(ws.dir, false, elsewhere.dir);

    expect(build.status).toBe(0);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('done 6');
    expect(run.stdout).not.toContain('r:6');
    expect(run.stdout).not.toContain('worker.mjs');
  });
});
