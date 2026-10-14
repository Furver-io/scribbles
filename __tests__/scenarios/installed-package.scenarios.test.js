/**
 * @file Scenario: scribbles installed under node_modules reports the user's call site
 *
 * Domain context
 * --------------
 * Real applications consume scribbles from `node_modules/scribbles`. When a developer
 * hands `scribbles.log` to a native callback (`forEach`, a promise handler) the
 * immediate caller is a native frame, so scribbles walks the stack for the first frame
 * that belongs to the user's code. Scribbles' own frames live under
 * `node_modules/scribbles/` and must be skipped, otherwise every such line would claim
 * to come from scribbles' internals.
 *
 * Technical context
 * -----------------
 * - The package files are copied (not symlinked) into a scratch `node_modules/scribbles`
 *   so the stack paths look exactly like an installed package. A symlink would be
 *   resolved to the repo path by Node and hide the layout under test.
 * - The scratch copy runs outside the repo, so this proof is behavioural only; the stack
 *   walker's installed-layout skips are marked in `src/utils/helpers.js` for that reason.
 * - Dependencies are shared through a `node_modules` symlink inside the copy.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const PACKAGE_ENTRIES = ['index.js', 'appDir.js', 'gitStatus.js', 'package.json', 'src'];

describe('Scenario: installed package (node_modules/scribbles)', () => {
  let workspace;
  let installed;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-installed-'));
    installed = path.join(workspace, 'node_modules', 'scribbles');
    fs.mkdirSync(installed, { recursive: true });
    PACKAGE_ENTRIES.forEach((entry) => {
      fs.cpSync(path.join(REPO, entry), path.join(installed, entry), { recursive: true });
    });
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(installed, 'node_modules'), 'dir');
    fs.writeFileSync(path.join(workspace, 'app.js'), [
      `const scribbles = require(${JSON.stringify(path.join(installed, 'index.js'))});`,
      "scribbles.config({ mode: 'dev', logLevel: 'debug', colors: false,",
      "  format: '{fileName}:{lineNumber} {message}',",
      '  stdOut: (line) => process.stdout.write(line + "\\n"), dataOut: null });',
      "['from-callback'].forEach(scribbles.log);",
      "scribbles.log('direct');",
      ''
    ].join('\n'));
  });

  afterAll(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

  it('names the app file and line when log is handed to forEach', () => {
    const result = spawnSync('node', [path.join(workspace, 'app.js')], {
      cwd: workspace, encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    const [callback, direct] = result.stdout.trim().split('\n');
    expect(callback).toBe('app.js:5 from-callback');
    expect(direct).toMatch(/^app\.js:\d+ direct$/);
  });

  it('still prints the message when no user file can be named (node -e)', () => {
    const script = [
      `const scribbles = require(${JSON.stringify(path.join(installed, 'index.js'))});`,
      "scribbles.config({ mode: 'dev', logLevel: 'debug', colors: false,",
      "  format: '{message}', stdOut: (line) => process.stdout.write(line + '\\n'), dataOut: null });",
      "['from-eval'].forEach(scribbles.log);"
    ].join('\n');
    const result = spawnSync('node', ['-e', script], { cwd: workspace, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('from-eval');
  });
});
