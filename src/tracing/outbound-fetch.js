/**
 * @file Argument handling for the traced global `fetch` wrapper
 *
 * Domain context
 * --------------
 * `fetch(input, init)` takes `input` as a URL string, a `URL` or a `Request`,
 * and `init.headers` as an object, a `Headers` instance or an array of pairs.
 * The wrapper in `hijacker.js` must add the active trace's headers without
 * changing anything else about the call: not the method, the body, the
 * signal, nor the headers the developer wrote.
 *
 * Technical context
 * -----------------
 * - Uses the platform `Headers` class to read every headers shape the same
 *   way, and never mutates the caller's `Headers`, `Request` or `init`.
 * - Follows `fetch`'s own rule for a `Request` plus `init`: `init.headers`
 *   REPLACES the request's headers, so the trace is added to whichever of the
 *   two the call would use.
 * - Headers the caller already set win over injected ones (case-insensitive,
 *   so `Traceparent` blocks `traceparent`), matching the http wrappers.
 * - Outside a trace `trace.headers()` is empty and the call is returned
 *   untouched.
 * - `input && input.headers` is guarded so `fetch()` with no arguments
 *   reaches the native `fetch` and rejects there, instead of throwing
 *   synchronously from the wrapper.
 */

'use strict';

/**
 * Adds the trace headers to the arguments of a `fetch` call.
 *
 * @param {Object} scribbles - the scribbles instance (for `trace.headers`)
 * @param {Array} args - the arguments the developer passed to `fetch(...)`
 * @returns {Array} arguments to apply to the native `fetch`: the original
 *          `args` outside a trace, otherwise `[input, init]` where `init` is a
 *          copy carrying the merged `headers`
 */
function fetchWithTraceHeaders(scribbles, args) {
  const [input, init] = args
  const traceHeaders = Object.entries(scribbles.trace.headers())

  if (0 === traceHeaders.length) {
    return args
  }

  const headers = new Headers((init && init.headers) || (input && input.headers))
  traceHeaders.forEach(([name, value]) => {
    if (!headers.has(name)) {
      headers.set(name, value)
    }
  })

  return [input, Object.assign({}, init, { headers })]
}

module.exports = { fetchWithTraceHeaders }
