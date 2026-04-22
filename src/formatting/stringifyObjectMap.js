/**
 * @file Plain object and Map serialization branch for stringify.
 */

const { getOwnEnumPropSymbols, expandWhiteSpaceDual, paintTypePrefix } = require('./stringifyUtils');

/**
 * @param {Object} ctx
 * @param {object} ctx.input
 * @returns {string|{plain:string,colored:string}}
 */
function stringifyObjectMapBranch(ctx) {
  const {
    input,
    options,
    pad,
    seen,
    indent,
    tokens,
    painter,
    wrapDual,
    stringifyInner,
    expandWhiteSpace,
    currentDepth
  } = ctx;

  let objectKeys = [];
  /**
   * Read a property value for plain objects; for `Map`, uses `.get(key)`.
   *
   * @param {*} key
   * @returns {*}
   */
  let getVal = (key) => input[key];
  let typeOfObj = ctx.getObjName(input);
  if (input instanceof Map) {
    getVal = (key) => input.get(key);
    objectKeys = Array.from(input.keys());
    typeOfObj = 'Map';
  } else {
    objectKeys = [
      ...Object.keys(input),
      ...getOwnEnumPropSymbols(input)
    ];
    if ('Promise' === typeOfObj.trim()) {
      ['then', 'catch', 'finally'].forEach((key) => {
        if ('function' === typeof input[key]) {
          objectKeys.push(key);
        }
      });
    }
  }

  if (options.filter) {
    objectKeys = objectKeys.filter((element) => options.filter(input, element));
  }

  if (objectKeys.length === 0) {
    const pl = typeOfObj + '{ }';
    if (!painter) return pl;
    const c = paintTypePrefix(painter, typeOfObj) + painter.paint('bracket', '{ }');
    return wrapDual(pl, c);
  }
  if (currentDepth > options.depth) {
    const pl = typeOfObj + '{ + }';
    if (!painter) return pl;
    const c = paintTypePrefix(painter, typeOfObj)
      + painter.paint('bracket', '{ ')
      + painter.paint('truncation', '+')
      + painter.paint('bracket', ' }');
    return wrapDual(pl, c);
  }
  seen.push(input);

  /**
   * One plain-text line for object/Map entry `element` at index `i`.
   *
   * @param {*} element - key (symbol, string, or complex via stringify)
   * @param {number} i - index in `objectKeys`
   * @returns {string}
   */
  const mapLinePlain = (element, i) => {
    const eol = objectKeys.length - 1 === i ? tokens.newline : ',' + tokens.newlineOrSpace;
    const isSymbol = typeof element === 'symbol';
    const isClassic = !isSymbol && /^[a-z$_][$\w]*$/i.test(element);

    let keyPlainForName;
    let lineKeyPlain;
    if (isSymbol || isClassic) {
      keyPlainForName = String(element);
      lineKeyPlain = keyPlainForName;
    } else {
      const k = stringifyInner(element, options, pad + indent, '', seen);
      keyPlainForName = painter ? k.plain : k;
      lineKeyPlain = keyPlainForName;
    }

    let value = stringifyInner(getVal(element), options, pad + indent, keyPlainForName, seen);
    let valPlain = painter ? value.plain : value;
    if (options.transform) {
      valPlain = options.transform(input, element, valPlain);
    }

    return tokens.indent + lineKeyPlain + ':' + valPlain + eol;
  };

  /**
   * One syntax-colored line for object/Map entry `element` at index `i`.
   *
   * @param {*} element
   * @param {number} i
   * @returns {string}
   */
  const mapLineColored = (element, i) => {
    const eolPlain = objectKeys.length - 1 === i ? tokens.newline : ',' + tokens.newlineOrSpace;
    const isSymbol = typeof element === 'symbol';
    const isClassic = !isSymbol && /^[a-z$_][$\w]*$/i.test(element);
    const keySub = isSymbol || isClassic ? null : stringifyInner(element, options, pad + indent, '', seen);

    const keyCol = isSymbol || isClassic
      ? painter.paint('key', String(element))
      : keySub.colored;

    let value = stringifyInner(getVal(element), options, pad + indent, isSymbol || isClassic ? String(element) : String(keySub.plain), seen);
    let valPlain = value.plain;
    let valCol = value.colored;
    if (options.transform) {
      valPlain = options.transform(input, element, valPlain);
      valCol = painter.paint('transformOutput', valPlain);
    }

    let eolCol = eolPlain;
    if (objectKeys.length - 1 !== i) {
      eolCol = painter.paint('comma', ',') + tokens.newlineOrSpace;
    }

    return tokens.indent + keyCol + painter.paint('colon', ':') + valCol + eolCol;
  };

  const returnValuePlain = `${typeOfObj}{ ` + tokens.newline + objectKeys.map((el, i) => mapLinePlain(el, i)).join('') + tokens.pad + ((tokens.pad || '').includes(' ') ? '' : ' ') + '}';

  if (!painter) {
    seen.pop();
    return expandWhiteSpace(returnValuePlain);
  }

  const returnValueColored = paintTypePrefix(painter, typeOfObj) + painter.paint('bracket', '{ ') + tokens.newline
    + objectKeys.map((el, i) => mapLineColored(el, i)).join('')
    + tokens.pad + ((tokens.pad || '').includes(' ') ? '' : ' ') + painter.paint('bracket', '}');

  seen.pop();

  const pair = expandWhiteSpaceDual(
    options,
    tokens,
    pad,
    indent,
    returnValuePlain,
    returnValueColored,
    null,
    null
  );
  return wrapDual(pair.plain, pair.colored);
}

module.exports = { stringifyObjectMapBranch };
