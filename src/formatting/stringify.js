/**
 * @file Public entry for value stringification (pretty-printed, optional syntax colors).
 *
 * Domain: log `{value}` column and stringify tests import this module.
 * Technical: implementation lives in {@link ./stringifyImpl}; colors activate when
 * `options.__syntaxPainter` is injected (see `scribble.js` + config).
 */

const { stringify } = require('./stringifyImpl');

module.exports = stringify;
