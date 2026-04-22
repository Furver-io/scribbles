/**
 * @file Group bracket and colored-tree prefix for `body.toString` in `scribble.js`
 *
 * Domain: when `pretty.groupBrackets` is on, log lines for group markers and
 * content inside groups are prefixed for a tree-shaped terminal layout. Optional
 * 24-bit per-depth color uses `formatColoredGroupBracketPrefix` from `colors.js`.
 */
const {
  colorize,
  formatColoredGroupBracketPrefix,
  groupBracketTailOpen,
  ANSI
} = require('./colors');

/**
 * Paint only the template text before the `{value}` column with the log-level color.
 *
 * Domain: when syntax highlighting is on, the value substring carries its own SGR; a
 * whole-line `colorize()` would clash with inner resets. Message/path/time should
 * still match non-syntax lines at the same level (explicit `colorScheme[level]`), not
 * the host “default” fg that often reads as white next to green `info` rows.
 *
 * Technical: `outputValue` is the exact `{value}` substitution from `scribble.js`;
 * we split `compiledLine` at its first occurrence. If it is missing or at column 0,
 * return `compiledLine` unchanged.
 *
 * @param {string} compiledLine
 * @param {string} levelColor
 * @param {string} [outputValue]
 * @returns {string}
 */
function applyLevelColorToPlainPrefixOnly(compiledLine, levelColor, outputValue) {
  if (!levelColor || !outputValue || typeof outputValue !== 'string') {
    return compiledLine;
  }
  const vStart = compiledLine.indexOf(outputValue);
  if (vStart <= 0) {
    return compiledLine;
  }
  return colorize(compiledLine.slice(0, vStart), levelColor) + compiledLine.slice(vStart);
}

/**
 * Build plain and/or colored prefixes for a group-related log line (stdOut only).
 *
 * @param {Object} config - Scribbles config (pretty, colors, colorScheme, colorblindMode).
 * @param {string} level - Log level.
 * @param {number} groupLevel - Nesting depth from `body.context.groupLevel`.
 * @param {string} compiledLine - Already compiled template body line.
 * @param {string} [levelColor] - Named color from `colorScheme[level]` when not using the tree.
 * @param {string} [outputValue] - Rendered `{value}` column (detect ANSI only here, not whole line).
 * @returns {string} Full line to write to stdOut
 */
function formatGroupLogLineForStdOut(
  config,
  level,
  groupLevel,
  compiledLine,
  levelColor,
  outputValue
) {
  // When the `{value}` column uses syntax SGR, skip a single outer `colorize()` around
  // the full line (inner `\x1b[39m` / token colors break that). We still paint the
  // plain prefix (everything before the rendered `outputValue`) with `colorScheme[level]`.
  const valueHasSyntaxAnsi =
    typeof outputValue === 'string' && outputValue.indexOf('\x1b[') !== -1;
  const useSyntaxPrefixLevelColor =
    config.pretty &&
    config.pretty.syntaxHighlight &&
    config.colors &&
    valueHasSyntaxAnsi;

  let groupPrefix = '';
  let treePrefixColored = null;
  const useColoredTree =
    config.pretty &&
    config.pretty.groupBrackets &&
    config.colors &&
    config.colorScheme;

  if (groupLevel > 0 || ['group', 'groupCollapsed', 'groupEnd'].includes(level)) {
    if (config.pretty && config.pretty.groupBrackets) {
      if (useColoredTree) {
        treePrefixColored = formatColoredGroupBracketPrefix(
          level,
          groupLevel,
          !!config.colorblindMode
        );
      } else if (level === 'group' || level === 'groupCollapsed') {
        groupPrefix = '⎜'.repeat(Math.max(0, groupLevel - 1)) + '┌ ';
      } else if (level === 'groupEnd') {
        groupPrefix = '⎜'.repeat(groupLevel) + '└ ';
      } else {
        groupPrefix = '⎜'.repeat(groupLevel) + ' '.repeat(Math.max(1, groupLevel));
      }
    } else {
      if (!['group', 'groupCollapsed', 'groupEnd'].includes(level)) {
        groupPrefix = '  '.repeat(groupLevel);
      }
    }
  }

  if (treePrefixColored !== null) {
    if (level === 'group' || level === 'groupCollapsed' || level === 'groupEnd') {
      const tailOpen = groupBracketTailOpen(
        level,
        groupLevel,
        !!config.colorblindMode
      );
      return treePrefixColored + tailOpen + compiledLine + ANSI.reset;
    }
    const lc = levelColor;
    let lineBody = compiledLine;
    if (config.colors && config.colorScheme && lc) {
      lineBody = useSyntaxPrefixLevelColor
        ? applyLevelColorToPlainPrefixOnly(compiledLine, lc, outputValue)
        : colorize(compiledLine, lc);
    }
    return treePrefixColored + lineBody;
  }

  let formattedOutput = groupPrefix + compiledLine;
  if (config.colors && config.colorScheme) {
    const lc = levelColor;
    if (lc) {
      formattedOutput = useSyntaxPrefixLevelColor
        ? groupPrefix + applyLevelColorToPlainPrefixOnly(compiledLine, lc, outputValue)
        : colorize(groupPrefix + compiledLine, lc);
    }
  }
  return formattedOutput;
}

module.exports = { formatGroupLogLineForStdOut };
