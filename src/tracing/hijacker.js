/**
 * @file HTTP/HTTPS request hijacker for automatic trace header injection
 *
 * Domain context
 * --------------
 * When a user opts into outbound header propagation via
 * `scribbles.config({ headers: [...] })` or `headersMapping`, Scribbles
 * wraps Node's `http.request` / `https.request` so that every outgoing
 * request gets the W3C traceparent / tracestate plus any configured
 * forwarded headers injected on the way out. This is the glue that
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

const { withTraceHeaders } = require('./outbound-args')

// Registry keys for the true native request functions. Stored on the
// http / https core modules themselves so they survive Jest's
// per-file module-registry reset.
const HTTP_ORIGINAL = Symbol.for('scribbles.http.originalRequest')
const HTTPS_ORIGINAL = Symbol.for('scribbles.https.originalRequest')

// Marker attached to every wrapper this file produces — see "Technical
// context" in the file header for why we expose it.
const WRAPPER_MARKER = Symbol.for('scribbles.hijacker.wrapper')

// Cache the true native functions exactly once per process.
//
// The prior implementation of this block contained a ternary
// (`http.request[WRAPPER_MARKER] ? http.request : http.request.bind(http)`)
// intended to "walk off" an existing wrapper if some adversarial preload
// had replaced `http.request` with its own wrapper BEFORE Scribbles
// ever loaded. That branch is unreachable from the public interface:
// this `if` guard only runs on the first Scribbles boot in the process,
// and on the first boot `http.request` is the native function (no
// wrapper marker present) because Scribbles is the only codepath that
// stamps `WRAPPER_MARKER`. Removed per the dead-code rule; the commit
// preserving the context is recorded in git history. Should a real
// scenario ever require walking a pre-existing wrapper chain, the
// resurrection is a few lines and can cite the history.
if (!http[HTTP_ORIGINAL]) {
  http[HTTP_ORIGINAL] = http.request.bind(http)
}
if (!https[HTTPS_ORIGINAL]) {
  https[HTTPS_ORIGINAL] = https.request.bind(https)
}

/**
 * Wraps http.request and https.request to inject trace headers.
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
   * Creates a wrapper function for http/https request that injects
   * trace headers when the live config asks for them, or passes the
   * call through untouched otherwise.
   *
   * @param {Function} originalRequest - The TRUE native request
   *        function pulled from the registry above.
   * @returns {Function} Wrapped request function.
   */
  function createWrapper(originalRequest) {
    /**
     * Drop-in replacement for `http.request` / `https.request`. Accepts
     * the same `(url | options, [options | callback], [callback])`
     * overload set Node exposes, normalises it, asks `scribbles.trace`
     * for the header block to inject, and forwards to the original.
     *
     * When `config.headers` and `config.headersMapping` are both absent
     * we short-circuit to the original function untouched, which is
     * how "user disabled the feature at runtime" resolves to
     * zero-overhead passthrough.
     *
     * @param {...*} args - `(url | options, [options | callback], [callback])`
     * @returns {import('http').ClientRequest}
     */
    function requestWrapper(...args) {

      if (!config || (!config.headers && !config.headersMapping)) {
        return originalRequest(...args)
      }

      return originalRequest(...withTraceHeaders(scribbles, args))
    }
    // Tag the wrapper so subsequent evaluations of this module can
    // recognise an existing wrapper and avoid capturing it as "the
    // original" (see the defensive branch in the module-level cache
    // block above).
    requestWrapper[WRAPPER_MARKER] = true
    return requestWrapper
  }

  http.request = createWrapper(http[HTTP_ORIGINAL])
  https.request = createWrapper(https[HTTPS_ORIGINAL])
}

module.exports = hijacker
