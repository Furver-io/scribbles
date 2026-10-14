/**
 * @file Turns an absolute source file name into the `file` text scribbles prints
 *
 * Domain context
 * --------------
 * A log line names the file it came from. Inside the application that is the path relative
 * to the app root (`lib/worker.js`), so lines read the same on every machine. A file outside
 * the app (a shared library in a sibling folder, a linked package) is named by its absolute
 * path, because a relative path full of `..` says nothing useful.
 *
 * Technical context
 * -----------------
 * - Uses `path.relative` so only real containment counts: `/work/app-shared/x.js` is NOT
 *   inside `/work/app` even though the strings share a prefix, and a root of `/` (an entry
 *   file directly under the filesystem root) is handled like any other root. The previous
 *   string-prefix arithmetic mishandled both: it cut the first characters off the name.
 * - The default root is the folder of the entry file (`appDir.js`); the Bun build plugin
 *   passes the project folder instead because a build script is not the app.
 * - POSIX only, like the rest of the file-name handling: on Windows every file counts as
 *   outside and is named by its absolute path.
 */

'use strict';

const path = require('path');
const appDir = require('../../appDir');

/**
 * @param {string} filename - absolute path of the source file
 * @param {string} [root] - absolute app root; defaults to the entry file's folder
 * @returns {string} path relative to the root when inside it, otherwise `filename` unchanged
 */
function appRelativePath(filename, root) {
  const relative = path.relative(root || '/' + appDir, filename);
  return relative.split(path.sep)[0] === '..' ? filename : relative;
}

module.exports = { appRelativePath };
