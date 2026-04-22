/**
 * @file Turn one structured log body into the final stdout line string.
 *
 * Domain: moment-formatted time, template compilation, syntax-colored `{value}`,
 * and group/tree prefixes from `groupLogPrefix.js`.
 * Technical: called only from `body.toString` in `scribble.js` so `scribble.js`
 * stays within the repository line-count gate.
 */

const moment = require('moment');

const stringify = require('../formatting/stringify');
const { formatGroupLogLineForStdOut } = require('../formatting/groupLogPrefix');
const {
  createSyntaxPainter,
  paintValueLabel,
  paintStringDisambiguation
} = require('../formatting/stringifySyntax');
const { paintProseTemplatePrefix } = require('../formatting/prosePrefixPaint');
const {
  parseProseHexColor,
  lerpRgbTowardBlack,
  rgbFgOpen,
  ANSI,
  clampProseFactor
} = require('../formatting/colors');

/**
 * After `__compile`, paint semantic prose on line 0 before `{value}` and dim stack lines.
 *
 * Domain: stack traces append `\n` after the value; continuation lines read quieter than
 * the anchor line. If `{value}` ever embeds `\n`, `indexOf(outputValue)` on line 0 may
 * not represent the full value — prose would desync; `paintProseTemplatePrefix` then
 * returns the plain prefix unchanged.
 *
 * @param {string} compiledLine - Full compiled template output (may contain `\n`).
 * @param {string} outputValue - Rendered `{value}` column (label + syntax-colored payload).
 * @param {Object} templateData - Same object passed to `config.__compile`.
 * @param {Object} config - Active scribbles config.
 * @param {string|undefined} levelColorName - `colorScheme[level]` for `{logLevel}` accent.
 * @returns {{ line: string, didPrefixPaint: boolean }} `didPrefixPaint` false when the
 *   prefix slice could not be painted (desync) so `groupLogPrefix` may fall back to level color.
 */
function applyProseMultilineToCompiledLine(
  compiledLine,
  outputValue,
  templateData,
  config,
  levelColorName
) {
  const lines = compiledLine.split('\n');
  const line0 = lines[0];
  // `indexOf('')` is 0 — treat empty `{value}` as “prefix is the whole line” so prose still runs.
  let v0;
  if (outputValue == null || outputValue === '') {
    v0 = line0.length;
  } else if (typeof outputValue === 'string') {
    v0 = line0.indexOf(outputValue);
  } else {
    v0 = -1;
  }
  let didPrefixPaint = false;
  if (v0 !== -1 && (v0 > 0 || v0 === line0.length)) {
    const pre = line0.slice(0, v0);
    const post = line0.slice(v0);
    const paintedPre = paintProseTemplatePrefix({
      prefixText: pre,
      all: templateData,
      config,
      levelColorName
    });
    lines[0] = paintedPre + post;
    didPrefixPaint = paintedPre !== pre;
  }
  const p = config.pretty;
  const anchor = parseProseHexColor(p.proseColor || '#DDDDDD');
  if (anchor && lines.length > 1) {
    const scale = p.proseImportanceScale !== undefined ? p.proseImportanceScale : 1;
    const cd =
      (p.proseContinuationDarken !== undefined ? p.proseContinuationDarken : 0.65) * scale;
    const [r, g, b] = lerpRgbTowardBlack(anchor.r, anchor.g, anchor.b, clampProseFactor(cd));
    const open = rgbFgOpen(r, g, b);
    for (let i = 1; i < lines.length; i++) {
      lines[i] = open + lines[i] + ANSI.fgDefault;
    }
  }
  return { line: lines.join('\n'), didPrefixPaint };
}

/**
 * Build the string passed to `stdOut` for one log entry.
 *
 * @param {Object} ctx
 * @param {Object} ctx.body - Log body (`git`, `info`, `input`, `context`, …).
 * @param {Object} ctx.config - Active scribbles config (`time`, `pretty`, `__compile`, …).
 * @param {string} ctx.sVer - Package version merged into flattened `all` for the template.
 * @param {number[]} ctx.indexs - Arg slot indices from `args2keys`.
 * @param {string[]} ctx.argNames - Extracted call-site argument names.
 * @param {*} ctx.value - Raw logged value (may be the `notUsed` sentinel).
 * @param {string} ctx.level - Log level (`log`, `info`, …).
 * @param {string|undefined} ctx.originalMessage - Error original message when relevant.
 * @param {string[]|undefined} ctx.stackTrace - Trimmed stack lines when `error` is set.
 * @param {*} ctx.error - Error argument or `notUsed`.
 * @param {Object} ctx.notUsed - Sentinel object for missing args.
 * @returns {string} Single line (or multi-line when stack appended) for the terminal.
 *
 * Technical: semantic prose runs for every syntax-highlighted line when `prosePrefix` is on,
 * not only when `{value}` already contains SGR — otherwise message-only rows would lose tiers.
 */
