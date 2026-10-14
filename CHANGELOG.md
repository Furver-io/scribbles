# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Console group UX:** `scribbles.group.end()` now supports optional **captions** on the
  `groupEnd` line — LIFO `end("caption")`, `end(id, "caption")`, and default text from the
  matching `start` / `collapsed` label (or `"Group"`). See `index.d.ts` and
  `docs/argument-combinations.md`.
- **`pretty.groupBrackets` tree layout:** depth-aware vertical rails (`⎜`) with `┌` / `└`
  open and close markers (replacing the older flat corner-only preview). When **colors**
  and **colorScheme** are enabled, **per-depth 24-bit hues** (`groupTreeOpenAtDepth` in
  `src/formatting/colors.js`) tint each rail column; implementation detail in
  `src/formatting/groupLogPrefix.js` keeps `src/core/scribble.js` within the repository
  size gate.
- **`scribbles/bun-plugin`** — a `Bun.build` plugin that keeps variable names in bundles
  (`plugins: [scribblesPlugin()]`). See `docs/runtime-setup.md`.
- **`scribbles/transform`** — `transformSource` is now in the package `exports` map, with types.

### Fixed

- **`bun build` bundles run.** `index.mjs` now uses a static `import` of the CJS core instead of
  `createRequire(...)('./dist/scribbles.js')`, which bundlers could not follow (the bundle crashed
  with `Cannot find module './dist/scribbles.js'`). The host `package.json` lookup in `index.js`
  uses a computed path so bundlers no longer fail to resolve `../../package.json`, and
  `src/core/scribble.js` is strict mode so bound log levels behave identically when a bundler
  wraps the package in an ES module (`this` is `null`, not the global object). The ReadMe no
  longer claims a plain `bun build` keeps variable names; the plugin is how to get them.

### Fixed

- **`scribbles.trace(...)` now returns the callback's result.** It used to discard it and
  return `undefined`, so async handlers lost their result and their rejections became
  unhandled. The callback still receives the span id string first and now also a
  `{ traceId, spanId }` context object second; typings return the callback's type.

---

## [2.0.1] — Integrator regression fixes (Bun CJS chain, trace-across-await)

Two blocker-class issues reported by an integrator running scribbles
under Bun 1.3 are fixed in this patch. See
`__tests__/scenarios/cjs-chain.scenarios.test.js` for the end-to-end
regression coverage, and
[`docs/troubleshooting.md`](./docs/troubleshooting.md) for the full
diagnostic guide (including error-message-indexed remediation for both
fixed issues and a list of defensive setup patterns).

### Fixed

