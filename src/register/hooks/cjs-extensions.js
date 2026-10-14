/**
 * @file CJS source-transformation hook installer (inlined from node-hook)
 *
 * Domain context
 * --------------
 * For CommonJS loads — `require('./lib.js')` and friends — Scribbles installs
 * a transform on Node's `Module._extensions['.js']` handler. Any file loaded
 * after install has its source piped through `transformSource` (from
 * `src/parsing/transform.js`) before being compiled and evaluated. This is
 * the mechanism that rewrites `scribbles.log(user.name)` to
 * `scribbles.log.at({...}, "hello", user.name)` so the runtime can emit
 * `user.name:<value>` in its output.
 *
 * Historically Scribbles consumed the `node-hook` npm package for this. In
 * v2 we inline the ~25 LOC of logic we actually used, dropping the
 * dependency entirely (honouring CASE's zero-runtime-deps rule) and gaining
 * explicit control over the hook chain's semantics. The behaviour mirrors
 * node-hook's "nested transforms" model: each `install(fn)` call stacks
 * another transform on top of the previously-registered ones for the same
 * extension, and they run in registration order with each transform's
 * string output feeding the next.
 *
 * Bun compatibility: delegating the fast path
 * -------------------------------------------
 * On Bun, replacing `Module._extensions['.js']` with a handler that does
 * `fs.readFileSync + module._compile` can corrupt Bun's in-progress CJS
 * wrapper state when `require('scribbles')` is called from a module that
 * is itself still being loaded by a parent's require(). Symptom (reported
 * by an integrator running api-ape's deepRequire pipeline on Bun 1.3.10):
 *
 *     error: Expected CommonJS module to have a function wrapper.
 *     If you weren't messing around with Bun's internals, this is a bug
 *     in Bun
 *
 * The workaround — and the shape this file now implements — is to keep a
 * reference to the ORIGINAL handler and delegate to it for every file
 * that has no `scribbles.<level>(...)` call sites. The transform's
 * fast-path already relies on that substring check internally (see
 * `src/parsing/transform.js`: "if the substring `scribbles.` is not
 * present on this line, there is nothing to rewrite"), so skipping the
 * `fs.readFileSync + module._compile` round-trip when NO line matches
 * costs nothing at runtime while preserving Bun's native compile
 * pipeline for ~99% of user code. Files that DO use scribbles still
 * flow through our transform path; the small fraction of modules that
 * contain `scribbles.<level>(...)` in their top-level scope were not the
 * ones observed to trigger the wrapper bug in the integrator's reports.
 *
 * Technical context
 * -----------------
 * - `Module._extensions['.js']` is Node's legacy-but-stable public extension
 *   point for CJS source loading. Bun implements the same object with the
 *   same contract (verified empirically — Bun 1.3 exposes it for .js, .cjs,
 *   .mjs, .ts, .tsx, .mts, .cts).
 * - ESM loads (`import './lib.mjs'`) bypass this hook completely. For ESM a
 *   separate installer using `module.register()` (Node) / `Bun.plugin()`
 *   (Bun) is wired from the `register.mjs` preload entry.
 * - The stack-of-transforms map lives on globalThis (same protocol as
 *   `install-flag.js`) so two independently-bundled copies of Scribbles
 *   cooperatively share the hook chain instead of clobbering each other.
 * - The extension handler calls `module._compile(source, filename)` — an
 *   internal API — because that is the *only* way to return transformed
 *   source to Node's CJS loader from an extension handler. This mirrors
 *   how node-hook, istanbul, ts-node, and @swc/register all do it.
 *
 * Call shape
 * ----------
 *   install(transformFn)
 *     // transformFn :: (source: string, filename: string) => string
 *     // Registers transformFn for the default extensions ['.js', '.cjs'].
 *     // Both extensions are hooked because real-world CJS codebases mix
 *     // them freely.
 */

'use strict';

const fs = require('fs');
const Module = require('module');
const hotReload = require('../hot-reload');