function formatScribbleStdOutLine(ctx) {
  const {
    body,
    config,
    sVer,
    indexs,
    argNames,
    value,
    level,
    originalMessage,
    stackTrace,
    error,
    notUsed
  } = ctx;

  const all = Object.keys(body).reduce(
    (acc, topics) => Object.assign(acc, body[topics]),
    { v: sVer }
  );

  const time = moment(body.info.time).format(config.time);

  let outputMessage = all.message;

  /* istanbul ignore if */
  if (typeof outputMessage === 'symbol') {
    outputMessage = outputMessage.toString();
  }

  if (
    'string' === typeof outputMessage
    && ['{', '['].includes(outputMessage.trim()[0])
  ) {
    outputMessage = `String"${outputMessage}"`;
  }
  if (
    -1 === indexs.indexOf('value')
    && 0 === indexs.indexOf('message')
    && argNames[0]
  ) {
    outputMessage = argNames[0] + ':' + outputMessage;
  }
  const syntaxReady = config.colors
    && config.pretty
    && config.pretty.syntaxHighlight
    && config.pretty.__syntaxColorResolved;
  const syntaxPainter = syntaxReady
    ? createSyntaxPainter({ scheme: config.pretty.__syntaxColorResolved })
    : null;
  const prettyOpts = syntaxPainter
    ? Object.assign({}, config.pretty, { __syntaxPainter: syntaxPainter })
    : config.pretty;

  let valueCore = value;
  if (
    notUsed === value
    || ['timer', 'timerEnd'].includes(level)
  ) {
    valueCore = '';
  } else if ('function' === typeof config.stringify) {
    valueCore = config.stringify(value, config.pretty);
  } else if (typeof value === 'symbol') {
    valueCore = value.toString();
  } else if (!value) {
    valueCore = value + '';
  } else if ('function' === typeof value) {
    valueCore = value.toString();
  } else if ('object' === typeof value || Array.isArray(value)) {
    valueCore = stringify(value, prettyOpts);
  } else if ('string' === typeof value) {
    if (['{', '['].includes(value.trim()[0])) {
      valueCore = `String"${value}"`;
    }
  }

  if (syntaxPainter && valueCore !== '' && typeof config.stringify !== 'function') {
    if ((typeof value === 'object' && value !== null) || Array.isArray(value)) {
      /* valueCore already produced by stringify with __syntaxPainter */
    } else if (typeof value === 'symbol') {
      valueCore = syntaxPainter.paint('symbol', valueCore);
    } else if (typeof value === 'boolean') {
      valueCore = syntaxPainter.paint('boolean', valueCore);
    } else if (value === null || value === undefined) {
      valueCore = syntaxPainter.paint('nullish', valueCore);
    } else if (typeof value === 'number') {
      valueCore = syntaxPainter.paint('number', valueCore);
    } else if (typeof value === 'bigint') {
      valueCore = syntaxPainter.paint('number', valueCore);
    } else if (typeof value === 'string') {
      valueCore = ['{', '['].includes(value.trim()[0])
        ? paintStringDisambiguation(syntaxPainter, valueCore)
        : syntaxPainter.paint('string', valueCore);
    } else if (typeof value === 'function') {
      valueCore = syntaxPainter.paint('function', valueCore);
    } else if (!value) {
      valueCore = syntaxPainter.paint('number', valueCore);
    }
  }

  const argValName = argNames[indexs.indexOf('value')] || '';
  const outputValue = (argValName
    ? (syntaxPainter ? paintValueLabel(syntaxPainter, argValName) : argValName + ':')
    : '') + valueCore;
  const outputStackTrace = notUsed !== error
    ? '\n' + (originalMessage
      ? 'Error: ' + originalMessage + '\n'
      : '') + stackTrace.map((line) => ` at ${line}`).join('\n')
    : '';

  const groupLevel = body.context.groupLevel || 0;
  const templateData = Object.assign(all, {
    time,
    value: outputValue,
    message: outputMessage,
    stackTrace: outputStackTrace
  });
  const compiledLine = config.__compile(templateData);
  const levelColor = config.colorScheme && config.colorScheme[level];

  // Prose tiers run whenever syntax mode is on — not only when `{value}` already contains
  // SGR. Otherwise message-only or empty-value lines skip prose while object logs get tiers.
  const useProsePrefix =
    config.colors &&
    config.pretty &&
    config.pretty.syntaxHighlight &&
    config.pretty.prosePrefix !== false &&
    !!parseProseHexColor(config.pretty.proseColor || '#DDDDDD');

  let lineForStdOut = compiledLine;
  let plainPrefixPreColored = false;
  if (useProsePrefix) {
    const proseResult = applyProseMultilineToCompiledLine(
      compiledLine,
      outputValue,
      templateData,
      config,
      levelColor
    );
    lineForStdOut = proseResult.line;
    plainPrefixPreColored = proseResult.didPrefixPaint;
  }

  return formatGroupLogLineForStdOut(
    config,
    level,
    groupLevel,
    lineForStdOut,
    levelColor,
    outputValue,
    plainPrefixPreColored
  );
}

module.exports = { formatScribbleStdOutLine };
