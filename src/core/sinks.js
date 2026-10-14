/**
 * @file Log destinations (stdOut / dataOut): resolution, validation and failure isolation
 *
 * Domain context
 * --------------
 * `stdOut` receives the formatted line, `dataOut` receives the structured entry. Both are
 * supplied by the host application and can fail at any time (closed pipe, vendor outage,
 * formatter bug). A logging call is a side note in business code, so a failing destination
 * must never throw into the caller. The operator learns about it through the optional
 * `onSinkError(error, sink, entry)` hook; without a hook the first failure of each
 * destination function is written to stderr once, so a dead log shipper is not invisible
 * but a permanently broken one cannot flood stderr either.
 *
 * A `stdOut` object that has no function for an enabled level (and no `log` fallback) is a
 * setup mistake, not a runtime failure: `assertStdOutCoversLevels` rejects it when the
 * options are applied. Reserved levels that are not in `levels` (`timer`, `group`, ...) can
 * only be checked when they are logged; those misses are reported like any sink failure.
 *
 * Technical context
 * -----------------
 * - Destinations the operator was already told about are remembered by function identity
 *   in a WeakSet, so replacing the destination re-arms the report and nothing is retained.
 * - The destination is marked as reported BEFORE writing to stderr, so a `console.error`
 *   that is itself routed through scribbles cannot recurse.
 * - Every stage (hook, stderr write) is guarded: reporting can never throw either.
 */

const alreadyReported = new WeakSet();

/**
 * Picks the function that prints a line for `level`.
 * Order: `stdOut[level]`, `stdOut` itself when it is a function, then `stdOut.log`.
 * @param {Function|Object} stdOut - The configured `stdOut` (truthy).
 * @param {string} level - Log level of the entry.
 * @returns {Function|undefined} The printer, or undefined when none applies.
 */
function resolveStdOut(stdOut, level) {
  if ('function' === typeof stdOut[level]) return stdOut[level];
  if ('function' === typeof stdOut) return stdOut;
  if ('function' === typeof stdOut.log) return stdOut.log;
  return undefined;
}

/**
 * Throws when an enabled level has no way to be printed by the `stdOut` object.
 * @param {Function|Object|null|undefined} stdOut - Effective `stdOut` after the new options.
 * @param {string[]} levels - Effective level names, highest priority first.
 * @param {string} logLevel - Effective minimum level (must be in `levels`).
 * @returns {void}
 */
function assertStdOutCoversLevels(stdOut, levels, logLevel) {
  if (!stdOut) return;
  levels.slice(0, levels.indexOf(logLevel) + 1).forEach((level) => {
    if (!resolveStdOut(stdOut, level)) {
      throw new Error(`${level} was not found on stdOut`);
    }
  });
}

/**
 * Tells the operator that a destination failed. Never throws.
 * @param {Object} config - The live scribbles config (reads `onSinkError`).
 * @param {Function} sinkFn - The destination function that failed, for once-only reporting.
 * @param {Error} err - What the destination threw.
 * @param {string} sink - `'stdOut'` or `'dataOut'`.
 * @param {Object} body - The log entry being delivered.
 * @returns {void}
 */
function reportSinkError(config, sinkFn, err, sink, body) {
  try {
    if ('function' === typeof config.onSinkError) {
      config.onSinkError(err, sink, body);
    } else if (!alreadyReported.has(sinkFn)) {
      alreadyReported.add(sinkFn);
      console.error(`scribbles: ${sink} failed and the entry was not delivered: ${err}`
        + ' (further failures of this destination are not reported; set onSinkError to handle them)');
    }
  } catch (ignored) {
    // A broken hook or console must not break the caller either.
  }
}

/**
 * Runs one destination; a throw is reported instead of propagating.
 * @param {Object} config - The live scribbles config.
 * @param {string} sink - `'stdOut'` or `'dataOut'`.
 * @param {Function} sinkFn - Destination to call with the entry (or line source).
 * @param {Function} deliver - Performs the call; may throw.
 * @param {Object} body - The log entry being delivered.
 * @returns {void}
 */
function guarded(config, sink, sinkFn, deliver, body) {
  try {
    deliver();
  } catch (err) {
    reportSinkError(config, sinkFn, err, sink, body);
  }
}

/**
 * Delivers one entry to the configured destinations. Never throws.
 * @param {Object} config - The live scribbles config.
 * @param {string} level - Log level of the entry.
 * @param {Object} body - The structured log entry.
 * @returns {void}
 */
function deliverToSinks(config, level, body) {
  if (config.stdOut) {
    const printer = resolveStdOut(config.stdOut, level);
    guarded(config, 'stdOut', printer || config.stdOut, () => {
      if (!printer) throw new Error(`${level} was not found on stdOut`);
      printer(body.toString());
    }, body);
  }
  if (config.dataOut) {
    guarded(config, 'dataOut', config.dataOut, () => config.dataOut(body), body);
  }
}

module.exports = { resolveStdOut, assertStdOutCoversLevels, deliverToSinks };