// Per-extension ordered list of transforms. Shared across all Scribbles
// copies in the process via globalThis so the hook chain is coherent even
// in pathological dependency-linking scenarios. Keyed by extension (".js").
const STACKS_KEY = Symbol.for('scribbles.cjs-extensions.transforms');

// Per-extension record of the original pre-scribbles handler. Shared on
// globalThis for the same cross-copy-coordination reason STACKS_KEY is,
// and also so that a SECOND Scribbles copy — loaded after we've already
// wrapped the extension — doesn't mistake our wrapper for the "true"
// original handler and wrap a wrapper chain. Keyed by extension.
const ORIGINALS_KEY = Symbol.for('scribbles.cjs-extensions.originals');

// Marker stamped onto every handler this module installs. Used by the
// originals-cache to detect "this is already one of our wrappers" and
// avoid capturing it as the original on a second-Scribbles boot.
const HANDLER_MARKER = Symbol.for('scribbles.cjs-extensions.handler');

// Default set of CJS extensions Scribbles hooks. `.js` covers the
// overwhelming majority of CJS files; `.cjs` covers the explicit-CJS
// opt-in that users sprinkle into `type: "module"` packages.
const DEFAULT_EXTENSIONS = ['.js', '.cjs'];

/**
 * Install a source-text transform for CJS `.js` / `.cjs` file loads.
 *
 * @param {(src: string, filename: string) => string} transformFn
 *        Must always return a string.
 */
function install(transformFn) {
  if (!globalThis[STACKS_KEY]) {
    globalThis[STACKS_KEY] = {};
  }
  if (!globalThis[ORIGINALS_KEY]) {
    globalThis[ORIGINALS_KEY] = {};
  }
  const stacks = globalThis[STACKS_KEY];
  const originals = globalThis[ORIGINALS_KEY];

  for (const ext of DEFAULT_EXTENSIONS) {
    if (!stacks[ext]) {
      // First install for this extension: capture the original handler
      // so we can delegate to it for files that don't need transforming.
      // `originals[ext]` is keyed on globalThis so a second copy of
      // Scribbles loaded later can find the true native original here
      // (rather than mistaking our wrapper for it when
      // `Module._extensions[ext]` is already wrapped).
      const current = Module._extensions[ext];
      if (current && !current[HANDLER_MARKER]) {
        originals[ext] = current;
      }

      stacks[ext] = [];

      const scribblesExtensionHandler = function (module, filename) {
        const source = fs.readFileSync(filename, 'utf8');

        // Fast path: if the file contains no `scribbles.<level>(` call
        // sites, the transform chain is a guaranteed no-op. Delegate
        // to the pre-install handler so Bun's native CJS wrapper
        // pipeline (and any other extension tooling an unrelated
        // library might have installed before scribbles) runs
        // untouched. This is the workaround for the integrator-
        // reported "Expected CommonJS module to have a function
        // wrapper" error on Bun 1.3 when scribbles is required from
        // inside an in-progress CJS chain (api-ape's deepRequire).
        if (source.indexOf('scribbles.') < 0 && originals[ext]) {
          return originals[ext](module, filename);
        }

        // Transform path: pipe the source through every registered
        // transform and hand the final string to module._compile. Under `bun --hot` /
        // `bun --watch` Bun does not watch a file compiled this way, so we do (see
        // `../hot-reload.js`).
        hotReload.watch(filename);
        let out = source;
        for (const fn of stacks[ext]) {
          out = fn(out, filename);
        }
        module._compile(out, filename);
      };
      scribblesExtensionHandler[HANDLER_MARKER] = true;
      Module._extensions[ext] = scribblesExtensionHandler;
    }

    // Subsequent install() calls on the same extension append to the
    // stack rather than replacing the handler. Deduped so repeated
    // register() calls (e.g. from divergent bundles) don't pile on
    // duplicates.
    if (!stacks[ext].includes(transformFn)) {
      stacks[ext].push(transformFn);
    }
  }
}

module.exports = { install };
