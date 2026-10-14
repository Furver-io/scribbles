/**
 * @file Argument handling for the traced `http` / `https` request wrappers
 *
 * Domain context
 * --------------
 * Node's client functions accept several call shapes:
 *
 *     request(url)
 *     request(url, callback)
 *     request(url, options, callback)
 *     request(options, callback)
 *
 * where `url` is a string or a `URL`, and `options.headers` is an object or
 * an array (pairs, or a flat name/value list). The wrappers in
 * `hijacker.js` must accept every shape, add the active trace's headers, and
 * hand the original function the same shape the developer used. This file is
 * that translation, kept apart so `hijacker.js` stays about installing
 * wrappers.
 *
 * Technical context
 * -----------------
 * - Never mutates what the caller passed in: a developer's options object (or
 *   `URL`) is theirs and may be reused for the next call, so the headers go on
 *   a copy.
 * - Caller headers win over injected ones: `trace.headers(custom)` merges the
 *   caller's headers over the trace's, so an explicit `traceparent` the
 *   developer wrote is respected.
 * - Outside a trace `trace.headers()` returns just the caller's headers, so no
 *   branch here needs to know whether a trace is active.
 */

'use strict';

/**
 * Turns the `headers` option of an http call into a plain object.
 *
 * @param {Object|Array|undefined} headers - object, array of `[name, value]`
 *        pairs, flat `[name, value, name, value]` array, or nothing
 * @returns {Object} the same headers as a plain object
 */
function headersToObject(headers) {
  if (!Array.isArray(headers)) {
    return headers || {}
  }
  const pairs = Array.isArray(headers[0])
    ? headers
    : Array.from({ length: headers.length / 2 }, (_, i) => [headers[2 * i], headers[2 * i + 1]])
  return Object.fromEntries(pairs)
}

/**
 * Normalises the arguments of an http/https client call and adds the trace
 * headers to the options.
 *
 * @param {Object} scribbles - the scribbles instance (for `trace.headers`)
 * @param {Array} args - the arguments the developer passed to
 *        `request(...)` / `get(...)`
 * @returns {Array} arguments to apply to the original function, in the same
 *          call shape as `args`, with trace headers on a copy of the options
 */
function withTraceHeaders(scribbles, args) {
  let [url, options, callback] = args

  if ('function' === typeof options) {
    callback = options
    options = undefined
  }

  // `request(options, callback)`: the first argument is the options.
  if ('object' === typeof url && !(url instanceof URL)) {
    options = url
    url = undefined
  }

  const traced = Object.assign({}, options, {
    headers: scribbles.trace.headers(headersToObject(options && options.headers))
  })

  return undefined === url ? [traced, callback] : [url, traced, callback]
}

module.exports = { withTraceHeaders }
