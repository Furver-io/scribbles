# Runtime setup

Scribbles' killer feature — automatic variable-name extraction in log
output (`scribbles.log("hi", user.name)` → `hi user.name:alice`) — depends
on a source-code transform that rewrites `scribbles.<level>(...)` call
sites at module load time. Different runtimes expose different mechanisms
for installing that transform. This document covers every supported
configuration in detail.

The [ReadMe's Runtime support](../ReadMe.md#runtime-support) section
covers the common cases in one screenful; this file is the reference for
the edge cases and the "why". For error-message-indexed troubleshooting
and the "my logs look wrong, now what?" flow, see
[`docs/troubleshooting.md`](./troubleshooting.md).

---

## Why the preload is needed at all

ES Modules are a two-phase spec: the runtime parses and links the full
module graph *before* any user code runs. A source-transform hook
installed from inside a user module runs AFTER its siblings are already
parsed, and is therefore too late to rewrite them.

The CommonJS module system does not share this constraint — CJS is
synchronous and eager, so a hook installed mid-load transforms every
`require()` that happens afterward. That is why **Node CJS users need
nothing to get full feature parity**: Scribbles installs the CJS hook
during its own `require('scribbles')` evaluation.

For any runtime path that uses ES Module loading (Node ESM, Bun runtime,
`bun test`), the source transform must be registered from a *preload*
module — a script the runtime loads before user code begins to parse.
Scribbles ships `register.mjs` as that preload module, and the tables
below show how to wire it for each supported runtime.

---

## Per-runtime setup matrix

### Node CJS — `require('scribbles')`

Nothing to do.

```js
const scribbles = require('scribbles');
scribbles.log('user', user.name);   // emits: ... user user.name:<value>
```

### Node ESM — `import scribbles from 'scribbles'`

Requires **Node 20.6+** for the stable `module.register()` API that
Scribbles' preload depends on. Add one of:

| How you invoke Node | Preload command |
| --- | --- |
| `node app.mjs` | `node --import scribbles/register app.mjs` |
| `npm start` (script in `package.json`) | put `--import scribbles/register` in the script's `node` call |
| CI / container (env driven) | `NODE_OPTIONS="--import scribbles/register"` |

Any of these attach Scribbles' loader before your module graph loads.
Without it, `scribbles.log(user.name)` will render `<value>` but not
`user.name:<value>`; you will also see a one-line warning on stderr at
startup pointing back at this document.

If you are on Node 20.5 or older, either upgrade Node or use the CJS
path (`require('scribbles')`). Scribbles does not support the older
`--experimental-loader` flag — its semantics changed between Node
versions too often to be worth the maintenance cost.

### Bun — `bun run`, `bun test`, `bun build`

Requires Bun 1.0+. Add the following to `bunfig.toml` in your project root:

```toml
preload = ["scribbles/register"]

[test]
preload = ["scribbles/register"]
```

Bun treats `bun run` and `bun test` as separate execution contexts with
separate preload configuration:

- The **top-level** `preload` applies to `bun run`, `bun <file>`, and
  the default CLI. It covers:
  - `bun run app.js`
  - `bun run app.ts`
  - `bun run app.mjs`
  - `bun app.js` (shorthand)
- The **`[test]`** section's `preload` is read only by `bun test`. If
  you only set the top-level and omit this section, variable-name
  extraction silently stops working the moment you run `bun test`.

Setting both entries is the full-coverage configuration and matches
Bun's own docs for preload semantics. If your project never uses
`bun test`, the `[test]` section is optional; if your project never
uses `bun run` directly (i.e. only `bun test`), the top-level is
optional — but there is no harm in setting both defensively.

#### `bun build` (bundles)

A bundle produced by `Bun.build` runs without the preload, so variable names have to be
added while bundling. Add the plugin that ships with scribbles:

```js
import scribblesPlugin from 'scribbles/bun-plugin';

await Bun.build({
  entrypoints: ['./src/main.ts'],
  outdir: './out',
  target: 'bun',
  plugins: [scribblesPlugin()],   // optional: scribblesPlugin({ filter: /\.tsx?$/ })
});
```

The plugin rewrites `scribbles.<level>(...)` call sites in your own sources (never in
`node_modules`) so the bundle logs `userName:alice` exactly as `bun run` does. Without the
plugin the bundle still starts and logs, but without variable names. The plugin is only
available through `Bun.build`'s JavaScript API; the `bun build` command line cannot take plugins.

Tooling that needs the same rewrite can import it directly:
`import { transformSource } from 'scribbles/transform'`.

### Mixed CJS + ESM projects

If your project imports some files as CJS and some as ESM in the same
process, use both mechanisms together. `register.mjs` itself installs
both the ESM loader (via `module.register` / `Bun.plugin`) *and* the CJS
extension hook (via `Module._extensions`), so the ESM preload also
covers any CJS files that get required transitively.

If your main entry is CJS but you occasionally `import()` ESM modules,
use `--require scribbles/register` instead of `--import` — this registers
the CJS half only (the ESM `import()` calls will still fall back to
stack-based file/line/col without variable-name extraction).

---

## Programmatic verification

Scribbles exposes `register.status()` and `register.assert()` for
introspection. These are particularly useful in CI-boot and
production-boot scripts where you want a "forgot the preload" bug to
surface loudly rather than silently degrade logs.

```js
const { register } = require('scribbles');

// Snapshot the current state. Safe to call anytime.
console.log(register.status());
// {
//   runtime:         'node-esm',
//   cjsInstalled:    true,
//   esmPreloaded:    true,
//   transformActive: true
// }

// Throw if the transform is not fully active. Ideal as the second line
// of a boot script, after process.env checks.
register.assert();
```

`register.assert()` throws an `Error` with `err.code === 'SCRIBBLES_NOT_REGISTERED'`
and an `err.scribbles` object equal to `register.status()`, so downstream
error handlers can inspect the mis-configuration programmatically.

---

## Troubleshooting

This section covers the setup-adjacent diagnostic paths. For the full
error-message-indexed reference — including the two integrator-reported
v2.0.0 regressions fixed in v2.0.1 — see
[`docs/troubleshooting.md`](./troubleshooting.md).

### "scribbles: ESM runtime detected but the source-transform preload is not installed."

This is the stderr warning Scribbles emits when it detects an ESM entry
without the preload wired. Fix by adding `--import scribbles/register`
(Node) or `preload = ["scribbles/register"]` (Bun) per the tables above.

### Logs still show plain values (no `varName:` prefix) even with preload

Verify three things:

1. `register.status().transformActive` returns `true`.
2. The `scribbles.log(x)` call is in a file loaded AFTER scribbles itself
   (most common: your entry file calls `scribbles.log` — the entry file
   is already being parsed when scribbles installs, so it is not
   transformed; move the call into a separate module).
3. Literal values (`scribbles.log('a string')`) cannot have a variable
   name extracted because there is no variable to name.

### Bun: "Expected CommonJS module to have a function wrapper"

Fixed in Scribbles v2.0.1 — the CJS-extensions hook now delegates to the
runtime's native `Module._extensions` handler for files with no
`scribbles.<level>(...)` call sites, which preserves Bun's in-progress
CJS wrapper state across mid-chain `require('scribbles')` calls. If you
see this error, upgrade to v2.0.1+ and/or set
`preload = ["scribbles/register"]` in `bunfig.toml`. See
[troubleshooting.md](./troubleshooting.md#bun-expected-commonjs-module-to-have-a-function-wrapper)
for the full analysis.

### Bun: `traceId` lost across the first `await`

Fixed in Scribbles v2.0.1 — the trace-context layer migrated from
`@ashleyw/cls-hooked` to `AsyncLocalStorage`, which propagates through
Promise continuations reliably on both Node and Bun. See
[troubleshooting.md](./troubleshooting.md#bun-traceid-is-lost-after-the-first-await)
for the full analysis and a ready-made diagnostic probe.

### Node version errors

Scribbles has a tiered version floor:

| Runtime / module system | Minimum |
| --- | --- |
| Node CJS via `require('scribbles')` | 8.5.0 (unchanged from v1) |
| Node ESM via `import scribbles from 'scribbles'` | 20.6 |
| Bun | 1.0 |

ESM users on Node < 20.6 will see `module.register is not a function`
from the preload. Upgrade Node or use the CJS path.
