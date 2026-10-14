# Scenarios

End-to-end scenario tests for Scribbles' multi-runtime support.

## Directory Structure

```
scenarios/
├── bun-cjs.scenarios.test.js
├── bun-build.scenarios.test.js
├── bun-compile.scenarios.test.js
├── bun-hot-reload.scenarios.test.js
├── bun-esm.scenarios.test.js
├── bun-test.scenarios.test.js
├── colored-labels.scenarios.test.js
├── fixtures/
├── harness/
├── installed-package.scenarios.test.js
├── named-exports.scenarios.test.js
├── node-cjs.scenarios.test.js
├── node-esm.scenarios.test.js
├── outbound-fetch-runtimes.scenarios.test.js
├── outbound-get-load-order.scenarios.test.js
├── outbound-git-hash.scenarios.test.js
├── preload-file-names.scenarios.test.js
├── quiet-startup.scenarios.test.js
├── README.md
└── files.md
```

## Subdirectories

### `fixtures/`
Small reusable test applications spawned by the scenario suites. See
`fixtures/files.md`.

### `harness/`
Support utilities shared by the scenario suites (child-process
spawner, binary probe). See `harness/files.md`.

## Files

### `bun-cjs.scenarios.test.js`
Bun-CJS drop-in scenario. Asserts that `require('scribbles')` inside a
`bun run app.js` process automatically enables variable-name
extraction.

### `bun-build.scenarios.test.js`
A `Bun.build` bundle starts and logs, and keeps variable names when the
`scribbles/bun-plugin` build plugin is used. Skipped without Bun.

### `bun-compile.scenarios.test.js`
A `bun build --compile` executable names files and variables like `bun run`
when the `scribbles/bun-plugin` build plugin is used, and still logs (with
the bundle's name) without it. Skipped without Bun.

### `bun-hot-reload.scenarios.test.js`
`bun --hot` and `bun --watch` show the new code after an edit to a module
that logs (ES modules via the preload plugin, CommonJS via the extension
hook), stopping after the edit (no reload loop), also with a symlinked or unusable temp directory. Skipped without Bun.

### `bun-esm.scenarios.test.js`
Bun-ESM scenarios: `configured` (via `bunfig.toml preload`) and
`unconfigured` (warn-and-degrade behaviour).

### `bun-test.scenarios.test.js`
Bun test runner scenario. Exercises the separate `[test]` section in
`bunfig.toml` preload configuration because `bun test` does not share
preload state with `bun run`.

### `preload-file-names.scenarios.test.js`
With `node --require scribbles/register` (and `bun --preload`) each log line
names its file relative to the app folder, including sub-folders, files
outside the app and `node -e` sessions.

### `quiet-startup.scenarios.test.js`
Starting outside a git checkout prints nothing on stderr (and `gitEnv`
supplies the git fields); a mistyped `LOG_LEVEL` stops the app with one
plain line naming the value and the allowed levels. Node and Bun.

### `colored-labels.scenarios.test.js`
A colored terminal prints `userName:` (in its own color) before each value.
Needs a fresh `node` child because variable names come from the source
transform.

### `installed-package.scenarios.test.js`
Scribbles copied under a scratch `node_modules/scribbles`: handing `log` to
`forEach` still names the app's file and line, and `node -e` still prints.

### `named-exports.scenarios.test.js`
In-process pin on the v2 CJS named-export surface
(`config`, `trace`, `middleware`, `register`) and the
`register.status()` / `register.assert()` introspection helpers.

### `subpath-exports.scenarios.test.js`
`scribbles/transform` resolves through the package `exports` map from both
ESM and CJS in a fresh `node` process.

### `node-cjs.scenarios.test.js`
Node-CJS drop-in scenario. Same claim as `bun-cjs.scenarios.test.js`
but against a `node app.js` child process.

### `node-esm.scenarios.test.js`
Node-ESM scenarios: `configured` (via `--import scribbles/register`)
and `unconfigured` (warn-and-degrade). Skipped on Node < 20.6 where
`module.register()` is not stable.

### `outbound-fetch-runtimes.scenarios.test.js`
Outgoing `fetch` on runtimes unlike the Jest process: no global fetch (boots,
still traces `http`) and Bun (carries the trace, keeps `fetch.preconnect`).

### `outbound-get-load-order.scenarios.test.js`
Load order for outgoing `http.get` / `request`: an ES module's
`import { get } from 'node:http'` after scribbles carries the trace, while a
function copied out of `http` before scribbles loads is the documented limit.

### `outbound-git-hash.scenarios.test.js`
A build with no `.git` folder still reaches downstream services (no
`x-git-hash: undefined`), and a bundler-injected `__scribbles_gitStatus__` hash
is forwarded.
