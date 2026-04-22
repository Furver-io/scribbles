/**
 * @file ANSI color utilities for terminal output
 */

// ANSI escape codes
const ANSI = {
  reset: '\x1b[0m',
  /** SGR 39: default foreground only (does not clear bold/dim like {@link ANSI.reset}). */
  fgDefault: '\x1b[39m',
  // Standard colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  // Styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m'
};

// Default color scheme mapping log levels to colors
const defaultColorScheme = {
  error: 'red',
  warn: 'yellow',
  log: 'cyan',
  info: 'green',
  debug: 'gray',
  // Group colors
  group: 'magenta',
  groupCollapsed: 'magenta',
  groupEnd: 'magenta',
  // Timer colors
  timer: 'blue',
  timerEnd: 'blue',
  // Status
  status: 'brightCyan',
  statusX: 'brightCyan'
};

// Colorblind-friendly scheme (uses patterns/intensity instead of red/green)
const colorblindScheme = {
  error: 'brightRed',
  warn: 'brightYellow',
  log: 'white',
  info: 'brightCyan',
  debug: 'dim',
  group: 'brightMagenta',
  groupCollapsed: 'brightMagenta',
  groupEnd: 'brightMagenta',
  timer: 'brightBlue',
  timerEnd: 'brightBlue',
  status: 'cyan',
  statusX: 'cyan'
};

/**
 * RGB triples for `pretty.groupBrackets` only. These render as `\x1b[38;2;r;g;bm` and
 * intentionally do **not** reuse any key from {@link defaultColorScheme} /
 * {@link colorblindScheme} (those flow through {@link colorize} + 16-color SGR).
 * Domain: nested group rails stay visually distinct from error/warn/info/log lines.
 * Technical: pick saturated, well-separated hues; cycle with `(depth - 1) % length`.
 */
const GROUP_TREE_RGB_DEFAULT = [
  [255, 95, 215],
  [0, 198, 125],
  [245, 179, 0],
  [0, 145, 255],
  [185, 105, 255],
  [255, 122, 60],
  [75, 214, 201],
  [220, 220, 45]
];

/** Alternate hues with stronger luminance spread (blue–yellow bias for CVD readability). */
const GROUP_TREE_RGB_COLORBLIND = [
  [255, 235, 80],
  [70, 165, 255],
  [255, 140, 0],
  [210, 110, 255],
  [0, 235, 200],
  [255, 85, 175],
  [160, 255, 130],
  [255, 205, 120]
];

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} 24-bit foreground SGR opener (no reset).
 */
