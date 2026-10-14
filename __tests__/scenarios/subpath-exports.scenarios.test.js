/**
 * @file Scenario: tooling imports scribbles' source transform through the package exports map
 *
 * Domain context
 * --------------
 * Build tooling (a custom bundler plugin, a test-runner preload) needs the same call-site
 * rewrite scribbles applies at run time. `scribbles/transform` is the supported way to
 * reach `transformSource` without poking at the package's internal file layout.
 *
 * Technical context
 * -----------------
 * - A scratch workspace symlinks `node_modules/scribbles` to the repo so the bare
 *   specifier resolves through `package.json` `exports` as for an installed package.
 * - Both module systems are exercised in fresh `node` processes.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runScenario } = require('./harness/spawn.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = "scribbles.log('user', userName);";

describe('Scenario: scribbles/transform subpath export', () => {
  let workspace;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-subpath-'));
    fs.mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
    fs.symlinkSync(REPO_ROOT, path.join(workspace, 'node_modules', 'scribbles'), 'dir');
    fs.writeFileSync(path.join(workspace, 'esm.mjs'), [
      "import { transformSource } from 'scribbles/transform';",
      `console.log(transformSource(${JSON.stringify(SOURCE)}, '/app/main.js'));`,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(workspace, 'cjs.cjs'), [
      "const { transformSource } = require('scribbles/transform');",
      `console.log(transformSource(${JSON.stringify(SOURCE)}, '/app/main.js'));`,
      ''
    ].join('\n'));
  });

  afterAll(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

  it.each(['esm.mjs', 'cjs.cjs'])('a build tool can import transformSource from %s', (entry) => {
    const result = runScenario({ runtime: 'node', entry: path.join(workspace, entry), cwd: workspace });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('scribbles.log.at({file:"');
    expect(result.stdout).toContain("'user', userName);");
  });
});
