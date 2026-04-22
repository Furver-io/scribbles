/**
 * @file Syntax highlighting for scribbles value serialization (stringify output).
 *
 * Domain: terminal readability for non-JSON scribbles shapes (Map{…}, ƒ(){-},
 * circular markers, etc.) without a fragile post-hoc JSON lexer.
 * Technical: maps semantic roles to {@link ANSI} foreground openers; segments end
 * with SGR 39 (default fg) so host terminal default text color returns after each
 * token without a full `\x1b[0m` reset that often snaps prose to palette white.
 */

const { ANSI } = require('./colors');

/**
 * Default role → ANSI color name map for syntax highlighting (typical terminals).
 */
const defaultSyntaxColorScheme = {
  bracket: 'white',
  comma: 'gray',
  colon: 'gray',
  typeName: 'brightMagenta',
  key: 'brightCyan',
  string: 'green',
  number: 'yellow',
  boolean: 'brightYellow',
  nullish: 'brightBlue',
  symbol: 'brightMagenta',
  regex: 'brightRed',
  function: 'cyan',
  arrayIndex: 'blue',
  circular: 'brightRed',
  truncation: 'magenta',
  identifierLabel: 'brightYellow',
  disambiguationPrefix: 'brightMagenta',
  /** Fallback when a role is missing from a user override */
  fallback: 'white',
  /** Post-`transform` segments (structure not re-parsed) */
  transformOutput: 'gray'
};

/**
 * Colorblind-oriented syntax palette: leans on brightness and hue separation
 * instead of red/green cues for distinct token classes.
 */
const syntaxColorblindScheme = {
  bracket: 'white',
  comma: 'dim',
  colon: 'dim',
  typeName: 'brightBlue',
  key: 'brightCyan',
  string: 'brightYellow',
  number: 'cyan',
  boolean: 'brightYellow',
  nullish: 'blue',
  symbol: 'brightMagenta',
  regex: 'brightRed',
  function: 'brightCyan',
  arrayIndex: 'blue',
  circular: 'brightRed',
  truncation: 'brightMagenta',
  identifierLabel: 'brightYellow',
  disambiguationPrefix: 'brightBlue',
  fallback: 'white',
  transformOutput: 'dim'
};

/**
 * Merge user `syntaxColorScheme` over defaults for the active accessibility mode.
 *
 * @param {boolean} colorblindMode
 * @param {Object} [userScheme]
 * @returns {Object} role → color name
 */
function mergeResolvedSyntaxScheme(colorblindMode, userScheme) {
  const base = colorblindMode
    ? { ...syntaxColorblindScheme }
    : { ...defaultSyntaxColorScheme };
  if (userScheme && typeof userScheme === 'object') {
    return { ...base, ...userScheme };
  }
  return base;
}

/**
 * Factory for role-based segments. Each call wraps with an SGR opener and {@link ANSI.fgDefault}.
 *
 * @param {Object} opts
 * @param {Object} opts.scheme - merged role → color name map
 * @returns {{ paint: function(string, string): string, scheme: Object }}
 */
function createSyntaxPainter(opts) {
  const scheme = opts.scheme || defaultSyntaxColorScheme;
  /**
   * @param {string} role - syntax role key
   * @param {string} text - literal segment (no nested ANSI expected from caller)
   * @returns {string}
   */
  function paint(role, text) {
    const colorName = scheme[role] || scheme.fallback;
    const code = ANSI[colorName];
    if (!code) return text;
    return code + text + ANSI.fgDefault;
  }
  return { paint, scheme };
}

/**
 * Paint a variable-name prefix and colon for the `{value}` column (ReadMe: `userData:`).
 *
 * @param {Object} painter - Syntax painter with `paint(role, text)`.
 * @param {string} name - extracted identifier (may include `users[0]` style)
 * @returns {string}
 */
function paintValueLabel(painter, name) {
  return painter.paint('identifierLabel', name) + painter.paint('colon', ':');
}

/**
 * Paint `String"…"` disambiguation for JSON-like string values.
 *
 * @param {Object} painter - Syntax painter with `paint(role, text)`.
 * @param {string} innerPlain - full `String"content"` plain string
 * @returns {string}
 */
function paintStringDisambiguation(painter, innerPlain) {
  if (!innerPlain.startsWith('String"')) {
    return painter.paint('string', innerPlain);
  }
  const rest = innerPlain.slice('String'.length);
  return painter.paint('disambiguationPrefix', 'String') + painter.paint('string', rest);
}

module.exports = {
  defaultSyntaxColorScheme,
  syntaxColorblindScheme,
  mergeResolvedSyntaxScheme,
  createSyntaxPainter,
  paintValueLabel,
  paintStringDisambiguation
};
