/**
 * @file Unified runtime adapter — detects runtime and installs the transform
 *
 * Domain context
 * --------------
 * This is the single file the rest of the library calls when it wants the
 * source-transform hook up and running. It hides the fact that different
 * runtimes need different installation mechanisms (CJS Module._extensions,
 * Node-ESM module.register(), Bun.plugin()) behind a single idempotent
 * `register()` function.
 *
 * Responsibility split
 * --------------------
 *   - CJS install (Node-CJS + Bun-CJS via Module._extensions) is done
 *     *in this file* because it can safely happen from within user-code
 *     evaluation: the CJS loader consults `Module._extensions` on every
 *     `require()` call, so a mid-evaluation install covers everything
 *     loaded afterward.
 *   - ESM install (Node-ESM + Bun-ESM) CANNOT happen from here because
 *     ESM's graph-before-evaluation ordering makes an in-process install
 *     too late to transform siblings. ESM install is done by the
 *     `register.mjs` preload entry at the repo root, which is loaded via
 *     `--import scribbles/register` (Node) or `bunfig.toml preload` (Bun).
 *     When that preload runs, it sets a cross-realm flag that THIS file
 *     checks; absence of the flag in an ESM-detected context triggers the
 *     one-per-boot warning.
 *
 * Technical context
 * -----------------
 * - Idempotency is managed via `install-flag.js`: repeated calls on any
 *   runtime are free, which matters because `index.js` calls register()
 *   on every `require('scribbles')` and the preload also calls it.
 * - Runtime detection for the warning path is heuristic: we check
 *   `process.argv[1]` for a `.mjs` extension, which catches the most
 *   common Node-ESM and Bun-ESM entry shapes without needing to read the
 *   user's `package.json` or inspect `import.meta`. False negatives (user
 *   runs `.js` in a `type:"module"` package) leave the warning silent,
 *   which is acceptable for an MVP; false positives would be a regression
 *   and do not happen with this heuristic.
 * - The v1.7.0 D11 bug fix lives here too: prior to v2, the CJS hook was
 *   never installed automatically; the feature only worked for callers
 *   who manually required `src/parsing/loader`. Calling `register()` from
 *   `index.js` on library load — which this file enables — makes the
 *   feature work out-of-the-box.
 *
 * `register.status()` / `register.assert()` (T6)
 * ----------------------------------------------
 * The `register` function also exposes two small introspection helpers
 * as methods on itself. They are intended for CI-boot assertions and for
 * programmatic "have you wired preload correctly?" checks. See their own
 * JSDoc blocks below for the contract.
 */

'use strict';

const { isInstalled, markInstalled } = require('./install-flag');
const { install: installCjsHook } = require('./hooks/cjs-extensions');
const { transformSource } = require('../parsing/transform');
const { warnOncePerBoot, ESM_PRELOAD_MISSING } = require('./warn');
const hotReload = require('./hot-reload');

// Same key the ESM preload (register.mjs) sets. Symbol.for ensures both
// realms see the same flag even when Scribbles is loaded multiple times.
const ESM_FLAG_KEY = Symbol.for('scribbles.esm-loader.installed');

/**
 * Heuristic detection of "running under an ESM entry". The warning path
 * only fires when this returns true, because a CJS entry doesn't need the
 * preload at all.
 *
 * Deliberately simple: a `.mjs` entry is an unambiguous signal of ESM.
 * More ambiguous cases (`.js` in a `type:"module"` package, dynamic
 * import() called from CJS, worker threads) are not currently covered;
 * the worst-case consequence is that a user who forgot the preload in
 * one of those cases doesn't see the warning, which is strictly better
 * than a false positive that confuses CJS users.
 *
 * @returns {boolean}
 */
function isLikelyEsmEntry() {
  const entry = process.argv[1];
  return !!(entry && /\.mjs$/.test(entry));
}

/**
 * Describe the current runtime for introspection output. Kept cheap —
 * called only by `register.status()` which is itself infrequent.
 *
 * @returns {'node-esm'|'node-cjs'|'bun-esm'|'bun-cjs'|'unknown'}
 */
