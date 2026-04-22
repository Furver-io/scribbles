/**
 * @file Shared helpers for stringify (symbols, type tests, dual inline expansion).
 *
 * Domain: support Map keys, RegExp detection, and paired plain/colored collapse for
 * `inlineCharacterLimit` without measuring ANSI width.
 */

/**
 * Enumerable own symbols on `object` (for object stringify key lists).
 *
 * @param {Object} object
 * @returns {symbol[]}
 */
function getOwnEnumPropSymbols(object) {
  return Object
    .getOwnPropertySymbols(object)
    .filter((keySymbol) => Object.prototype.propertyIsEnumerable.call(object, keySymbol));
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isRegexp(value) {
  return toString.call(value) === '[object RegExp]';
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isObject(value) {
  const type = typeof value;
  return value !== null && (type === 'object' || type === 'function');
}

/**
 * @param {Object} val
 * @returns {string}
 */
function getObjName(val) {
  if (val.constructor
    && 'Object' !== val.constructor.name) {
    return val.constructor.name + ' ';
  }
  return '';
}

/**
 * Collapse or expand token placeholders using plain text length; mirror for colored twin.
 *
 * @param {Object} options - pretty options
 * @param {Object} tokens - newline / pad / indent placeholders
 * @param {string} pad - current pad
 * @param {string} indent - indent unit
 * @param {string} plainStr
 * @param {string} coloredStr
 * @param {function(boolean): string} [reGenPlain]
 * @param {function(boolean): string} [reGenColored]
 * @returns {{ plain: string, colored: string }}
 */
function expandWhiteSpaceDual(options, tokens, pad, indent, plainStr, coloredStr, reGenPlain, reGenColored) {
  if (options.inlineCharacterLimit === undefined) {
    return { plain: plainStr, colored: coloredStr };
  }

  const oneLined = plainStr
    .replace(new RegExp(tokens.newline, 'g'), '')
    .replace(new RegExp(tokens.newlineOrSpace, 'g'), ' ')
    .replace(new RegExp(tokens.pad + '|' + tokens.indent, 'g'), '');

  const oneLinedColored = coloredStr
    .replace(new RegExp(tokens.newline, 'g'), '')
    .replace(new RegExp(tokens.newlineOrSpace, 'g'), ' ')
    .replace(new RegExp(tokens.pad + '|' + tokens.indent, 'g'), '');

  if (oneLined.length <= options.inlineCharacterLimit) {
    return { plain: oneLined, colored: oneLinedColored };
  }

  const pSrc = reGenPlain ? reGenPlain(true) : plainStr;
  const cSrc = reGenColored ? reGenColored(true) : coloredStr;

  const pExp = pSrc
    .replace(new RegExp(tokens.newline + '|' + tokens.newlineOrSpace, 'g'), '\n')
    .replace(new RegExp(tokens.pad, 'g'), pad)
    .replace(new RegExp(tokens.indent, 'g'), pad + indent);

  const cExp = cSrc
    .replace(new RegExp(tokens.newline + '|' + tokens.newlineOrSpace, 'g'), '\n')
    .replace(new RegExp(tokens.pad, 'g'), pad)
    .replace(new RegExp(tokens.indent, 'g'), pad + indent);

  return { plain: pExp, colored: cExp };
}

/**
 * @param {Object} painter - Syntax painter with `paint(role, text)`.
 * @param {string} typeOfObj - may include trailing space for custom classes
 * @returns {string}
 */
function paintTypePrefix(painter, typeOfObj) {
  if (!typeOfObj) return '';
  const trimmed = typeOfObj.replace(/\s+$/, '');
  const gap = /\s$/.test(typeOfObj) ? ' ' : '';
  return painter.paint('typeName', trimmed) + gap;
}

module.exports = {
  getOwnEnumPropSymbols,
  isRegexp,
  isObject,
  getObjName,
  expandWhiteSpaceDual,
  paintTypePrefix
};
