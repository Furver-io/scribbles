/**
 * @file Distributed tracing functions
 *
 * Binds `scribbles.trace(opts, callback)` to an async-context scope so
 * every log call — synchronous or after any number of `await`s — can
 * read the active trace's traceparent / tracestate / spanId.
 *
 * Context propagation uses `AsyncLocalStorage` via `./namespace.js`.
 * The prior `@ashleyw/cls-hooked`-based path lost context across
 * `await` on Bun 1.3 because Bun's async_hooks lifecycle does not
 * trigger cls-hooked's init/before/after callbacks reliably for
 * Promise continuations. AsyncLocalStorage works correctly on both
 * Node (>=16.4) and Bun (>=1.0), so the migration is the unblocker for
 * the integrator-reported "traceId lost after first await" issue.
 */

'use strict';

const crypto = require('crypto');

const config = require('../core/config');
const { deepMerge } = require('../utils/helpers');
const { parceTracestate, hashTracestate } = require('../utils/utils');
const { store } = require('./namespace');

const tracestateLookup = new Map();

// No `g` (or `y`) flag: such a regex keeps `lastIndex` between `.test()` calls,
// which made every second parse of the same traceparent fail.
const regxTraceparent = /[\d\w]{2}-[\d\w]{32}-[\d\w]{16}-[\d\w]{02}/

/**
 * Creates a trace function with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.cuidPrefix - Object with get() method for prefix
 * @param {Object} deps.traceCount - Object with value and increment()
 * @param {Object} deps.gitValues - Git info
 * @param {Function} deps.myNamespace - Namespace function
 * @returns {Function} The trace function
 */
function createTrace(deps) {
  const { cuidPrefix, traceCount, gitValues, myNamespace } = deps;

  /**
   * Creates a trace context for distributed tracing
   * @param {Object|string|Function} opts - Trace options, label, or callback
   * @param {Function} [next] - Callback run within the trace context. It is
   *   called with the span id string first (the long-documented argument) and
   *   a `{ traceId, spanId }` context object second.
   * @returns {*} Whatever `next` returns, untouched: a returned promise is
   *   returned as-is, so async handlers' results and rejections reach the caller.
   */
  function trace(opts, next) {

    let traceVals = { logs: [] };

    if ('object' === typeof opts) {
      traceVals.headers = opts.headers;
      traceVals.url = opts.url;
      traceVals.path = opts.path;
      traceVals.query = opts.query;
      traceVals.params = opts.params;
      traceVals.method = opts.method;
      let spanLabel = opts.spanLabel

      if (opts.traceId) {
        if (regxTraceparent.test(opts.traceId)) {
          const [version, traceId, parentId, flag] = opts.traceId.split('-')
          traceVals = { version, traceId, parentId, flag }
        } else {
          traceVals.traceId = opts.traceId
        }
      }
      traceVals.spanLabel = opts.spanLabel

      traceVals.tracestate = 'string' === typeof opts.tracestate
        && "" !== opts.tracestate ? parceTracestate(opts.tracestate)
        : opts.tracestate
    } else if ('string' === typeof opts) {

      traceVals.spanLabel = opts
    } else if ('function' === typeof opts) {
      next = opts;
    }

    if (!traceVals.traceId) {
      traceVals.traceId = crypto.randomBytes(16).toString('hex');
    }

    if (!traceVals.tracestate) {
      traceVals.tracestate = []
    }

    traceVals.spanId = cuidPrefix.get() + ("00000000" + traceCount.value.toString(16)).slice(-9)
    traceVals.span64 = Buffer.from(traceVals.spanId, 'hex').toString('base64').slice(0, -1)

    traceCount.increment();

    // Enter the trace's async-context scope. Every call to
    // `myNamespace()('traceVals')` from here on — including those made
    // inside async continuations of `next` — resolves to the same
    // `traceVals` object, because `AsyncLocalStorage` threads the store
    // through Promise microtasks, setImmediate, setTimeout, etc. on
    // both Node and Bun.
    //
    // The store is wrapped in `{ traceVals }` rather than set to
    // `traceVals` directly so that the key-addressed reader exposed by
    // `namespace.myNamespace()` — `correlaterValue('traceVals')` —
    // keeps its pre-AsyncLocalStorage v1 contract: every reader call
    // site (trace.headers + scribble.js) looks up the `traceVals` key,
    // which the cls-hooked backend stored under that exact name. The
    // wrapping is what lets the migration be a drop-in replacement for
    // every existing callsite without a cascading rewrite.
    return store.run({ traceVals }, () => next(
      traceVals.spanId,
      { traceId: traceVals.traceId, spanId: traceVals.spanId }
    ))
  } // END trace

  /**
   * Gets trace context headers for W3C Trace Context propagation
   * @param {Object} [customHeader] - Custom headers to merge
   * @returns {Object} Headers object with traceparent and tracestate
   */
  trace.headers = function traceContext(customHeader) {

    const correlaterValue = myNamespace()

    const { traceId, spanId, span64, tracestate, version, flag, headers } = correlaterValue('traceVals') || {};

    let tracestateValue = (tracestate || []).filter(span => config.vendor !== span.key)
      .reduce((arr, { key, value }) => {
        arr.push(`${key}=${value}`);
        return arr;
      }, [`${config.vendor}=${span64}`]).slice(0, 32);

    // `tracestateValue` always has at least one element at this point —
    // the reduce above seeds it with `[`${config.vendor}=${span64}`]`
    // before folding in any inbound tracestate entries. The previous
    // `&& tracestateValue.length > 0` defensive guard was therefore
    // dead and was removed per CASE's dead-code rule.
    if (config.edgeLookupHash) {
      const fullTracestate = tracestateValue.join();
      const hash = 'h:' + hashTracestate(tracestate || []);
      tracestateLookup.set(hash, fullTracestate);
      tracestateValue = hash;
    } else {
      tracestateValue = tracestateValue.join();
    }

    // `gitValues` is always an object (see `src/system/getGitStatus.js`
    // — either the resolved git metadata or the `{hash:"",repo:"",
    // branch:""}` fallback), so the prior `gitValues && gitValues.hash`
    // defensive guard's falsy arm was unreachable. Simplified to the
    // direct property access per CASE's dead-code rule.
    return deepMerge(Object.assign({
      "x-git-hash": gitValues.hash || undefined,
      traceparent: `${version || '00'}-${traceId}-${spanId}-${flag || '01'}`,
      tracestate: tracestateValue
    }, headers || {}), customHeader)
  } // END traceContext

  /**
   * Looks up the original tracestate from a hash
   * @param {string} hash - The hash to look up
   * @returns {string|undefined} The original tracestate or undefined
   */
  trace.lookupTracestate = function(hash) {
    return tracestateLookup.get(hash);
  } // END lookupTracestate

  return trace;
}

module.exports = { createTrace };