function rgbFgOpen(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * @param {number} depth1Based - Nesting depth (outermost group = 1).
 * @param {boolean} colorblindMode
 * @returns {string} Opener sequence for that lane (not including reset).
 */
function groupTreeOpenAtDepth(depth1Based, colorblindMode) {
  const pal = colorblindMode ? GROUP_TREE_RGB_COLORBLIND : GROUP_TREE_RGB_DEFAULT;
  const [r, g, b] = pal[(depth1Based - 1) % pal.length];
  return rgbFgOpen(r, g, b);
}

/**
 * @param {string} text
 * @param {number} depth1Based
 * @param {boolean} colorblindMode
 * @returns {string}
 */
function colorizeGroupTree(text, depth1Based, colorblindMode) {
  return groupTreeOpenAtDepth(depth1Based, colorblindMode) + text + ANSI.reset;
}

/**
 * Wraps text with ANSI color codes
 * @param {string} text - Text to colorize
 * @param {string} colorName - Color name from ANSI object
 * @returns {string} Colorized text with reset code appended
 */
function colorize(text, colorName) {
  const code = ANSI[colorName];
  if (!code) return text;
  return code + text + ANSI.reset;
}

/**
 * Paint a short tree segment at a 1-based depth (24-bit lane + reset).
 *
 * @param {string} text - Segment text (e.g. "⎜", "┌ ").
 * @param {number} depth1Based - Column depth.
 * @param {boolean} colorblindMode
 * @returns {string}
 */
function paintGroupTreeSegment(text, depth1Based, colorblindMode) {
  return colorizeGroupTree(text, depth1Based, colorblindMode);
}

/**
 * ANSI-colored `groupBrackets` prefix: one 24-bit hue per tree column (depth).
 *
 * Domain: when colors are enabled, per-depth stripes identify nested groups without
 * borrowing log/timer/status palette entries.
 *
 * Technical: must stay in lockstep with `groupLogPrefix.js` plain-prefix rules.
 * `group.start` pushes before `scribble` runs, so `groupLevel` includes the new group.
 *
 * @param {string} level - Log level (`group`, `groupEnd`, `info`, …).
 * @param {number} groupLevel - `body.context.groupLevel` (`_groupStack.length` at emit).
 * @param {boolean} colorblindMode - Use {@link GROUP_TREE_RGB_COLORBLIND} when true.
 * @returns {string} Prefix only (tree + alignment spaces); no formatted log body.
 */
function formatColoredGroupBracketPrefix(level, groupLevel, colorblindMode) {
  if (level === 'group' || level === 'groupCollapsed') {
    const parts = [];
    const railCount = Math.max(0, groupLevel - 1);
    for (let i = 0; i < railCount; i++) {
      parts.push(paintGroupTreeSegment('⎜', i + 1, colorblindMode));
    }
    parts.push(paintGroupTreeSegment('┌ ', groupLevel, colorblindMode));
    return parts.join('');
  }

  if (level === 'groupEnd') {
    const parts = [];
    const remaining = groupLevel;
    for (let i = 0; i < remaining; i++) {
      parts.push(paintGroupTreeSegment('⎜', i + 1, colorblindMode));
    }
    parts.push(paintGroupTreeSegment('└ ', remaining + 1, colorblindMode));
    return parts.join('');
  }

  const parts = [];
  for (let i = 0; i < groupLevel; i++) {
    parts.push(paintGroupTreeSegment('⎜', i + 1, colorblindMode));
  }
  parts.push(' '.repeat(Math.max(1, groupLevel)));
  return parts.join('');
}

/**
 * 24-bit opener for the compiled-line tail on `group` / `groupEnd` rows (matches ┌/└ depth).
 *
 * @param {string} level - `group`, `groupCollapsed`, or `groupEnd`.
 * @param {number} groupLevel - `body.context.groupLevel` at emit.
 * @param {boolean} colorblindMode
 * @returns {string} SGR open sequence (no reset).
 */
function groupBracketTailOpen(level, groupLevel, colorblindMode) {
  if (level === 'group' || level === 'groupCollapsed') {
    return groupTreeOpenAtDepth(groupLevel, colorblindMode);
  }
  if (level === 'groupEnd') {
    return groupTreeOpenAtDepth(groupLevel + 1, colorblindMode);
  }
  return groupTreeOpenAtDepth(1, colorblindMode);
}

/**
 * Checks if colors should be enabled based on environment
 * @returns {boolean}
 */
function shouldEnableColors() {
  // Respect NO_COLOR environment variable (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined) return false;

  // Respect FORCE_COLOR environment variable
  if (process.env.FORCE_COLOR !== undefined) return true;

  // Check if stdout is a TTY (terminal)
  if (process.stdout && !process.stdout.isTTY) return false;

  // Check for CI environments that support color
  if (process.env.CI) return true;

  return true;
}

module.exports = {
  ANSI,
  defaultColorScheme,
  colorblindScheme,
  colorize,
  shouldEnableColors,
  GROUP_TREE_RGB_DEFAULT,
  GROUP_TREE_RGB_COLORBLIND,
  groupTreeOpenAtDepth,
  colorizeGroupTree,
  groupBracketTailOpen,
  formatColoredGroupBracketPrefix
};