- **Bun CJS wrapper error ("Expected CommonJS module to have a function
  wrapper")** when `require("scribbles")` was called from inside a
  child CJS module while its parent's `require()` was still on the
  call stack — the exact pattern produced by api-ape's `deepRequire`
  when it loads `api/*.js` controllers mid-chain. Root cause: scribbles'
  `Module._extensions['.js']` replacement corrupted Bun's in-progress
  CJS wrapper state for files loaded between install time and the
  next return-to-parent. Fix: the CJS-extensions handler now captures
  the ORIGINAL (Bun / Node native) handler at install time and
  delegates to it for any file that contains no `scribbles.<level>(...)`
  call sites. The fast-path delegation preserves Bun's native compile
  pipeline for ~99% of user modules (those that only import scribbles
  without logging at module scope) while keeping full source-transform
  coverage for the files that actually need it. See
  `src/register/hooks/cjs-extensions.js` for the install and
  delegation logic; the `Symbol.for('scribbles.cjs-extensions.originals')`
  cache lets cross-copy-coordinated installs discover the true native
  handler via the same globalThis protocol used for the transform
  stacks.
- **CLS trace context was lost across the first `await` inside
  `scribbles.trace(opts, cb)` on Bun.** Root cause: the prior
  `@ashleyw/cls-hooked`-based namespace layer relied on Node's
  `async_hooks` `init`/`before`/`after` callbacks; Bun 1.3's
  async_hooks implementation does not feed those callbacks reliably
  for Promise continuations, so cls-hooked's per-namespace context
  map emptied at the first microtask boundary. Fix: the namespace
  layer now uses `AsyncLocalStorage`, which is supported natively on
  both Node (>=16.4) and Bun (>=1.0) and propagates the store through
  every Promise continuation on both runtimes. The public API
  (`trace(opts, cb)`, `trace.headers()`, `trace.lookupTracestate()`)
  is unchanged — the migration is a drop-in swap at the module
  boundary. See `src/tracing/namespace.js` and `src/tracing/trace.js`.

### Removed

- **`@ashleyw/cls-hooked` devDependency.** The trace-context layer
  migrated to `AsyncLocalStorage` (see above), which ships with Node
  itself and is first-class on Bun. The bundle in `dist/scribbles.js`
  is correspondingly smaller, and the zero-runtime-dependency
  property is unchanged.

---

## [2.0.0] — Multi-runtime refactor + ESM hard cut

Full upgrade guide in [MIGRATION.md](./MIGRATION.md). Per-runtime setup
instructions in [docs/runtime-setup.md](./docs/runtime-setup.md).

### Added

- **Node ESM support** via `--import scribbles/register`. Requires Node 20.6+.
  Uses the stable `module.register()` loader-hooks API to transform source
  the same way the CJS path does. See `src/register/hooks/esm-loader.js`.
- **Bun support** via `preload = ["scribbles/register"]` in `bunfig.toml`.
  Covers `bun run`, `bun test`, and any other Bun-loaded module graph
  (bundler plugin for `bun build` is tracked as a follow-up issue).
  Uses `Bun.plugin()` internally.
- **`register` named export** — `const { register } = require('scribbles')`
  returns an idempotent function that installs the source-transform hook.
  Primarily used by the preload entry (`register.mjs`) but exposed for
  programmatic control.
- **`register.status()`** — introspection helper that returns
  `{ runtime, cjsInstalled, esmPreloaded, transformActive, instructions? }`
  so boot scripts can inspect whether the transform is fully active.
- **`register.assert()`** — fail-fast check that throws
  `SCRIBBLES_NOT_REGISTERED` if the transform is not active. Intended for
  CI-boot and production-boot scripts.
- **Every-boot warning** on ESM runtimes without the preload. Goes to
  stderr once per process and points at the README fix. Scribbles
  continues to log (file/line/col via stack traces) with variable-name
  extraction degraded.
- **`package.json exports` map** with `./register`, `./gitStatus`, and `.`
  sub-paths. Replaces the previous `main`-only resolution.
- **Top-level `register.mjs` and `register.cjs`** as the physical preload
  entries consumed by `--import scribbles/register`,
  `--require scribbles/register`, and `bunfig.toml preload`.
- **Top-level `index.mjs` and `index.d.mts`** as the ESM entry and its
  TypeScript definitions. The ESM default export is a `Proxy`-backed
  log-levels-only view of the scribbles object: `scribbles.config`,
  `scribbles.trace`, `scribbles.register`, and every other
  infrastructure primitive are `undefined` on the default export.
  Infrastructure APIs must be pulled as named imports
  (`import { config, trace, register } from 'scribbles'`). This is the
  v2.0.0 "hard cut" described in MIGRATION.md. Custom log levels
  registered via `config({ levels: [...] })` continue to appear on the
  default export dynamically because the Proxy forwards any non-infra
  property access to the live CJS scribbles object.
- **New `src/register/` subtree** housing the unified runtime adapter,
  install-flag, CJS loader, ESM loader worker, and the warning emitter.
- **CI matrix** (`.github/workflows/ci.yml`) running Jest on
  `{ node-18, node-20, node-22, bun-latest }` on every push/PR.
- **Scenario test harness** under `__tests__/scenarios/` that spawns real
  child processes for each supported runtime and asserts on observable
  output. Replaces any temptation to mock loaders in tests.
- **MIGRATION.md, CHANGELOG.md, docs/runtime-setup.md** at the repo root.

### Changed

- **`package.json files` array** expanded to ship `src/`, `register.mjs`,
  `register.cjs`, and `appDir.js` alongside the existing `dist/`
  artifact. The main entry remains the bundled `dist/scribbles.js` (so
  the library continues to have zero runtime dependencies — the four
  packages Scribbles requires at runtime, including `@ashleyw/cls-hooked`
  for trace CLS propagation, are inlined into that bundle by
  `prepublishOnly`). The source files are shipped so the ESM preload
  entry `register.mjs` can reach `src/parsing/transform.js` via
  `createRequire` at runtime, and so advanced users can inspect /
  override internals via direct `require('scribbles/src/...')` paths.
- **`scripts.pretest`** added to rebuild `dist/scribbles.js` before every
  test run. Ensures the scenario tests that resolve `scribbles` as a
  bare specifier (e.g. the Bun-ESM scenarios using the package's
  `exports["."]` resolution through a node_modules symlink) see a bundle
  reflecting current source rather than a stale one. Adds roughly one
  esbuild invocation (~1-2 seconds) to each `npm test` run.
- **Scribbles is now installed automatically** on `require('scribbles')` /
  `import scribbles from 'scribbles'`. The pre-v2 hook was only installed
  by tests that manually required `src/parsing/loader`. This is a
  **user-visible behaviour change**: log output for existing code may now
  include variable-name prefixes that did not appear before. If that is
  undesired in some call sites, the affected files can be moved outside
  the post-scribbles require chain.

### Fixed

- **D11** — pre-existing v1.7.0 bug where the CJS source-transform hook
  was never installed by default on `require('scribbles')`. The feature
  was documented as automatic in the README but only activated for tests
  that manually required `src/parsing/loader`. End users who followed
  the README literally got plain logs without variable-name extraction.
  Now fixed.
- **HTTP hijacker stale-wrapper bug** — when Scribbles was loaded
  multiple times in one process (notably under Jest's per-file module
  reset), the second load captured the first load's wrapper as the
  "native" `http.request`. The new wrapper's passthrough branch then
  invoked the OLD wrapper, which still closed over the FIRST config
  object and injected malformed `traceparent:
  "00-undefined-undefined-01"` headers into requests that should have
  passed through untouched. Fixed by stashing the true native
  `http.request` / `https.request` on the `http` / `https` core
  modules themselves via `Symbol.for(...)`, so module re-evaluations
  always rewrap the same native originals. See
  `src/tracing/hijacker.js`.
- **`scribbles/gitStatus` webpack helper** — the standalone helper at
  the repo root required `./src/getGitStatus`, a pre-reorganisation
  path that no longer exists. The helper has been corrected to the
  current path `./src/system/getGitStatus`, so
  `require('scribbles/gitStatus')` resolves again.
- **`register` now reserved in `config({ levels: [...] })`** — in the
  v2 development branch `register` was attached to `scribbles` AFTER
  the reservation list (`resirvedFnNames`) had been captured, so
  `scribbles.config({ levels: ['register'] })` silently clobbered the
  function. `register` is now captured alongside `config`, `status`,
  `timer`, `timerEnd`, and `group` and is rejected with the
  canonical reserved-name error.
- **README "Only works with Node.js `require()`" claim** — the
  Limitations section still advertised CJS-only support from the
  pre-v2 era. Rewritten to reflect v2's Node + Bun + ESM coverage
  with the `scribbles/register` preload note.

### Removed

- **`node-hook` dev-dependency** — the ~25 lines of
  `Module._extensions['.js']` logic Scribbles actually used have been
  inlined into `src/register/hooks/cjs-extensions.js`. Zero runtime
  dependencies remain (unchanged from v1, which also had zero).

### Internal

- **`src/parsing/transform.js`** and **`src/parsing/args-parser.js`**
  extracted from the pre-v2 `src/parsing/loader.js` as pure modules
  with no side effects. This is what enables the single-source-of-truth
  source transform used by every runtime adapter.
- **`src/parsing/loader.js`** reduced to a backward-compat shim that
  re-exports `_loadArgNames`, `_splitArgs`, `_processSource` for the ~12
  existing test files that depend on those aliases. Scheduled for
  removal in a later v2.x release after the dependent tests have been
  migrated to the new module locations.

---

## [1.7.0] and earlier

See https://github.com/codemeasandwich/scribbles/releases for per-release
notes prior to v2. Key features from those releases:

- Static source-code analysis for file/line/col capture without stack traces.
- Distributed tracing via CLS, with W3C trace-context header propagation.
- Automatic outgoing HTTP/HTTPS header injection (`http.request` hijacker).
- `stdOut` / `dataOut` dual sinks for formatted vs structured output.
- Timer / group / status reserved levels.
- Colour support with colorblind-friendly defaults.
- Webpack git-defines plugin at `scribbles/gitStatus`.
