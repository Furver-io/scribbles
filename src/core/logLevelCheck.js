/**
 * @file Rejects a `logLevel` that is not one of the configured `levels`
 *
 * Domain context
 * --------------
 * `logLevel` picks the lowest-priority level that is still logged. A value that is not in
 * `levels` (`LOG_LEVEL=warning` instead of `warn`, a typo, or a custom `levels` list that no
 * longer contains the previous `logLevel`) used to turn EVERY log call into a silent no-op,
 * errors included. It is now refused with an Error that names the bad value and the valid
 * ones, the same way a reserved level name is refused.
 *
 * Technical context
 * -----------------
 * - Runs at the top of `config()` against the values the call WOULD produce, before anything
 *   is changed, so a rejected call leaves the previous working setup in place.
 * - The `LOG_LEVEL` environment variable is read into the defaults when `config.js` loads and
 *   `index.js` calls `config()` once at load, so a bad `LOG_LEVEL` makes `require('scribbles')`
 *   throw. That is deliberate: the app stops at its first start instead of running blind.
 * - Matching is exact and case-sensitive, like the level names themselves.
 */

/**
 * Throws when `logLevel` is not in `levels`.
 * @param {string[]} levels - Effective level names, highest priority first.
 * @param {string} logLevel - Effective minimum level to log.
 * @returns {void}
 */
function assertKnownLogLevel(levels, logLevel) {
  if (-1 === levels.indexOf(logLevel)) {
    throw new Error(`Unknown logLevel "${logLevel}". It must be one of the configured levels: `
      + `${levels.join(', ')}. Check config({ logLevel }), the LOG_LEVEL environment variable `
      + 'and config({ levels }).');
  }
}

module.exports = { assertKnownLogLevel };
