/**
 * @file ESM preload entry point for Scribbles (Node and Bun)
 *
 * Domain context
 * --------------
 * This is the file that `--import scribbles/register` (Node), `--preload
 * scribbles/register` (Bun CLI), and `preload = ["scribbles/register"]`
 * (bunfig.toml) all resolve to. Its single responsibility is to install the
 * source-transform hook at the earliest possible moment in the runtime's
 * lifecycle — BEFORE user ESM modules are parsed — so that every file in
 * the main graph gets its `scribbles.<level>(...)` call sites rewritten with
 * full call-site metadata (file/line/col/arg names).
 *
 * Why preload is unavoidable for ESM
 * ----------------------------------
 * ESM is a two-phase spec: the entire module graph is parsed and linked
 * before any code evaluates. Any hook installed from *within* a user module
 * runs AFTER its siblings' sources are already fetched, which is too late
 * to rewrite them. Preload mechanisms (--import, bunfig preload) run a
 * module before graph construction begins, which is the one and only
 * window during which our transform can legally attach. The project's
 * architecture notes cover this in detail.
 *
 * Runtime dispatch
 * ----------------
 * Node and Bun expose different APIs for ESM loader hooks:
 *   - Node (>=20.6):  `module.register(workerUrl, parentUrl)` spawns a
 *                     worker thread that exports `resolve` / `load` hooks.
 *   - Bun  (>=1.0):   `Bun.plugin({ setup(build) { build.onLoad(...) } })`
 *                     registers an inline plugin for runtime loads AND for
 *                     `bun test`, which shares the plugin registry.
 * This file detects the runtime via `typeof globalThis.Bun` and wires the
 * appropriate installer. The resulting user experience — "add one line to
 * your config, everything works" — is identical across both runtimes.
 *
 * Technical context
 * -----------------
 * - Uses a STATIC `import { register } from 'node:module'` rather than a
 *   top-level `await import('node:module')`. Static imports make this
 *   file a synchronous module, which is important because Bun (as of
 *   1.3) refuses `require()` calls from async modules with a "require()
 *   async module ... is unsupported" TypeError. Keeping the file
 *   synchronous means our Bun path's `Bun.plugin()` call works without
 *   tripping that restriction, and Node's path still works because the
 *   static import is fine on Node too — `node:module` is a core module
 *   and loads synchronously.
 * - On Bun the imported `register` function from `node:module` may be
 *   missing or a no-op; we do not call it on Bun (the runtime-detection
 *   `typeof globalThis.Bun` branch picks Bun.plugin() instead), so a
 *   defined-or-not import of that name is harmless on either runtime.
 * - Uses `createRequire(import.meta.url)` to pull `transformSource` out
 *   of `src/parsing/transform.js` (CJS). This is a synchronous call
 *   that Node and Bun both support from non-async ESM modules.
 * - Sets `globalThis[Symbol.for('scribbles.esm-loader.installed')] = true`
 *   FIRST, before any other work, so that the CJS register() path (which
 *   will be triggered later when the user's graph imports scribbles and
 *   index.js runs its own `require('./src/register')()`) sees a
 *   configured runtime and suppresses the "preload not installed"
 *   warning.
 * - Does NOT invoke the CJS installer directly from this file. Doing so
 *   would re-trigger the async-module restriction on Bun, and the CJS
 *   installer is triggered anyway when the user's entry imports
 *   scribbles (via index.js's top-level `require('./src/register')()`).
 *   Mixed-graph projects (ESM entry + transitive CJS dependency that
 *   uses Scribbles) still get their CJS hook installed through that
 *   path — this is a sequencing optimisation, not a functional hole.
 */

import { register as nodeEsmRegister } from 'node:module';
import { createRequire } from 'node:module';

// CJS interop — transform.js is CJS and we call it synchronously from the
// Bun.plugin() onLoad callback. createRequire is anchored at this file's
// URL so the relative path below resolves correctly regardless of where
// the package is installed.
const require = createRequire(import.meta.url);
const { transformSource } = require('./src/parsing/transform.js');
const hotReload = require('./src/register/hot-reload.js');

