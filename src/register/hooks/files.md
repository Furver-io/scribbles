# Register hooks

Per-runtime source-transform installers.

## Directory Structure

```
hooks/
├── bun-plugin.js
├── cjs-extensions.js
├── esm-loader.mjs
├── README.md
└── files.md
```

## Files

### `bun-plugin.js`
`scribbles/bun-plugin`: a `Bun.build` plugin factory. Runs the shared
`transformSource` over project source files as Bun reads them, so a bundle
keeps variable names (`userName:alice`) without the run-time preload.
Skips `node_modules` and files that never mention `scribbles.`.

### `cjs-extensions.js`
CJS source-transformation hook installer. Inlines the ~25 lines of
`node-hook` that Scribbles actually used before v2 dropped that
dependency. Installs a transform on `Module._extensions['.js', '.cjs']`
that routes source through the shared `transformSource` function.
Supports stacked transforms (the same contract `node-hook` had), so
Scribbles composes cleanly with other CJS loader hooks such as
`ts-node` or `@swc/register`. Works on Bun as well as Node because
Bun implements `Module._extensions` with the same contract for CJS
requires.

### `esm-loader.mjs`
Node ESM loader worker. Invoked by `module.register(...)` from the
top-level `register.mjs` preload entry. Exports the `load` hook
required by Node's loader-hooks protocol and delegates source rewriting
to the same shared `transformSource` function via `createRequire`.
The `.mjs` extension is load-bearing — the package does not declare
`"type": "module"`, so a bare `.js` extension would be parsed as CJS
and the file's `import` statements would syntax-error.
