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
  const compiledLine = config.__compile(Object.assign(all, {
    time,
    value: outputValue,
    message: outputMessage,
    stackTrace: outputStackTrace
  }));
  const levelColor = config.colorScheme && config.colorScheme[level];
  return formatGroupLogLineForStdOut(
    config,
    level,
    groupLevel,
    compiledLine,
    levelColor,
    outputValue
  );
}

module.exports = { formatScribbleStdOutLine };