// Flag that `src/register/index.js` consults to decide whether to emit
// the ESM-preload-missing warning. Set FIRST so any downstream code that
// transitively imports scribbles sees a configured runtime.
const ESM_FLAG = Symbol.for('scribbles.esm-loader.installed');
globalThis[ESM_FLAG] = true;

// Extensions we transform via Bun's plugin path. Restricted to the
// unambiguously-ESM set (`.mjs`) plus TypeScript variants Bun parses
// through its own ESM-oriented pipeline.
//
// `.js` and `.cjs` are DELIBERATELY NOT in this list. Every attempt to
// include them has ended in grief: Bun's `Bun.plugin.onLoad` semantics
// force returned contents to be parsed as ESM, which breaks the
// CJS-to-ESM interop that would otherwise handle untouched CJS files
// reached via an `import` statement. There is no documented "no-op,
// leave me alone" signal from an onLoad callback (`return undefined`,
// `return {}`, and `return { contents: source }` all produce distinct
// hard errors). Bun simply does not support an "inspect but don't
// replace" plugin mode for file loads as of 1.3.10.
//
// The CJS half of the transform is covered elsewhere: when user code
// in a CJS context hits `scribbles.log(...)` via `require()`, the
// `Module._extensions['.js', '.cjs']` hook installed automatically on
// `require('scribbles')` does the rewrite. Bun honours that hook
// faithfully for CJS requires, so the narrower plugin filter here
// completes the ESM half of the story without taking CJS down.
const TRANSFORMABLE = /\.(mjs|ts|cts|mts|tsx|jsx)$/;

if (typeof globalThis.Bun !== 'undefined') {
  // --- Bun runtime path ---
  //
  // Bun runs this preload via `bunfig.toml preload` or `bun --preload`.
  // `Bun.plugin()` registers a process-wide loader plugin; any
  // subsequent ESM-style file load (including those performed by
  // `bun test`, since test modules share the plugin registry with the
  // main runtime) goes through our onLoad callback.
  globalThis.Bun.plugin({
    name: 'scribbles-transform',
    setup(build) {
      build.onLoad({ filter: TRANSFORMABLE }, async (args) => {
        const source = await globalThis.Bun.file(args.path).text();
        // Bun does not watch files a plugin supplies; under --hot / --watch we do.
        hotReload.watch(args.path);
        const transformed = transformSource(source, args.path);
        // Match the loader to the original file extension so Bun's own
        // TS/JSX compilation (if applicable) runs on our output
        // afterward. The filter guarantees the extension is one of
        // these; `.js`/`.cjs` paths never reach here.
        const ext = /\.([a-z]+)$/.exec(args.path)[1];
        const loader =
          ext === 'tsx' ? 'tsx' :
          ext === 'jsx' ? 'jsx' :
          ext === 'mjs' ? 'js' : 'ts';
        return { contents: transformed, loader };
      });
    }
  });
} else {
  // --- Node ESM path ---
  //
  // `module.register()` (stable since Node 20.6) spawns a loader-worker
  // thread whose `resolve` / `load` hooks run for every module in the
  // main graph. See `src/register/hooks/esm-loader.js` for the worker
  // implementation.
  //
  // Node versions older than 20.6 either throw at the static import
  // above or expose a non-function `register` — either way, a user on
  // pre-20.6 Node running an ESM entry gets a clear error from the
  // runtime, and the README directs them to upgrade or fall back to
  // the CJS path (which has no preload requirement).
  //
  // The loader runs in a worker thread that knows nothing about the entry file, so the app
  // root (computed here, where `process.argv` is the real command line) is handed over as
  // `data`; the worker's `initialize` hook receives it. Log lines then name files relative to
  // the entry file's folder, as on the CJS path.
  nodeEsmRegister('./src/register/hooks/esm-loader.mjs', import.meta.url, {
    data: { root: '/' + require('./appDir.js') }
  });
}
