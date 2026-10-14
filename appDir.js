/**
 * @file Resolves the consuming application's root directory
 *
 * Domain context
 * --------------
 * Scribbles emits `file` metadata (e.g. `"lib/service.js"`) in every log line. Those paths
 * are made relative to the application's root so logs stay readable across developers, CI
 * machines, and containers. This module computes that root once, at require time, and hands
 * it back as a plain string: the directory of the entry script Node (or Bun) was launched
 * with, without its leading forward slash, so it composes with the path arithmetic in
 * `src/utils/appRelativePath.js`.
 *
 * Technical context
 * -----------------
 * - `require.main` is the first choice. It is empty while a preload (`node --require
 *   scribbles/register`) runs, because Node picks the entry file only after the preloads
 *   finish; `process.argv[1]` already holds the entry then, so it is the second choice.
 * - The command-line entry is resolved to the real path (a symlinked entry or a `node .` folder
 *   entry), and ignored after `-e` / `-p`, where `argv[1]` is just an argument of the script.
 * - With no entry file at all (`node -e`, the REPL, an embedded host) the working directory
 *   is the best description of "the app": it is where an evaluated script lives. Before
 *   2.1.1 this case measured from where scribbles itself was installed, which has nothing to
 *   do with the app and produced broken file names under a preload.
 * - Uses `.replace(/^\//, '')` rather than a ternary to strip the leading slash: branchless
 *   for istanbul and semantically equivalent. On Windows the regex matches nothing and the
 *   path passes through unchanged.
 */

const path = require('path');

// Flags after which `process.argv[1]` is an argument of the evaluated script, not an entry file.
const EVAL_FLAG = /^(-e|-p|-pe|--eval|--print)(=|$)/;

/**
 * The entry file named on the command line, as the real path the loader will report. Node's own
 * resolver does the work, so a symlinked launcher (`node_modules/.bin`), a folder (`node .`,
 * which runs the `main` of its package.json or its index file) and a name without extension
 * all land where `require.main.filename` will land.
 *
 * @param {string} arg - `process.argv[1]`
 * @returns {string} absolute path of the entry file
 */
function commandLineEntry(arg) {
  const resolved = path.resolve(arg);
  try {
    return require.resolve(resolved);
  } catch (err) {
    // Not on disk: a mistyped name, or a virtual path (the `/$bunfs/root/...` entry of a
    // `bun build --compile` executable). The run fails or carries on without us anyway.
    return resolved;
  }
}

/**
 * The file the process was started with, as an absolute path.
 *
 * @returns {string|undefined} absolute entry file path, or `undefined` when there is none
 */
function entryFilename() {
  if (require.main && require.main.filename) return require.main.filename;
  if (process.argv[1] && !process.execArgv.some((flag) => EVAL_FLAG.test(flag))) {
    return commandLineEntry(process.argv[1]);
  }
  return undefined;
}

const entry = entryFilename();
const appDir = (entry ? path.dirname(entry) : process.cwd()).replace(/^\//, '');

module.exports = appDir;
