# Scribbles v1 → v2 Migration Guide

> This document describes the changes end users and integrators need to be
> aware of when upgrading from Scribbles 1.x to 2.0.0. It is published as
> a living document alongside the v2 work-in-progress branch and will be
> finalised ahead of the v2.0.0 release.
>
> If you hit a concrete error while migrating, [`docs/troubleshooting.md`](./docs/troubleshooting.md)
> indexes every common Scribbles v2 error by its exact message text and
> walks through the fix. The v2.0.1 patch release (Bun CJS-chain fix and
> trace-across-await fix) is covered there in detail.

## TL;DR

If your code looks like this today:

```js
const scribbles = require('scribbles');
scribbles.log('user', user.name);   // works, unchanged
scribbles.config({ mode: 'dev' });  // works in CJS, works in v1
scribbles.trace(req, () => { ... }); // works in CJS, works in v1
```

On v2, both forms continue to work in CommonJS, but the **recommended** v2
idiom is to destructure the non-log-level APIs:

```js
const scribbles = require('scribbles');
const { config, trace, middleware, register } = require('scribbles');

scribbles.log('user', user.name);    // unchanged — log levels stay on the object
config({ mode: 'dev' });              // v2 recommended
trace(req, callback);                 // v2 recommended
app.use(middleware.express);          // v2 recommended (middleware is a namespace,
                                      // not a callable — use .express for Express)
```

In ESM (new in v2), the destructured form is the idiomatic way to reach
the non-log APIs:

```js
import scribbles from 'scribbles';
import { config, trace, middleware, register } from 'scribbles';

scribbles.log('user', user.name);    // works (default export carries log levels)
config({ mode: 'dev' });              // works
app.use(middleware.express);          // Express middleware
```

## What changed

### 1. Automatic variable-name extraction now works out-of-the-box

In v1.7.0, automatic variable-name extraction was documented as working
whenever you `require('scribbles')`, but the hook that performs the
source transform was never actually installed on require — only test code
that explicitly required `scribbles/src/parsing/loader` activated it. The
bulk of downstream users therefore saw plain logs without the feature.

v2 fixes this: `require('scribbles')` (or `import scribbles from 'scribbles'`
once the ESM build ships) now installs the CJS source-transform hook
automatically. No user code changes required — if you were already doing
`scribbles.log('user', user.name)`, you now get `user userName:<value>`
in your output automatically.

Fix reference: commit "feat: auto-install CJS transform hook on require;
drop node-hook dependency" in the v2 history.

### 2. The `node-hook` dev-dependency is gone

We inlined the ~25 lines of `node-hook` that Scribbles actually used into
`src/register/hooks/cjs-extensions.js`. No external package is required
at install or build time for the CJS loader hook. Bundle output is
unchanged since `node-hook` never shipped in the runtime bundle.

### 3. `register` is now a named export

`register` joins `config`, `trace`, and `middleware` as a destructurable
named export on the module:

```js
const { register } = require('scribbles');

// Idempotent. Automatically called by require('scribbles') — end users
// don't need to call it explicitly, it's exposed for power users and
// for upcoming introspection helpers.
register();

// Wired in a subsequent task:
//   register.status()    // { runtime, installed, transformActive, ... }
//   register.assert()    // throws ScribblesNotRegisteredError if !installed
```

### 4. Multi-runtime support (rolling through v2 development)

v2.0.0 expands the supported runtimes. The current branch has **Node-CJS**
and **Bun-CJS** feature-complete (including variable-name extraction out
of the box). **Node-ESM** and **Bun-ESM** land as further v2 tasks complete
and will require a one-line preload as described in
`docs/runtime-setup.md` (the document lands with the ESM task):

- Node-ESM: `node --import scribbles/register app.mjs`
- Bun (`bun run` and default CLI): add
  `preload = ["scribbles/register"]` to `bunfig.toml`
- `bun test`: add a separate `[test]` section to `bunfig.toml` with its
  own `preload = ["scribbles/register"]`. Bun does not share preload
  configuration between `bun run` and `bun test`. See
  [`docs/runtime-setup.md`](./docs/runtime-setup.md) for the full snippet.

