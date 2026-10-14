/**
 * @file Scribbles - A structured logging library for Node.js with tracing support
 */
require('./src/utils/checkNodeVer')
// Install the CJS source-transform hook before anything else so every file
// required from user code AFTER this point has its `scribbles.<level>(...)`
// call sites rewritten to carry call-site metadata (file/line/col/arg names).
// Fixes the pre-existing v1.7.0 bug where automatic variable-name extraction
// only worked when users manually required `scribbles/src/parsing/loader`
// — a step the README never asked them to perform. See src/register/index.js
// for the rationale and `src/register/hooks/cjs-extensions.js` for the
// inlined hook logic (which replaces the pre-v2 `node-hook` dependency).
// `require('./src/register')` returns the register function directly (see
// src/register/index.js for why we export the function rather than an
// `{ register }` wrapper). Calling it here installs the CJS transform
// hook on the very first load of the library.
require('./src/register')();
require('source-map-support').install()
var sVer = require('./package.json').version;

const os = require('os');
const fs = require("fs");

const config = require('./src/core/config');
const hijacker = require('./src/tracing/hijacker');
const gitValues = require('./src/system/getGitStatus');
const { createScribble } = require('./src/core/scribble');
const { myNamespace } = require('./src/tracing/namespace');
const { createTrace } = require('./src/tracing/trace');
const { createMiddleware } = require('./src/tracing/middleware');
const { createConfig } = require('./src/core/scribblesConfig');
const register = require('./src/register');

let packageJson_scribbles = {}

// The path is computed (not a literal `require('../../package.json')`) so bundlers such as
// `bun build` leave it as a run-time require instead of failing to resolve a file that only
// exists in the host project.
const hostPackageJsonPath = __dirname + '/../../package.json';
if (fs.existsSync(hostPackageJsonPath)) {
  const packageJson = require(hostPackageJsonPath);
  if (packageJson.scribbles) {
    packageJson_scribbles = packageJson.scribbles
  }
}

const hostname = os.hostname();
const pValues = {
  pTitle: process.title,
  pid: process.pid,
  ppid: process.ppid || 0,
  user: process.env.USER,
  vNode: process.version
};

const cuidPrefixRaw = ((process.ppid ? process.ppid.toString(16).slice(-2)
  : Math.floor(Math.random() * 15).toString(16) +
  Math.floor(Math.random() * 15).toString(16))
  + process.pid.toString(16).slice(-2)
  + Math.floor(Math.random() * 15).toString(16))

let cuidPrefixValue = gitValues.hash.slice(-2) + cuidPrefixRaw
const cuidPrefix = {
  get: () => cuidPrefixValue,
  set: (val) => { cuidPrefixValue = val }
}

const traceCount = {
  value: 1,
  increment: function() { this.value++ }
}

const scribbles = {}

const scribble = createScribble({
  sVer,
  gitValues,
  hostname,
  cuidPrefix,
  pValues,
  scribbles
});

const trace = createTrace({
  cuidPrefix,
  traceCount,
  gitValues,
  myNamespace
});
scribbles.trace = trace

scribbles.middleware = createMiddleware(trace);

// v2 named-export surface — attached BEFORE `resirvedFnNames` is captured
// so that `register` cannot be clobbered by a user-defined log level.
//
// Domain context
// --------------
// Starting with v2.0.0 the project's convention is that everything on
// `module.exports` that is NOT a log level lives as a destructurable
// named export rather than as a property that user code reaches for as
// `scribbles.<thing>(...)`. The log-level properties (`log`, `info`,
// `warn`, `error`, etc., plus the reserved variants `status`, `timer`,
// `timerEnd`, `group*`) continue to hang off the main object because
// they ARE the product's core API surface.
//
// `config`, `trace`, and `middleware` are attached here for CJS
// property-access back-compat and continue to work via
// `const { config, trace, middleware } = require('scribbles')`. This
// block adds `register` to the same named-export surface so v2 code has
// a fourth destructurable infrastructure primitive available:
//     const { register } = require('scribbles');
//     register.status();   // introspection
//     register.assert();   // fail-fast for CI boot
//
// The hard version of the named-exports-only cut is delivered by the
// ESM entry (`index.mjs`): its default export is a log-levels-only
// Proxy, so `import scribbles from 'scribbles'; scribbles.config(...)`
// is `undefined` in ESM — infrastructure must be pulled as named
// exports. In the CJS entry both destructuring AND legacy
// `scribbles.config(...)` property access keep working — a pragmatic
// soft-cut inherited from the natural shape of `module.exports`,
// because CommonJS offers no way to distinguish destructuring from
// property access at runtime. Users migrating to v2 are guided by
// MIGRATION.md toward the named form.
scribbles.register = register;

// Capture reserved function names AFTER every v2 infrastructure primitive
// has been attached (trace, middleware, register). `config` itself is
// pushed below once its factory is wired, and the reserved logging
// variants (`status`, `timer`, `timerEnd`, `group`) are pushed alongside
// per the original reservation set (issues #13, #24).
const resirvedFnNames = Object.keys(scribbles);

const scribblesConfig = createConfig({
  scribbles,
  scribble,
  gitValues,
  cuidPrefix,
  cuidPrefixRaw,
  resirvedFnNames
});
scribbles.config = scribblesConfig

// Reserve `config` now that the function is live.
resirvedFnNames.push('config');
// Reserve the special logging functions that `config()` attaches (issue #24).
resirvedFnNames.push('status');
resirvedFnNames.push('timer');
resirvedFnNames.push('timerEnd');
// Reserve the group namespace (issue #13).
resirvedFnNames.push('group');

scribbles.config(packageJson_scribbles)

if (config.hijack !== false) {
  hijacker(scribbles, config)
}

module.exports = scribbles;
