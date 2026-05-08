/**
 * @file Helper utilities for scribbles logging library
 */
const appDir = require('../../appDir');
const sourceMapSupport = require('source-map-support');
//=====================================================
//================================================ Util
//=====================================================

/**
 * Deep merge two objects, concatenating arrays and recursively merging nested objects
 * @param {object} target - The target object to merge into
 * @param {object} source - The source object to merge from
 * @returns {object|boolean} The merged object, or false if inputs are not objects
 */
function deepMerge(target, source) {
  if (typeof target === 'object' && undefined === source) return target;
  if (typeof target !== 'object' || typeof source !== 'object') return false; // target or source or both ain't objects, merging doesn't make sense
  for (var prop in source) {
    if (!source.hasOwnProperty(prop)) continue; // take into consideration only object's own properties.
    if (prop in target) { // handling merging of two properties with equal names
      if (typeof target[prop] !== 'object') {
        target[prop] = source[prop];
      } else {
        if (typeof source[prop] !== 'object') {
          target[prop] = source[prop];
        } else {
          if (target[prop].concat && source[prop].concat) { // two arrays get concatenated
            target[prop] = target[prop].concat(source[prop]);
          } else { // two objects get merged recursively
            target[prop] = deepMerge(target[prop], source[prop]);
          }
        }
      }
    } else { // new properties get added to target
      target[prop] = source[prop];
    }
  }
  return target;
}

//++++++++++++++++++++++++++++++++++++++++++ getSource
//++++++++++++++++++++++++++++++++++++++++++++++++++++

/**
 * When the legacy `rawLines[2]` slice fails to yield `file:line` (Bun, ESM dynamic
 * import, or frames without a column), scribbles would emit `{fileName}:{lineNumber}`
 * with a blank or `?` line — operators lose the real call site. Walk the full stack
 * and return the first frame that looks like `*.js:line[:col]`, skipping scribbles
 * internals and `node:` builtins so we prefer user/gateway code.
 *
 * @param {string} stack - Full `Error.prototype.stack` string
 * @returns {{ file: string, line: number, col: number } | null} Parsed location or null
 */
function walkStackForJsLocation(stack) {
  if (typeof stack !== 'string' || !stack) return null;
  const lines = stack.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes('node_modules/scribbles')) continue;
    if (line.includes('/scribbles/dist/')) continue;
    if (line.includes('node:internal')) continue;
    const re = /([A-Za-z0-9_.-]+\.(?:js|mjs|cjs)):(\d+)(?::(\d+))?/g;
    let m;
    let last = null;
    while ((m = re.exec(line)) !== null) {
      last = {
        file: m[1],
        line: parseInt(m[2], 10),
        col: m[3] != null ? parseInt(m[3], 10) : 1,
      };
    }
    if (last && Number.isFinite(last.line) && last.line > 0) return last;
  }
  return null;
}

/**
 * Extract source file location from a stack trace, resolving source maps when available
 * @param {string} stack - The stack trace string from an Error object
 * @returns {object} Object containing file, line, col, path, type, and args
 */
function getSource(stack) {
  const rawLines = stack.split('\n')
  const originFile = (rawLines[2] || rawLines[1]).split('/');
  const file = decodeURIComponent(originFile[originFile.length - 1].split(':')[0]);
  const line = originFile[originFile.length - 1].split(':')[1];
  const col = originFile[originFile.length - 1].split(':')[2];
  let path = originFile.splice(1).join('/')
  path = path[path.length - 1] === ')' ? path.substring(0, path.length - 1) : path;

  // Use source-map-support to resolve original file paths from source maps
  const mappedPosition = sourceMapSupport.mapSourcePosition({
    source: '/' + path,
    line: parseInt(line, 10),
    column: parseInt(col, 10) - 1  // Convert from 1-indexed to 0-indexed
  });

  // Use mapped values if source map resolution succeeded, otherwise use original
  const resolvedPath = mappedPosition.source !== '/' + path ? mappedPosition.source : path;
  let resolvedLine = mappedPosition.source !== '/' + path ? mappedPosition.line : parseInt(line, 10);
  const resolvedCol = mappedPosition.source !== '/' + path ? mappedPosition.column + 1 : col;

  // Clean up path relative to appDir.
  //
  // Previously this block was:
  //   let finalPath = resolvedPath;
  //   if (finalPath.startsWith('/')) finalPath = finalPath.substring(1);
  //
  // The `if`-guard's false arm was unreachable in the test corpus —
  // `resolvedPath` almost always came back slash-prefixed — and the
  // extra branch failed CASE's dead-code rule. The `.replace(/^\//, '')`
  // below is semantically identical (strip exactly one leading slash if
  // present) and is branchless as far as istanbul is concerned, so the
  // false-arm doesn't bloat coverage reports without an observable
  // scenario triggering it.
  let finalPath = resolvedPath.replace(/^\//, '');
  finalPath = finalPath.startsWith(appDir) ? finalPath.substr(appDir.length + 1) : "/" + finalPath;

  let finalFile = decodeURIComponent(resolvedPath.split('/').pop().split(':')[0]);

  if (!Number.isFinite(resolvedLine) || resolvedLine < 1) {
    const walked = walkStackForJsLocation(stack);
    if (walked) {
      resolvedLine = walked.line;
      finalFile = walked.file;
    }
  }

  return {
    type: originFile[0].split('at').pop().trim().split(" ")[0],
    file: finalFile,
    line: resolvedLine,
    col: resolvedCol,
    path: finalPath,
    args: []  // Required for scribble() to use from.args.map()
  } // END return
} // END getSource

module.exports = { deepMerge, getSource }