If the preload is missing in an ESM runtime, Scribbles continues to log
with correct file/line/col (via stack traces) but variable-name extraction
is unavailable. A one-line warning on every startup points you at the fix.

`bun build` bundles are supported through the `scribbles/bun-plugin` build plugin (see
`docs/runtime-setup.md`). Support for other bundlers (esbuild, webpack, rollup) is tracked in
follow-up issues on the project's GitHub; `scribbles/transform` exposes the call-site rewrite
for building such plugins.

### 5. Version floor (tiered)

- CJS path (Node's `require`): **Node 8.5.0** — unchanged from v1.
- ESM path (`import`): **Node 20.6+** — the version that stabilised
  `module.register()`. ESM users on older Node see a clear error pointing
  at either upgrading Node or using CJS.
- Bun: **Bun 1.0+**.

Existing CJS users do not need to change their Node version.

## What did NOT change

- `scribbles.log`, `scribbles.info`, `scribbles.warn`, `scribbles.error`,
  `scribbles.fatal`, and any custom level you configure — still properties
  on the main object, still called the same way.
- `scribbles.status`, `scribbles.timer`, `scribbles.timerEnd`,
  `scribbles.group`, `scribbles.groupEnd`, `scribbles.groupCollapsed` —
  unchanged.
- The log-body shape (`body.info`, `body.context`, `body.input`,
  `body.trace`, `body.git`, etc.) — unchanged.
- The `dataOut` / `stdOut` config contract — unchanged.
- The webpack git-defines helper at `scribbles/gitStatus` — unchanged.

## Breaking changes (strict)

- **ESM default export** does not carry `config` / `trace` / `middleware` /
  `register` / `timer` / `timerEnd` / `group` / `status` as properties.

  ```js
  // ESM — v2.0.0 hard cut
  import scribbles, { config, trace, register } from 'scribbles';

  scribbles.log('hello');    // ✅ log levels live on the default export
  scribbles.config({ ... }); // ❌ undefined — throws TypeError on call
  config({ ... });           // ✅ use the named import instead
  ```

  The ESM default export is a `Proxy` over the full scribbles object that
  hides infrastructure APIs (`config`, `trace`, `middleware`, `register`,
  `timer`, `timerEnd`, `group`, `status`). Every one of those is
  reachable only as a named import. `Object.keys(scribbles)` in ESM
  returns only the active log levels, and `'config' in scribbles` is
  `false` — the hiding is complete, not just a `get` intercept.

  CJS users see no strict breaks: `scribbles.config(...)` and
  `const { config } = require('scribbles')` both continue to work.

## Bugs fixed in v2.0.0

- **HTTP hijacker stale-wrapper leak**: in v1.x, when Scribbles was loaded
  multiple times in one process (common under Jest's per-file module
  reset or in test harnesses that snapshot-restore the module registry),
  the second load captured the first load's wrapper as "the original"
  and cross-wired old config into new requests — producing malformed
  `traceparent: "00-undefined-undefined-01"` headers on requests that
  should have passed through untouched. v2 stores the true native
  `http.request` / `https.request` functions on the core modules
  themselves via `Symbol.for(...)`, so subsequent module re-evaluations
  always rewrap the same native original. See
  `src/tracing/hijacker.js` for the full explanation.
- **`scribbles/gitStatus` webpack helper require path**: the standalone
  webpack DefinePlugin helper at the repo root (`gitStatus.js`) pointed
  at the pre-reorganisation path `./src/getGitStatus`. That path has
  been `./src/system/getGitStatus` since the source tree was
  reorganised; the helper has been updated to match, so
  `require('scribbles/gitStatus')` works again.
- **`register` not in `resirvedFnNames`**: users running
  `scribbles.config({ levels: ['register'] })` previously escaped the
  log-level reservation check and silently clobbered the
  `scribbles.register` function. The reservation list now captures
  `register` before the first `config()` call runs, so the name is
  rejected with the same error thrown for `config`, `status`, `timer`,
  `timerEnd`, and `group`.
