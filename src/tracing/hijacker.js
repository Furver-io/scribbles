/**
 * @file HTTP/HTTPS request hijacker for automatic trace header injection
 *
 * Domain context
 * --------------
 * When a user opts into outbound header propagation via
 * `scribbles.config({ headers: [...] })` or `headersMapping`, Scribbles
 * wraps Node's `http.request`, `http.get`, `https.request` and
 * `https.get` so that every outgoing request made inside a trace gets the
 * W3C traceparent / tracestate plus any configured forwarded headers
 * injected on the way out. Outside a trace nothing is injected. This is the glue that
 * makes distributed tracing work seamlessly across microservices
 * without the caller having to thread headers by hand.
 *
 * Idempotent install + the "stale-wrapper" bug it prevents
 * --------------------------------------------------------
 * Prior to v2.0.0 this file captured the original request function at
 * MODULE EVAL time:
 *
 *     const reqHttp = http.request.bind(http);
 *
 * That was fine on a clean Node process, but Jest's per-test-file module
 * reset re-evaluates this file for every test file. By the time the
 * SECOND file's evaluation happens, `http.request` has already been
 * replaced with v1's wrapper from the FIRST boot — so `reqHttp` captured
 * a wrapper, not the native function. When the new wrapper's early-
 * return path called `originalRequest(...)` it therefore ran the OLD
 * wrapper, which closed over the OLD `config` reference (still holding
 * truthy `headers` from the first file) and injected a malformed
 * `traceparent: "00-undefined-undefined-01"` header on requests that
 * should have passed through untouched. The symptom was a flaky
 * `__tests__/32-hijacker-http-request.test.js` suite that only failed
 * when run alongside other test files.
 *
 * The fix below stores the true native request function on the `http` /
 * `https` modules themselves, keyed by `Symbol.for(...)`. The http/https
 * core modules are NOT reset by Jest, so the stored original survives
 * module reloads. Every subsequent hijacker() call rewraps the same
 * native original, no matter how many times the hijacker module has
 * been re-evaluated.
 *
 * What cannot be covered
 * -----------------------
 * The wrappers replace the properties on the `http` / `https` modules, so
 * code that reads those properties AFTER scribbles loads is covered:
 * `http.get(...)`, `const { request } = require('http')` and, on Node,
 * `import { get } from 'node:http'` (refreshed with
 * `syncBuiltinESMExports`). A function copied out of the module BEFORE
 * scribbles loads is the native function and cannot be reached. Bun does
 * not refresh ES named imports of built-ins. Installation happens once from
 * `index.js`, so `hijack: false` only has an effect from a package.json
 * read before load (see the ReadMe).
 *
 * Technical context
 * -----------------
 * - `Symbol.for(...)` is used rather than a private Symbol so the key
 *   survives realm/duplicate-module edge cases (the hijacker module
 *   being loaded from two separate `node_modules/scribbles` copies,
 *   for example — rare, but not impossible in monorepos). All Scribbles
 *   registry symbols follow this `scribbles.<purpose>` naming scheme.
 * - The per-wrapper `WRAPPER_MARKER` flag is informational: it lets
 *   test infrastructure or health checks detect that a function IS
 *   our wrapper rather than a native or third-party interceptor,
 *   without relying on `.toString()` inspection.
 * - The passthrough check `!config.headers && !config.headersMapping`
 *   is evaluated on EACH request call (late binding), so toggling the
 *   config at runtime takes effect immediately with no re-install.
 */

const http = require('http')
const https = require('https')

const { syncBuiltinESMExports } = require('module')

const { withTraceHeaders } = require('./outbound-args')
const { fetchWithTraceHeaders } = require('./outbound-fetch')

// Marker attached to every wrapper this file produces — see "Technical
// context" in the file header for why we expose it.
const WRAPPER_MARKER = Symbol.for('scribbles.hijacker.wrapper')

// Registry key suffixes for the true native functions, which are stored on
// the http / https core modules themselves (so they survive Jest's per-file
// module-registry reset) under `Symbol.for('scribbles.<protocol>.<suffix>')`.
const ORIGINAL_KEY = { request: 'originalRequest', get: 'originalGet' }

/**
 * Returns the TRUE native `request` / `get` function of a core module,
 * caching it on the module the first time any boot of scribbles sees it.
 * Later boots (a re-evaluated module under Jest, a second copy in
 * `node_modules`) find the cached native and never capture a wrapper.
 *
 * The prior implementation contained a ternary intended to "walk off" a
 * wrapper some adversarial preload had installed before Scribbles loaded.
 * That branch was unreachable from the public interface (Scribbles is the
 * only code that stamps `WRAPPER_MARKER`) and was removed per the dead-code
 * rule; git history keeps the context should a real scenario need it.
 *
 * @param {Object} core - the `http` or `https` module
 * @param {string} protocol - `'http'` or `'https'`, part of the registry key
 * @param {string} method - `'request'` or `'get'`
 * @returns {Function} the native function, bound to `core`
 */
