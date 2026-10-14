# Scribbles troubleshooting

Everything you need to recover from the most common Scribbles
mis-configurations, plus the full debugging context for the two
integrator-reported v2.0.0 bugs fixed in v2.0.1.

If you just want the happy-path setup in the minimum number of steps,
start with the [Quickstart](../ReadMe.md#quickstart) section at the top
of the README.  This document is the "something isn't working, what
now?" companion.

---

## Table of contents

1. [First — what does `register.status()` say?](#first--what-does-registerstatus-say)
2. [Diagnostic command reference](#diagnostic-command-reference)
3. [Common runtime errors](#common-runtime-errors)
   - ["ESM runtime detected but the source-transform preload is not installed"](#warning-esm-runtime-detected-but-the-source-transform-preload-is-not-installed)
   - [Variable names don't appear in output (`user.name:alice` missing)](#variable-names-dont-appear-in-output-usernamealice-missing)
   - [Bun: "Expected CommonJS module to have a function wrapper"](#bun-expected-commonjs-module-to-have-a-function-wrapper)
   - [Bun: `traceId` is lost after the first `await`](#bun-traceid-is-lost-after-the-first-await)
   - [Bun: editing a file does not reload under `bun --hot` / `bun --watch`](#bun-editing-a-file-does-not-reload-under-bun---hot--bun---watch)
   - [File names in logs look wrong](#file-names-in-logs-look-wrong)
   - [Start-up prints `fatal: not a git repository`](#start-up-prints-fatal-not-a-git-repository)
   - [Start-up fails with `scribbles: Unknown logLevel "..."`](#start-up-fails-with-scribbles-unknown-loglevel-)
   - [`SCRIBBLES_NOT_REGISTERED` thrown at boot](#scribbles_not_registered-thrown-at-boot)
   - [TypeError: `scribbles.config is not a function` (ESM only)](#typeerror-scribblesconfig-is-not-a-function-esm-only)
4. [Configuration patterns that break at scale](#configuration-patterns-that-break-at-scale)
   - [Controllers required via `deepRequire` / plugin chains](#controllers-required-via-deeprequire--plugin-chains)
   - [Module-scope `scribbles.<level>(...)` calls](#module-scope-scribblesleveld-calls)
5. [The "nothing is working, reset to defaults" recipe](#the-nothing-is-working-reset-to-defaults-recipe)
6. [Runtime support matrix](#runtime-support-matrix)

---

## First — what does `register.status()` say?

Every debugging session starts here. Scribbles' own `register.status()`
returns an object describing exactly which transform hooks are live in
the current process:

```js
const { register } = require('scribbles');
console.log(register.status());
// {
//   runtime:         'node-cjs' | 'node-esm' | 'bun-cjs' | 'bun-esm' | 'unknown',
//   cjsInstalled:    true,      // the Module._extensions hook is installed
//   esmPreloaded:    true,      // register.mjs preload has executed
//   transformActive: true,      // right mechanism for this runtime is wired
//   instructions?:   '...'      // remediation text, present iff transformActive:false
// }
```

Read it like a triage chart:

| `runtime`    | `cjsInstalled` | `esmPreloaded` | `transformActive` | Meaning                                 |
| ------------ | :------------: | :------------: | :---------------: | --------------------------------------- |
| `node-cjs`   | `true`         | *(ignored)*    | `true`            | ✅ Done. No setup needed.                |
| `node-esm`   | `true`         | `true`         | `true`            | ✅ Done. Preload wired correctly.        |
| `node-esm`   | `true`         | `false`        | `false`           | ❌ Missing `--import scribbles/register`. |
| `bun-cjs`    | `true`         | *(ignored)*    | `true`            | ✅ Done.                                 |
| `bun-esm`    | `true`         | `true`         | `true`            | ✅ Done. `bunfig.toml preload` wired.    |
| `bun-esm`    | `true`         | `false`        | `false`           | ❌ Missing `bunfig.toml preload` entry.  |
| `unknown`    | any            | any            | `false`           | ❌ Not running under Node or Bun — unsupported. |

For a hard failure at boot (CI / production), use `register.assert()`
instead — it throws a typed `SCRIBBLES_NOT_REGISTERED` error carrying
the same status object so your own crash-reporter can surface it.

---

## Diagnostic command reference

Copy-paste probes you can run when something's off.  All three drop
into a shell, write a file to `/tmp`, execute it, then clean up.

### "Is scribbles even loaded from the right place?"

```bash
cat > /tmp/scribbles-where.js <<'EOF'
const path = require.resolve('scribbles');
console.log('Resolved from:', path);
console.log('Version:', require('scribbles/package.json').version);
EOF
node /tmp/scribbles-where.js   # or: bun /tmp/scribbles-where.js
```

If `Resolved from:` points to an unexpected location (a cached copy in
`~/.bun/install/cache/scribbles@X.Y.Z/...`, a stale `node_modules`),
that's your culprit.

### "Is the CJS source-transform hook actually active?"

```bash
cat > /tmp/scribbles-hook.js <<'EOF'
require('scribbles');                                     // force load
const { register } = require('scribbles');
const status = register.status();
console.log(JSON.stringify(status, null, 2));
EOF
node /tmp/scribbles-hook.js
```

### "Does my trace id survive an `await`?"

```bash
cat > /tmp/scribbles-trace.mjs <<'EOF'
import scribbles, { config, trace } from 'scribbles';
config({ stdOut: () => {}, dataOut: (d) =>
  process.stdout.write(
    'msg=' + JSON.stringify(d.input.message) +
    ' trace=' + (d.trace?.traceId || '-') + '\n'
  )
});
trace('probe', async () => {
  scribbles.info('before-await');
  await new Promise((r) => setTimeout(r, 10));
  scribbles.info('after-await');
});
EOF
# Node:
node --import scribbles/register /tmp/scribbles-trace.mjs
# Bun (needs bunfig.toml preload = ["scribbles/register"] in cwd):
bun /tmp/scribbles-trace.mjs
```

All log lines should share the same non-empty `trace=` value.

---

## Common runtime errors

### Warning: "ESM runtime detected but the source-transform preload is not installed"

**Symptom**: One-shot stderr message on process startup. Scribbles
logs still appear, but without the `varName:value` prefix that
`scribbles.log(user.name)` would normally produce.

**Cause**: You are running under Node ESM (`.mjs` entry, or `.js` in a
`"type": "module"` package) or Bun with an ESM entry, and the preload
that registers Scribbles' source-transform loader has not been wired.
ESM parses the full module graph before any code evaluates, so a
transform installed from inside user code is too late to rewrite
sibling modules.

**Fix**:

- **Node ESM**: add `--import scribbles/register` to your Node
  invocation, or set `NODE_OPTIONS="--import scribbles/register"` in
  the environment.
- **Bun**: add `preload = ["scribbles/register"]` at the top of
  `bunfig.toml`.  If you also run `bun test`, add the same line
  inside a `[test]` section (Bun does not share preload configuration
  between `bun run` and `bun test`).

After the fix, `register.status().esmPreloaded` should report `true`
and the warning will stop.

### Variable names don't appear in output (`user.name:alice` missing)

**Symptom**: `scribbles.log(user.name)` renders `... <value>` where you
expected `... user.name:alice`.

Work through this checklist in order:

1. **Check `register.status().transformActive`.** If `false`, follow
   the preload-missing fix above.
2. **Check the file the call is in.** Scribbles' transform rewrites
   `scribbles.<level>(...)` call sites when the containing file is
   *loaded*. The file that BOOTS scribbles (the main entry on Node
   CJS) is already being parsed when scribbles installs, so the
   transform never gets a chance to rewrite it. Move the call into a
   separate module and require that module from your entry. On Node
   you can instead start with `node --require scribbles/register app.js`.
   **On Bun** the entry file, when it is `.js` or `.cjs`, and ES-module
   files named `.js` are never rewritten, even with the preload (Bun runs
   the entry itself and a runtime plugin can only return ES modules): move
   the calls to a module the entry `require`s, or name the file `.mjs` /
   `.ts`. See [What Bun can and cannot rewrite](./runtime-setup.md#what-bun-can-and-cannot-rewrite).
3. **Check the argument shape.** A literal value has no variable name
   to extract: `scribbles.log('a string')` will always emit `... a string`
   — there is no `varName:` prefix because no variable was involved.
4. **Check for bundled code.** If your code ran through a bundler
   (esbuild, webpack, tsc), the original variable names are
   transformed to arbitrary short identifiers. Source maps give
   scribbles the right file/line/col, but cannot reverse-engineer the
   original variable name from the bundled output. The fix is either
   to run unbundled in dev, or to use `scribbles.<level>.at({...}, ...)`
   explicitly to pass the intended name.

### Bun: "Expected CommonJS module to have a function wrapper"

**Symptom** (Bun 1.3.x on Scribbles v2.0.0 ONLY — fixed in v2.0.1):

```
error: Expected CommonJS module to have a function wrapper. If you
weren't messing around with Bun's internals, this is a bug in Bun
```

Raised on any subsequent CJS `require()` after `require('scribbles')`
ran from inside a child CJS module whose parent was still being
loaded. The canonical reproduction is:

```js
// parent.cjs
require('./child.cjs');

// child.cjs
const scribbles = require('scribbles');
module.exports = function (data) { /* ... */ };
```

…and any framework that loads controllers via chained require
(api-ape's `deepRequire`, common plugin loaders) will produce the
same shape at scale.

**Cause**: Scribbles' CJS-extensions hook replaced
`Module._extensions['.js']` wholesale. On Bun 1.3 that replacement,
when it happened mid-load-chain, corrupted Bun's in-progress CJS
wrapper state so the next CJS compile threw.

**Fix (recommended)**: upgrade to **Scribbles v2.0.1+**. Starting at
that version the CJS-extensions handler captures the original
(native) `Module._extensions[ext]` at install time and **delegates**
to it for every file that contains no `scribbles.<level>(...)` call
sites. The native Bun pipeline runs untouched for ~99% of user
modules; only files that actually need the transform flow through
the scribbles path.

**Belt-and-braces defensive config** (works on both v2.0.0 and v2.0.1):

1. Add `preload = ["scribbles/register"]` to `bunfig.toml` (you
   already need this for Bun ESM — zero extra setup). The preload
   installs the hook BEFORE any user code begins to parse, so
   "mid-chain install" can never happen.
2. Eagerly import scribbles at the **first executable line** of your
   main entry, before your framework's `deepRequire` or plugin loader
   touches controllers:

   ```js
   // src/boot/main.js — first real line
   import scribbles, { config } from 'scribbles';
   // ...configure scribbles...
   // THEN load controllers / run framework bootstrap
   ```

### Bun: `traceId` is lost after the first `await`

**Symptom** (Bun 1.3.x on Scribbles v2.0.0 ONLY — fixed in v2.0.1):

```
msg="inside-sync"              traceId=285b71…
msg="inside-after-await"       traceId=-      ← context lost
msg="inside-after-two-awaits"  traceId=-
```

`scribbles.trace(opts, cb)` is intact synchronously inside the
callback but every log after an `await` comes out with an empty
`trace` block.

**Cause**: Pre-v2.0.1 the trace-context layer relied on
`@ashleyw/cls-hooked`, which hooks into Node's `async_hooks`
`init`/`before`/`after` callbacks to propagate its per-namespace
context through Promise continuations. Bun 1.3's `async_hooks`
implementation does not fire those callbacks reliably for
Promise microtasks — so cls-hooked's stored context emptied at
the first `await`.

**Fix (recommended)**: upgrade to **Scribbles v2.0.1+**. The trace
layer now uses `AsyncLocalStorage` (built into Node since 16.4 and
supported natively by Bun since 1.0), which both runtimes propagate
correctly across every Promise continuation.

There is no setup-side workaround for the pre-v2.0.1 version of this
issue short of restructuring every handler to avoid `await` inside
`scribbles.trace(...)` — which is impractical for any real service.

### Bun: editing a file does not reload under `bun --hot` / `bun --watch`

**Symptom**: you edit a module that calls `scribbles.<level>(...)` and the
running process keeps the old code. Modules that never log reload fine.

**Cause**: scribbles rewrites those modules (to add variable names) and Bun
only watches files it read itself. **Fixed in 2.1.1**: when the process was
started with `--hot` or `--watch` scribbles watches the modules it rewrites
and nudges Bun to reload. On 2.1.0 and earlier restart the process by hand, or
run without `--hot` while editing logging code. Details in
[runtime-setup.md](./runtime-setup.md#bun---hot-and-bun---watch).

### File names in logs look wrong

* **`//private/tmp/...` or a path with its first characters missing** (seen
  with `node --require scribbles/register` and with `Bun.build` plugin
  bundles on 2.1.0 and earlier): fixed in 2.1.1. File names are now relative
  to the folder of your entry file (the working directory for `node -e`; the
  build's working directory, or `scribblesPlugin({ root })`, for bundles).
* **The name of a bundle or executable (`app.js:4209`)**: the code was
  bundled without the build plugin. Add `scribbles/bun-plugin` to
  `Bun.build`, including for `compile` executables.

### Start-up prints `fatal: not a git repository`

Scribbles asked git for the commit hash at start and git complained on
stderr. Fixed in 2.1.1: nothing is printed outside a checkout or without the
`git` command; the repo, branch and commit stay empty unless `gitEnv` supplies
them.

### Start-up fails with `scribbles: Unknown logLevel "..."`

`LOG_LEVEL` (or the `scribbles` block of your `package.json`) names a level
that is not in `levels`. The message names the bad value and lists the allowed
levels, and the process exits with status 1 (before 2.1.1 it also printed
lines of source code first). Fix the value, for example `LOG_LEVEL=warn`.

### `SCRIBBLES_NOT_REGISTERED` thrown at boot

**Symptom**: An `Error` with `err.code === 'SCRIBBLES_NOT_REGISTERED'`
and an `err.scribbles` property equal to `register.status()` is
thrown early in your boot script.

**Cause**: Your boot script (usually `src/boot/main.js` or similar)
calls `register.assert()` in an ESM runtime where the preload has
not been wired. `register.assert()` is Scribbles' fail-fast helper —
it is throwing deliberately to surface the mis-configuration rather
than silently degrade logs.

**Fix**: Read `err.scribbles` — its `instructions` field is the
exact text of the preload-missing warning. Wire the preload as
documented in the same message, then relaunch.

### TypeError: `scribbles.config is not a function` (ESM only)

**Symptom**: Code like `import scribbles from 'scribbles'; scribbles.config({...})`
throws `TypeError: scribbles.config is not a function` under ESM.

**Cause**: v2.0.0 made a deliberate "hard cut" on the ESM default
export — only log-level functions (`log`, `info`, `warn`, `error`,
`debug`, plus any levels registered through `config`) hang off the
default export. Everything else — `config`, `trace`, `middleware`,
`register`, `timer`, `timerEnd`, `group`, `status` — is available
ONLY as a named import. See [MIGRATION.md](../MIGRATION.md) for
the full rationale.

**Fix**: destructure the infra you need at the import site:

```js
import scribbles, { config, trace, register } from 'scribbles';

scribbles.log('hello');       // ✅ log levels on default export
config({ logLevel: 'info' }); // ✅ infra via named import
```

(CJS is unaffected: `require('scribbles').config(...)` continues to
work because CommonJS cannot distinguish destructuring from property
access at runtime.)

---

## Configuration patterns that break at scale

### Controllers required via `deepRequire` / plugin chains

Frameworks like `api-ape` load every `api/*.js` controller via a
chained `require()` chain. On Scribbles v2.0.0 this produced the
Bun "function wrapper" error described above; on v2.0.1+ the pattern
works out of the box. Even so, two setup practices make the happy
path even more robust:

1. **Always set `preload = ["scribbles/register"]` in `bunfig.toml`**
   when using any runtime-wide CJS chain on Bun. This makes the
   Module._extensions install happen at Bun's preload stage, which
   is strictly before any user code begins to parse, removing the
   "mid-chain install" concern for good.
2. **Eagerly import scribbles at the top of your main entry, before
   `deepRequire` / plugin loading.** That way every downstream
   controller's `require("scribbles")` is a cache hit.

Neither is strictly required on v2.0.1+ — the native-handler
delegation in the CJS-extensions hook handles the pattern — but both
reduce future-risk at zero cost.

### Module-scope `scribbles.<level>(...)` calls

The most-optimised shape for controllers is:

```js
// api/messages.js
const scribbles = require('scribbles');

module.exports = function handler(data) {
  scribbles.info('handling', data);   // ✅ inside the exported function
  return { ok: true };
};
```

The transform runs on this file cleanly — `scribbles.info(...)`
gets rewritten to capture variable names — and the fast-path
delegation in Scribbles' hook still preserves Bun's native compile
pipeline for controllers that have no logging at all.

If you need to log at **module scope** (e.g. `scribbles.info('loaded')`
at the top of a controller), move the call into an exported `init()`
function that your boot script calls explicitly. Module-scope
logging is rarely what you want anyway — it fires once at import
time regardless of whether the controller is ever invoked.

---

## The "nothing is working, reset to defaults" recipe

If you suspect your local environment has drifted into a weird state
(cached older scribbles, stale `node_modules`, phantom `bunfig.toml`
edits, polluted `bun` install cache):

```bash
# 1. Clear package manager caches
rm -rf node_modules package-lock.json bun.lockb
rm -rf ~/.bun/install/cache/scribbles*

# 2. Reinstall fresh
npm install scribbles         # or: bun add scribbles

# 3. Verify version matches what you expect
node -e "console.log(require('scribbles/package.json').version)"

# 4. Run the diagnostic probe from the top of this document
node -e "require('scribbles'); console.log(require('scribbles').register.status())"
```

If `register.status()` still disagrees with what you configured, the
next debugging step is to run Scribbles from an absolute path in a
scratch directory to rule out module-resolution shenanigans:

```bash
mkdir -p /tmp/scribbles-sanity && cd /tmp/scribbles-sanity
cat > probe.js <<'EOF'
const scribbles = require('/ABSOLUTE/PATH/TO/node_modules/scribbles');
console.log(scribbles.register.status());
EOF
node probe.js
```

---

## Runtime support matrix

| Runtime / module system                      | Minimum | Setup                                        |
| -------------------------------------------- | ------- | -------------------------------------------- |
| Node CJS via `require('scribbles')`          | 8.5.0   | **None** — works out of the box              |
| Node ESM via `import scribbles from 'scribbles'` | 20.6 | `--import scribbles/register` on `node`      |
| Bun (runtime + `bun test` + ESM)             | 1.0     | `preload = ["scribbles/register"]` in `bunfig.toml` (also inside a `[test]` section); no variable names in a `.js` entry file |
| `bun build` / `--compile` bundles            | 1.0     | `plugins: [scribblesPlugin()]` from `scribbles/bun-plugin` |

ESM users on Node < 20.6 will see `module.register is not a function`
from the preload — upgrade Node or use the CJS path.

For the full "why" of each mechanism, read
[docs/runtime-setup.md](./runtime-setup.md).
