/**
 * @file ESM entry point for Scribbles — enforces the v2.0.0 hard cut
 *
 * Domain context
 * --------------
 * Starting with v2.0.0 the project's public API is tiered:
 *
 *   - **Default export** (`import scribbles from 'scribbles'`) carries
 *     ONLY log-level functions: the built-ins `log`, `info`, `warn`,
 *     `error`, `debug`, plus any custom levels the user has activated
 *     through `config({ levels: [...] })`.
 *
 *   - **Named exports** (`import { config, trace, middleware, register,
 *     timer, timerEnd, group, status } from 'scribbles'`) carry every
 *     piece of infrastructure — configuration, distributed tracing,
 *     framework middleware, runtime registration, timing helpers, and
 *     status/grouping helpers.
 *
 * In CJS this tiering is merely *recommended* (CommonJS offers no way
 * for a module to distinguish destructuring from property access, so
 * `scribbles.config(...)` keeps working for back-compat). In ESM the
 * tiering is *enforced by language semantics* and by the Proxy-backed
 * default export defined below: user code that writes
 * `scribbles.config(...)` in ESM receives `undefined` and a clean
 * TypeError, which is the deliberate v2.0.0 "hard cut".
 *
 * Why a Proxy rather than a snapshot
 * ----------------------------------
 * Scribbles' CJS core rebinds log-level functions every time `config()`
 * runs, and user code may call `config({ levels: ['fatal', ...] })`
 * AFTER importing. A snapshot of `scribbles`' log levels captured at
 * import time would go stale. A Proxy forwarding every property access
 * to the live CJS `scribbles` object keeps the default export's log
 * surface dynamic — identical to the CJS experience — while the `INFRA`
 * hide-set strips out the infrastructure properties.
 *
 * Named exports are static function references because none of them
 * rebind during normal operation (the `timer`, `timerEnd`, `group`, and
 * `status` references captured here survive config() calls because
 * config() only updates `scribbles.*`, and our named exports already
 * point at the up-to-date post-boot bindings — `index.js` runs the
 * initial `scribbles.config(packageJson_scribbles)` before this file
 * requires the CJS core).
 *
 * Technical context
 * -----------------
 * - A static `import` pulls in the bundled CJS artifact
 *   `dist/scribbles.js`, which is the same bundle users receive from
 *   npm. (It is a static import rather than `createRequire` so that
 *   bundlers can follow it.) The `exports` map in `package.json` routes bare-specifier
 *   `import` statements to this file and bare-specifier `require()`
 *   calls to the CJS bundle, so ESM users transparently get the hard
 *   cut without noticing the implementation detail.
 * - The Proxy intercepts `get`, `has`, `ownKeys`, and
 *   `getOwnPropertyDescriptor` so that standard introspection APIs
 *   (e.g. `Object.keys(scribbles)`, `'config' in scribbles`) all agree
 *   the infrastructure is absent. Only `get` alone would be enough for
 *   the normal call-site `scribbles.config(...)` path, but users who
 *   reflect on the object (tests, debuggers, serializers) would see
 *   misleading metadata.
 * - The transform installed for ESM by `register.mjs` rewrites
 *   `scribbles.<level>(...)` into `scribbles.<level>.at({...}, ...)`.
 *   Property access on the Proxy returns the underlying log function
 *   reference, whose `.at` method is attached by `scribblesConfig.js`.
 *   The transform therefore works identically against the Proxy as it
 *   does against the raw CJS `scribbles` object.
 * - `register` is both a function (to install the CJS transform hook
 *   idempotently) and an object with `.status()` / `.assert()` methods
 *   (introspection / fail-fast helpers). Exporting the function
 *   reference preserves both shapes because JavaScript functions are
 *   objects with arbitrary properties.
 */

// A static import (not `createRequire(...)('./dist/scribbles.js')`) so bundlers such as
// `bun build`, esbuild and rollup can see the dependency and include the CJS core.
// Node and Bun hand a CJS module's `module.exports` back as the default import, and the
// `exports` map routes `require` to this same file, so both paths share one evaluation.
import scribblesCjs from './dist/scribbles.js';

// Infrastructure property names that the ESM default export must hide.
// Anything in this set returns `undefined` via the Proxy below — that
// is the v2.0.0 hard cut.
//
// `_groupStack` is an internal state field used by `scribble.js` to
// track the active console-group nesting. It is not part of any public
// contract and must not leak through the default export.
const INFRA = new Set([
  'config',
  'trace',
  'middleware',
  'register',
  'timer',
  'timerEnd',
  'group',
  'status',
  '_groupStack'
]);

// Proxy-backed default export. Every property access the user makes
// against `scribbles` is routed to the live CJS object, EXCEPT when the
// property is in `INFRA` — then the Proxy pretends the property does
// not exist. This enforces the hard cut while preserving access to
// dynamic custom log levels added via `config({ levels: [...] })`.
const scribbles = new Proxy(scribblesCjs, {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && INFRA.has(prop)) return undefined;
    return Reflect.get(target, prop, receiver);
  },
  has(target, prop) {
    if (typeof prop === 'string' && INFRA.has(prop)) return false;
    return Reflect.has(target, prop);
  },
  ownKeys(target) {
    return Reflect.ownKeys(target).filter(
      (k) => typeof k !== 'string' || !INFRA.has(k)
    );
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === 'string' && INFRA.has(prop)) return undefined;
    return Reflect.getOwnPropertyDescriptor(target, prop);
  }
});

export default scribbles;

// Named exports — the only way to reach infrastructure APIs in ESM.
// See the file header for the full v2.0.0 tiering rationale.
export const config = scribblesCjs.config;
export const trace = scribblesCjs.trace;
export const middleware = scribblesCjs.middleware;
export const register = scribblesCjs.register;
export const timer = scribblesCjs.timer;
export const timerEnd = scribblesCjs.timerEnd;
export const group = scribblesCjs.group;
export const status = scribblesCjs.status;