function detectRuntime() {
  const isBun = typeof globalThis.Bun !== 'undefined';
  const isEsm = isLikelyEsmEntry();
  if (isBun) return isEsm ? 'bun-esm' : 'bun-cjs';
  if (process.versions && process.versions.node) return isEsm ? 'node-esm' : 'node-cjs';
  return 'unknown';
}

/**
 * Install the source-transform hook for the current runtime if it has not
 * already been installed, and warn on stderr if we detect an ESM context
 * without the corresponding preload.
 *
 * Idempotent — safe to call multiple times. Called automatically by
 * `index.js` on library load.
 */
function register() {
  // Runs on every (re)load of the library, which is what keeps the tick in the program
  // `bun --hot` / `bun --watch` rebuilds. A no-op everywhere else.
  hotReload.ensureTick();

  if (!isInstalled()) {
    // CJS is the only path we can install from here. Node-CJS and
    // Bun-CJS both honour Module._extensions, so one call delivers
    // parity for both.
    installCjsHook(transformSource);
    markInstalled();
  }

  // After installing CJS, check whether the ESM preload is needed but
  // absent. This runs every register() call but warnOncePerBoot() only
  // emits the first time.
  if (isLikelyEsmEntry() && !globalThis[ESM_FLAG_KEY]) {
    warnOncePerBoot(ESM_PRELOAD_MISSING);
  }
}

/**
 * Introspection: what runtime am I on, and is the transform active?
 *
 * Return shape
 * ------------
 *   {
 *     runtime:         'node-cjs' | 'node-esm' | 'bun-cjs' | 'bun-esm' | 'unknown',
 *     cjsInstalled:    boolean   // the Module._extensions hook is installed
 *     esmPreloaded:    boolean   // register.mjs has run (or isn't needed)
 *     transformActive: boolean   // shorthand: user-facing "it works"
 *     instructions?:   string    // human-readable fix, present iff !transformActive
 *   }
 *
 * The `instructions` field intentionally mirrors the warning text from
 * warn.js so a programmatic consumer (e.g. a health check) can present
 * exactly what the startup warning would say.
 */
register.status = function status() {
  const runtime = detectRuntime();
  const cjsInstalled = isInstalled();
  const esmPreloaded = !!globalThis[ESM_FLAG_KEY];

  // "Transform active" means the right mechanism for the current runtime
  // is wired. For CJS-only runtimes the CJS hook is enough; for ESM-ish
  // runtimes the preload is the load-bearing piece.
  const needsEsm = runtime === 'node-esm' || runtime === 'bun-esm';
  const transformActive = needsEsm
    ? (esmPreloaded && cjsInstalled)
    : cjsInstalled;

  const result = { runtime, cjsInstalled, esmPreloaded, transformActive };
  if (!transformActive) result.instructions = ESM_PRELOAD_MISSING;
  return result;
};

/**
 * Fail-fast check intended for CI / production-boot scripts. Throws a
 * typed error if the transform is not active so a "forgot the preload"
 * mistake is caught at startup rather than silently degrading logs.
 *
 * Suggested usage in an app's boot script:
 *
 *   const { register } = require('scribbles');
 *   register.assert();   // throws if preload missing in ESM
 *   // ... rest of boot ...
 *
 * @throws {Error} If register.status().transformActive is false.
 */
register.assert = function assertRegistered() {
  const s = register.status();
  if (!s.transformActive) {
    const err = new Error(
      'scribbles: source-transform is not active — preload not installed.\n' +
      s.instructions
    );
    err.code = 'SCRIBBLES_NOT_REGISTERED';
    err.scribbles = s;
    throw err;
  }
};

// See the block comment at the top of this file for why the module exports
// the register function directly (not `{ register }`). The self-reference
// keeps `const { register } = require(...)` working for code that prefers
// the destructure pattern.
register.register = register;

module.exports = register;
