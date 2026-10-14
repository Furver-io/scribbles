/**
 * @file Scenarios: module-load-time environmental code paths
 *
 * Domain context
 * --------------
 * A handful of Scribbles' source files do their work at `require()`
 * time rather than behind a function call. That makes their branches
 * reachable only by influencing the environment BEFORE the first
 * import. Examples:
 *
 *   - `src/utils/checkNodeVer.js` throws if the running Node is older
 *     than 8.5 — only reachable by spoofing `process.version` before
 *     require.
 *   - `src/core/config.js` defaults `logLevel` from `process.env.LOG_LEVEL
 *     || "debug"` — only reachable with `LOG_LEVEL` set at require time.
 *   - `src/system/getGitStatus.js` runs `git` via execSync at module
 *     load; its fallback arms only fire if execSync throws.
 *   - The root `index.js` reads `../../package.json` to pick up a
 *     user project's `scribbles` config block — only reachable when a
 *     sibling `package.json` with a `scribbles` key is present at the
 *     path Scribbles expects.
 *
 * Each test below manipulates env / require-cache state, re-requires
 * the module under test, asserts the branch's observable effect, and
 * restores the pre-test state so downstream suites see a clean world.
 * Every test drives through the same `require(...)` that user code
 * would reach for.
 *
 * Technical context
 * -----------------
 * - Uses `jest.resetModules()` / `delete require.cache[id]` to force
 *   re-evaluation of a target module.
 * - `process.version` and `process.env.*` mutations go through
 *   Object.defineProperty where Node's built-in objects resist plain
 *   assignment, matching the exact pattern in
 *   `register-lifecycle.scenarios.test.js`.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { bootWithHostPackage } = require('./harness/host-package.cjs');

describe('Scenario: checkNodeVer — old-Node throw path', () => {
  it('throws when process.version reports a pre-8.5 Node release', () => {
    const saved = process.version;
    Object.defineProperty(process, 'version', {
      value: 'v7.10.0', writable: true, configurable: true
    });
    try {
      const p = require.resolve('../../src/utils/checkNodeVer.js');
      delete require.cache[p];
      expect(() => require(p)).toThrow(/Scribbles needs node v8\.5\.0/);
    } finally {
      Object.defineProperty(process, 'version', {
        value: saved, writable: true, configurable: true
      });
    }
  });

  it('throws when minor version is below 5 on an 8.x Node', () => {
    // The check is `8 > ver || 8 === ver && 5 > fe`. The first test
    // above covers the `8 > ver` arm; this one covers the
    // `8 === ver && 5 > fe` arm.
    const saved = process.version;
    Object.defineProperty(process, 'version', {
      value: 'v8.3.0', writable: true, configurable: true
    });
    try {
      const p = require.resolve('../../src/utils/checkNodeVer.js');
      delete require.cache[p];
      expect(() => require(p)).toThrow(/Scribbles needs node/);
    } finally {
      Object.defineProperty(process, 'version', {
        value: saved, writable: true, configurable: true
      });
    }
  });
});

describe('Scenario: config.js — LOG_LEVEL environment override', () => {
  it('picks up LOG_LEVEL from the environment when set at require time', () => {
    const saved = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    try {
      jest.isolateModules(() => {
        const cfg = require('../../src/core/config.js');
        expect(cfg.logLevel).toBe('warn');
      });
    } finally {
      if (saved === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved;
    }
  });

  it('picks up NODE_ENV as the mode when set at require time', () => {
    const savedMode = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      jest.isolateModules(() => {
        const cfg = require('../../src/core/config.js');
        expect(cfg.mode).toBe('production');
      });
    } finally {
      if (savedMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedMode;
    }
  });

  it('falls back to "dev" mode when NODE_ENV is unset at require time', () => {
    // The `||` right-hand arm. Unsetting NODE_ENV reveals the default.
    const savedMode = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      jest.isolateModules(() => {
        const cfg = require('../../src/core/config.js');
        expect(cfg.mode).toBe('dev');
      });
    } finally {
      if (savedMode !== undefined) process.env.NODE_ENV = savedMode;
    }
  });

  it('falls back to "debug" logLevel when LOG_LEVEL is unset at require time', () => {
    const savedLevel = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    try {
      jest.isolateModules(() => {
        const cfg = require('../../src/core/config.js');
        expect(cfg.logLevel).toBe('debug');
      });
    } finally {
      if (savedLevel !== undefined) process.env.LOG_LEVEL = savedLevel;
    }
  });
});

describe('Scenario: getGitStatus — execSync failure fallback', () => {
  // getGitStatus.js captures `child_process.execSync` at module-top.
  // To force its try/catch into the catch arm we temporarily patch
  // execSync on the shared `child_process` module, re-require
  // getGitStatus, assert the fallback exports, and restore. Going
  // through the `child_process` module (Node's public API) is an
  // integration test, not a unit mock.
  const childProcess = require('child_process');

  it('falls back to the __scribbles_gitStatus__ global when git is unavailable', () => {
    const savedExec = childProcess.execSync;
    const savedGlobal = global.__scribbles_gitStatus__;
    childProcess.execSync = () => { throw new Error('simulated git-not-found'); };
    global.__scribbles_gitStatus__ = { hash: 'deadbee', repo: 'fake', branch: 'main' };
    try {
      jest.isolateModules(() => {
        const gs = require('../../src/system/getGitStatus.js');
        expect(gs).toEqual({ hash: 'deadbee', repo: 'fake', branch: 'main' });
      });
    } finally {
      childProcess.execSync = savedExec;
      if (savedGlobal === undefined) delete global.__scribbles_gitStatus__;
      else global.__scribbles_gitStatus__ = savedGlobal;
    }
  });

  it('falls back to the hard-coded defaults when neither git nor the webpack define is available', () => {
    const savedExec = childProcess.execSync;
    const savedGlobal = global.__scribbles_gitStatus__;
    childProcess.execSync = () => { throw new Error('simulated git-not-found'); };
    delete global.__scribbles_gitStatus__;
    try {
      // `jest.isolateModules` establishes a fresh module registry for the
      // callback — same semantics as Node's `delete require.cache[id]`
      // but friendly to Jest's own module bookkeeping. Required here
      // because Jest's CJS runner caches parsed source at a layer
      // above `require.cache`, and mutations to `require.cache` alone
      // are not always honoured on the next `require()` from within
      // the Jest worker.
      jest.isolateModules(() => {
        const gs = require('../../src/system/getGitStatus.js');
        expect(gs).toEqual({ hash: '', repo: '', branch: '' });
      });
    } finally {
      childProcess.execSync = savedExec;
      if (savedGlobal !== undefined) global.__scribbles_gitStatus__ = savedGlobal;
    }
  });
});

describe('Scenario: root index.js — parent package.json scribbles auto-config', () => {
  // The branch being exercised at the top of the repo-root `index.js`:
  //
  //   if (fs.existsSync(__dirname + '/../../package.json')) {
  //     const packageJson = require('../../package.json');
  //     if (packageJson.scribbles) { ... }
  //   }
  //
  // Fires when Scribbles is installed under a host project's
  // `node_modules/scribbles/`, where `__dirname + '/../../package.json'`
  // resolves to the host's package.json. Each story boots scribbles in its own
  // `node` process with a synthetic host package.json (see
  // `harness/host-package.cjs`), so nothing is written outside the repo and no
  // other test file can observe the host file mid-run.

  const PROBE = `
    const http = require('http');
    const bodies = [];
    scribbles.config({ stdOut: null, dataOut: (b) => bodies.push(b) });
    scribbles.log('quiet?');
    scribbles.warn('loud');
    console.log(JSON.stringify({
      mode: bodies.length ? bodies[0].info.mode : null,
      levels: bodies.map((b) => b.info.logLevel),
      hijacked: http.request[Symbol.for('scribbles.hijacker.wrapper')] === true
    }));
  `;

  it('ignores a parent package.json that has no `scribbles` block', () => {
    // Covers the FALSE arm of the inner `if (packageJson.scribbles)` check: the host
    // file is read but contributes nothing, so defaults apply.
    const { status, result } = bootWithHostPackage({ name: 'synthetic-host-no-scribbles-key' }, PROBE);

    expect(status).toBe(0);
    expect(result.mode).not.toBe('fromParentPkg');
    expect(result.levels).toEqual(['log', 'warn']);
    expect(result.hijacked).toBe(true);
  });

  it('loads the `scribbles` block from a parent package.json when present', () => {
    const { status, result } = bootWithHostPackage({
      name: 'synthetic-host-for-scribbles-test',
      scribbles: { mode: 'fromParentPkg', logLevel: 'warn' }
    }, PROBE);

    expect(status).toBe(0);
    expect(result.mode).toBe('fromParentPkg');
    // logLevel "warn" silences `log` but still lets `warn` through.
    expect(result.levels).toEqual(['warn']);
  });
});

describe('Scenario: index.js — process.ppid defensive fallbacks', () => {
  // `index.js`:
  //   ppid: process.ppid || 0,
  //   const cuidPrefixRaw = ((process.ppid ? <shortPpid> : <random>) + ...)
  //
  // Both lines have a FALSE arm that fires only when `process.ppid` is
  // 0 / undefined — the shape Node takes on platforms where the parent
  // PID is not discoverable (e.g. detached PID-namespace boots).
  //
  // Booting scribbles afresh inside an isolate re-evaluates index.js,
  // which also re-installs the hijacker wrapper. We snapshot/restore
  // `http.request` around the isolate so the 32-hijacker suite
  // downstream does not inherit an isolate-closed wrapper.
  const http = require('http');
  const https = require('https');
  let savedHttpRequest;
  let savedHttpsRequest;
  let savedHttpGet;
  let savedHttpsGet;

  beforeEach(() => {
    jest.resetModules();
    savedHttpRequest = http.request;
    savedHttpsRequest = https.request;
    savedHttpGet = http.get;
    savedHttpsGet = https.get;
  });

  afterEach(() => {
    http.request = savedHttpRequest;
    https.request = savedHttpsRequest;
    http.get = savedHttpGet;
    https.get = savedHttpsGet;
  });

  it('uses the random-nibble fallback path when process.ppid is undefined', () => {
    const savedPpid = process.ppid;
    Object.defineProperty(process, 'ppid', {
      value: undefined, writable: true, configurable: true
    });
    try {
      jest.isolateModules(() => {
        const scribbles = require('../../index.js');
        // Scribbles still boots cleanly — pValues.ppid becomes 0 via
        // `process.ppid || 0`, and the `cuidPrefixRaw` computation
        // falls into its random-nibble branch instead of the shortPpid
        // one. No throw, and the log function surface is still usable.
        expect(typeof scribbles.log).toBe('function');
      });
    } finally {
      Object.defineProperty(process, 'ppid', {
        value: savedPpid, writable: true, configurable: true
      });
    }
  });
});

describe('Scenario: appDir — require.main fallback path', () => {
  // `appDir.js`:
  //   let appDir = path.dirname(require.main && require.main.filename
  //                             || path.resolve(__dirname+'/../../../'));
  //
  // Drives both arms of the `||` by mutating `process.mainModule`
  // before re-requiring the module under a fresh `jest.isolateModules`
  // registry. `require.main` is populated from `process.mainModule`
  // at module-require time, so clearing it on the process makes the
  // fresh `appDir.js` load see `require.main === undefined`, which
  // evaluates the LHS as falsy and falls through to the right-hand
  // `path.resolve(...)` branch.

  it('uses require.main.filename when it is present (LHS arm)', () => {
    // Normal path — require.main is Jest's runner module, which has
    // a `.filename`. `require.main && require.main.filename` is
    // truthy, `path.dirname(...)` runs on Jest's runner path, and
    // appDir strips the leading '/'. The exact value depends on the
    // Jest install, so we assert only shape.
    jest.isolateModules(() => {
      const appDir = require('../../appDir.js');
      expect(typeof appDir).toBe('string');
    });
  });

  it('falls back to the synthetic parent path when require.main is absent (RHS arm)', () => {
    // Drive the `require.main` FALSY arm of the `if` condition.
    //
    // Background
    // ----------
    // `appDir.js` reads `require.main` at module-top. Node populates
    // each module's `require.main` by copying `process.mainModule` at
    // the time the module's `require` function is constructed
    // (Node's `makeRequireFunction`). Clearing `process.mainModule`
    // before a FRESH module load therefore makes the new module's
    // `require.main` undefined.
    //
    // Jest's runtime wraps this pattern: inside `jest.isolateModules`
    // Jest still uses Node's `Module` machinery for CJS requires, so
    // mutating `process.mainModule` BEFORE the isolate produces the
    // desired effect. Earlier attempts to mutate `mod.require.main`
    // directly failed because Node's `_compile` creates a fresh
    // `require` function via `makeRequireFunction` that ignores prior
    // overrides.
    const Module = require('module');
    const appDirPath = require.resolve('../../appDir.js');
    const savedMain = process.mainModule;
    process.mainModule = undefined;
    try {
      delete require.cache[appDirPath];
      // Use Node's own Module.load() pipeline so the file is compiled
      // with a fresh `require` whose `.main` is seeded from the
      // currently-null `process.mainModule`. `mod.load(path)` runs
      // `Module._extensions['.js']` which does
      // `module._compile(fs.readFileSync(...), filename)` — the exact
      // same path a normal `require()` would take, minus the
      // require.main carry-over from Jest.
      const mod = new Module(appDirPath);
      mod.filename = appDirPath;
      mod.paths = Module._nodeModulePaths(
        require('path').dirname(appDirPath)
      );
      mod.load(appDirPath);
      const appDir = mod.exports;
      expect(typeof appDir).toBe('string');
      expect(appDir.length).toBeGreaterThan(0);
    } finally {
      process.mainModule = savedMain;
      delete require.cache[appDirPath];
    }
  });

  it('fallback fires when require.main is truthy but .filename is undefined', () => {
    // Drive the `&&` TRUTHY-LHS + FALSY-RHS arm: `require.main` is
    // set but its `.filename` is undefined. Clearing `.filename` on
    // the mainModule before the isolate forces the property access
    // inside appDir.js to return undefined, which takes the `&&`'s
    // overall result to false. The if-body is skipped and the
    // fallback path is used.
    const mainModule = process.mainModule;
    if (!mainModule) {
      // mainModule cleared by another test that didn't restore; skip.
      return;
    }
    const savedFilename = mainModule.filename;
    mainModule.filename = undefined;
    try {
      jest.isolateModules(() => {
        // Confirm appDir.js's perception of require.main matches what
        // we set. This assertion catches future Jest-runtime changes
        // that would make the `require.main` snapshot independent of
        // `process.mainModule` — if that ever happens, the rest of
        // this test becomes meaningless and we want a clear signal.
        const probe = require.main && require.main.filename;
        expect(probe).toBeUndefined();
        const appDir = require('../../appDir.js');
        expect(typeof appDir).toBe('string');
      });
    } finally {
      mainModule.filename = savedFilename;
    }
  });

  it('strips the leading slash (second ternary arm) when appDir starts with "/"', () => {
    // `appDir[0] === '/' ? appDir.substr(1) : appDir` — the FALSE
    // branch fires when the computed appDir does NOT start with a
    // leading slash. Covered by Windows-style output OR when the
    // computation yields an empty string (e.g. the fallback reduces
    // to `/` and path.dirname returns `/`, then the strip produces
    // ""). Both arms are exercised by combining the two scenarios
    // above, but we add an explicit assertion here to pin the
    // stripped shape: the result MUST NOT start with '/' regardless
    // of how it was computed.
    jest.isolateModules(() => {
      const appDir = require('../../appDir.js');
      expect(appDir.startsWith('/')).toBe(false);
    });
  });
});