function nativeOf(core, protocol, method) {
  const key = Symbol.for(`scribbles.${protocol}.${ORIGINAL_KEY[method]}`)
  if (!core[key]) {
    core[key] = core[method].bind(core)
  }
  return core[key]
}

// Registry key for the true native global `fetch`, kept on `globalThis`
// for the same reason the http / https natives are kept on their modules.
const FETCH_ORIGINAL = Symbol.for('scribbles.global.originalFetch')

/**
 * Returns the TRUE native global `fetch`, caching it on `globalThis` the
 * first time any boot of scribbles sees it, or `undefined` on a runtime
 * with no global fetch (Node 16 and older).
 *
 * @returns {(Function|undefined)} the native `fetch`, if the runtime has one
 */
function nativeFetch() {
  if (!globalThis[FETCH_ORIGINAL] && 'function' === typeof globalThis.fetch) {
    globalThis[FETCH_ORIGINAL] = globalThis.fetch
  }
  return globalThis[FETCH_ORIGINAL]
}

/**
 * Wraps http/https `request` and `get`, and the global `fetch`, to inject
 * trace headers.
 *
 * Every invocation installs a fresh wrapper that closes over the given
 * `config`. The wrapper is idempotent w.r.t. the native originals:
 * repeated calls always rewrap the cached true original (see file
 * header), never a previous wrapper.
 *
 * @param {object} scribbles - The scribbles instance (used for
 *        `scribbles.trace.headers()` at request time).
 * @param {object} config - Live configuration object. The wrapper
 *        re-reads `config.headers` / `config.headersMapping` on every
 *        request so runtime config toggles take effect immediately.
 * @returns {void}
 */
function hijacker(scribbles, config) {

  /**
   * Whether the live config currently asks for header injection. Read on
   * every call so runtime config changes apply immediately.
   *
   * @returns {boolean} true when `headers` or `headersMapping` is set
   */
  function injecting() {
    return Boolean(config && (config.headers || config.headersMapping))
  }

  /**
   * Creates a wrapper function for http/https request or get that injects
   * trace headers when the live config asks for them, or passes the
   * call through untouched otherwise.
   *
   * @param {Function} originalRequest - The TRUE native request
   *        function pulled from the registry above.
   * @returns {Function} Wrapped request function.
   */
  function createWrapper(originalRequest) {
    /**
     * Drop-in replacement for `http.request` / `http.get` (and the https
     * pair). Accepts the same `(url | options, [options | callback],
     * [callback])` overload set Node exposes, normalises it, asks
     * `scribbles.trace` for the header block to inject, and forwards to
     * the original. With injection off it forwards untouched, which is
     * how "user disabled the feature at runtime" resolves to
     * zero-overhead passthrough.
     *
     * @param {...*} args - `(url | options, [options | callback], [callback])`
     * @returns {import('http').ClientRequest}
     */
    function requestWrapper(...args) {
      return originalRequest(...(injecting() ? withTraceHeaders(scribbles, args) : args))
    }
    // Tag the wrapper so test infrastructure can tell it from a native
    // function (see "Technical context" in the file header).
    requestWrapper[WRAPPER_MARKER] = true
    return requestWrapper
  }

  /**
   * Creates the wrapper for the global `fetch`. Same gate as the http
   * wrappers; the native function's own properties (Bun's
   * `fetch.preconnect`) are carried over so code using them keeps working.
   *
   * @param {Function} originalFetch - The TRUE native `fetch`.
   * @returns {Function} Wrapped fetch function.
   */
  function createFetchWrapper(originalFetch) {
    /**
     * Drop-in replacement for the global `fetch`.
     *
     * @param {...*} args - `(input, [init])` as for `fetch`
     * @returns {Promise<Response>}
     */
    function fetchWrapper(...args) {
      return originalFetch(...(injecting() ? fetchWithTraceHeaders(scribbles, args) : args))
    }
    fetchWrapper[WRAPPER_MARKER] = true
    return Object.assign(fetchWrapper, originalFetch)
  }

  http.request = createWrapper(nativeOf(http, 'http', 'request'))
  http.get = createWrapper(nativeOf(http, 'http', 'get'))
  https.request = createWrapper(nativeOf(https, 'https', 'request'))
  https.get = createWrapper(nativeOf(https, 'https', 'get'))

  const fetchOriginal = nativeFetch()
  if (fetchOriginal) {
    globalThis.fetch = createFetchWrapper(fetchOriginal)
  }

  // ES modules that already imported `node:http` hold a snapshot of the
  // named exports (`import { get } from 'node:http'`); this refreshes it so
  // named imports see the wrappers too. (Bun ignores the call.)
  syncBuiltinESMExports()
}

module.exports = hijacker
