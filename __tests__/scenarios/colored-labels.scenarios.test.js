/**
 * @file Scenario: a colored terminal shows the variable name beside each value
 *
 * Domain context
 * --------------
 * A developer runs their app in a real terminal (colors on) and writes
 * `scribbles.log('user', userName)`. Scribbles reads the call site, learns the
 * argument is called `userName`, and prints `userName:` in front of the value, in
 * its own color, before the value itself.
 *
 * Technical context
 * -----------------
 * - Needs a fresh `node` process: variable names come from the source transform
 *   installed while scribbles loads, which Jest's module system bypasses.
 * - The app turns `colors` on explicitly, as a developer at a terminal would.
 * - The app is written into a scratch directory so the scenario owns its source;
 *   it requires the repo's `index.js` exactly as `require('scribbles')` would.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runScenario } = require('./harness/spawn.cjs');

const REPO_INDEX = path.resolve(__dirname, '..', '..', 'index.js');
const ESC = String.fromCharCode(27);
const SGR = new RegExp(ESC + '\\[[0-9;]*m', 'g');

describe('Scenario: colored terminal prints variable names beside values', () => {
  let workspace;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-colored-labels-'));
    fs.writeFileSync(path.join(workspace, 'entry.js'), [
      `require(${JSON.stringify(REPO_INDEX)});`,
      "require('./app.js')();",
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(workspace, 'app.js'), [
      `const scribbles = require(${JSON.stringify(REPO_INDEX)});`,
      'module.exports = function run() {',
      "  scribbles.config({ mode: 'dev', logLevel: 'debug', colors: true, format: '{message} {value}',",
      '    stdOut: (line) => process.stdout.write(line + "\\n"), dataOut: null });',
      "  const userName = 'alice';",
      '  const attempts = 3;',
      '  scribbles.log("login", userName);',
      '  scribbles.log("retries", attempts);',
      '};',
      ''
    ].join('\n'));
  });

  afterAll(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

  it('prints each variable name in front of its value, in color', () => {
    const result = runScenario({
      runtime: 'node',
      entry: path.join(workspace, 'entry.js'),
      cwd: workspace
    });

    expect(result.status).toBe(0);
    const [first, second] = result.stdout.trim().split('\n');
    expect(first.replace(SGR, '')).toBe('login userName:alice');
    expect(second.replace(SGR, '')).toBe('retries attempts:3');
    expect(first).toContain(ESC + '[');
    expect(first).toMatch(new RegExp(ESC + '\\[[0-9;]+muserName' + ESC + '\\[39m'));
  });
});
