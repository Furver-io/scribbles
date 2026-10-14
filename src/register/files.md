# Register

Unified runtime adapter — installs Scribbles' source-transform hook for
whatever runtime the process is currently executing under.

## Directory Structure

```
register/
├── hooks/
│   ├── cjs-extensions.js
│   └── esm-loader.mjs
├── files.md
├── hot-reload.js
├── index.js
├── install-flag.js
├── README.md
└── warn.js
```

## Subdirectories

### `hooks/`
Per-runtime installers that each adapt the same shared `transformSource`
function to the mechanism the runtime provides. See `hooks/files.md`.

## Files

### `hot-reload.js`
Keeps `bun --hot` / `bun --watch` reloading when a module scribbles rewrites
changes. Bun does not watch files a plugin or the CommonJS extension hook
hands it, so in a hot run this watches those modules and rewrites a tick
file Bun does watch. Does nothing outside Bun's hot and watch modes.

### `index.js`
The single entry point. Exposes `register()` — an idempotent function
that detects what installers are appropriate for the current runtime
and calls each. Called automatically by the package's `index.js` on
load. Also defines `register.status()` and `register.assert()` as
introspection helpers hung off the function.

### `install-flag.js`
Cross-module guard that records whether the CJS hook has been installed
in this process. Uses `Symbol.for(...)` so independently-bundled copies
of Scribbles in the same process cooperatively share the flag rather
than clobbering each other.

### `warn.js`
One-per-boot warning emitter. Writes directly to `process.stderr` with
the canonical "ESM runtime detected but the source-transform preload
is not installed" message, guarded by a cross-realm `Symbol.for` flag
so two Scribbles copies in the same process suppress duplicate
warnings. The message text includes the substrings `scribbles` and
`preload` — scenario tests lock that contract, so any future rewording
must preserve both terms.
