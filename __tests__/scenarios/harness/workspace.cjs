/**
 * @file Scratch application workspace — a throw-away app that installs scribbles by symlink
 *
 * Domain context
 * --------------
 * User-story scenarios need a real application directory: its own files, its own
 * `node_modules/scribbles`, run from its own working directory, as a developer's project
 * would be. This helper builds one under the OS temp directory (never inside a git
 * checkout, which several stories rely on) and removes it afterwards.
 *
 * Technical context
 * -----------------
 * - `node_modules/scribbles` is a symlink to the repo root, so bare specifiers such as
 *   `scribbles` and `scribbles/register` resolve through the package `exports` map exactly
 *   as an installed package would, while the source files stay the repo's own (so nyc
 *   attributes subprocess coverage to them).
 * - The directory is resolved with `realpathSync` because the OS temp directory is itself a
 *   symlink on macOS and the runtimes report real paths in stack frames and `require.main`.
 * - The `.cjs` extension keeps this helper out of Jest's test discovery.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Create a workspace containing the given files plus a `node_modules/scribbles` link.
 *
 * @param {Object<string,string>} files - relative path -> file contents (parents are created)
 * @returns {{ dir: string, cleanup: function(): void }} the real path and its remover
 */
function makeWorkspace(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-ws-')));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.symlinkSync(REPO_ROOT, path.join(dir, 'node_modules', 'scribbles'), 'dir');
  Object.keys(files).forEach((relative) => {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, files[relative]);
  });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { makeWorkspace, REPO_ROOT };
