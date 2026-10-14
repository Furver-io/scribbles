/**
 * @file Node ESM loader worker for Scribbles source transformation
 *
 * Domain context
 * --------------
 * ESM modules in Node are parsed and linked before any user code evaluates,
 * which means a source transform must be registered via Node's loader API
 * *before* the main module graph is constructed. This file is the "worker"
 * half of that loader — it runs in a separate thread when installed via
 * `module.register('./src/register/hooks/esm-loader.mjs', parentUrl)` and
 * exports the hooks (`load`, optionally `resolve`) that Node calls for
 * every module request in the main graph.
 *
 * Each `.js` / `.mjs` / `.cjs` / `.ts` / etc. file that the worker sees
 * has its source piped through the same `transformSource` function that
 * the CJS loader uses, so Node-ESM users get byte-identical logging output
 * to Node-CJS users for the same call sites.
 *
 * Technical context
 * -----------------
 * - The filename extension is `.mjs` (not `.js`) because Scribbles'
 *   `package.json` declares `"type": "commonjs"`, which makes `.js`
 *   files CJS by default. A loader worker has to be native ESM (it uses
 *   top-level `import` statements and exports `load` / `resolve` named
 *   hooks), so the file extension overrides the package-level default.
 * - Written as an ESM module because `module.register()` expects its
 *   worker URL to resolve to one. `import.meta.url` is consulted at
 *   load time so we can resolve sibling modules via relative paths.
 * - `createRequire(import.meta.url)` is used to import the CJS transform
 *   module (`src/parsing/transform.js`). This avoids duplicating the
 *   transform implementation in ESM form — there is exactly one
 *   `transformSource` function in the whole package.
 * - Only file:// URLs with matching extensions are transformed; everything
 *   else (core modules, http:// imports, data: URLs, etc.) is passed
 *   through to the next loader unchanged. This matches the principle of
 *   least surprise and lets Scribbles coexist with other ESM loader hooks.
 * - Extensions include `.ts` / `.cts` / `.mts` / `.tsx` for toolchains that
 *   hand Node pre-transpiled or directly-executable TypeScript. The
 *   transform is a string-level rewrite of `scribbles.<level>(...)` calls
 *   that works identically on JS and TS syntax, so there is no reason to
 *   refuse TS inputs.
 */

import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// CJS interop: pull the pure transform function out of the existing CJS
// module without duplicating the implementation in ESM.
const require = createRequire(import.meta.url);
const { transformSource } = require('../../parsing/transform.js');

// Files we want to transform. The same set the CJS installer uses plus TS
// variants for toolchains that feed Node native TS sources.
const TRANSFORMABLE = /\.(m?js|c?js|ts|cts|mts|tsx|jsx)$/;

// Folder the `file` names in log lines are relative to. Set by `initialize` from the main
// thread; `undefined` (the transform's own default) when the loader is registered some other way.
let appRoot;

/**
 * Node ESM `initialize` hook. Runs once in the loader thread with the `data` that
 * `register.mjs` passed to `module.register`.
 *
 * @param {{ root: string }} [data] - `root`: absolute app folder for file names
 */
export function initialize(data) {
  appRoot = data && data.root;
}

/**
 * Node ESM `load` hook. Called for every module request once the resolver
 * has picked a URL. Returns `{ format, source, shortCircuit }` per Node's
 * loader-hooks protocol.
 *
 * @param {string}   url       - Resolved module URL (e.g. "file:///…/lib.mjs")
 * @param {object}   context   - Resolver context supplied by Node.
 * @param {Function} nextLoad  - Default loader; we delegate to it to get the
 *                               real source, then wrap / augment as needed.
 * @returns {Promise<object>}  - A result object for Node to consume.
 */
export async function load(url, context, nextLoad) {
  // Always call nextLoad first so we don't re-invent source fetching; we
  // only add our transform on top of whatever the default loader returned.
  const result = await nextLoad(url, context);

  // Early out: non-file URLs (core:, http:, data:, etc.) or files with
  // extensions we don't transform go through untouched.
  if (!url.startsWith('file://') || !TRANSFORMABLE.test(url)) {
    return result;
  }

  // If the previous loader didn't provide source (e.g. it returned format
  // 'builtin' or had shortCircuit:true), we have nothing to transform and
  // must pass the result through unchanged.
  if (result.source == null) {
    return result;
  }

  // Node can hand us source as a string or a Buffer depending on the
  // previous loader. Normalise to a string for the transformer.
  const sourceText = typeof result.source === 'string'
    ? result.source
    : Buffer.from(result.source).toString('utf-8');

  // Run the shared transform. `transformSource` is pure and deterministic,
  // so caching is handled by Node's own module loader layer rather than
  // ours — our job is just to return the rewritten text.
  const filename = fileURLToPath(url);
  const transformed = transformSource(sourceText, filename, appRoot);

  return { ...result, source: transformed };
}
