/**
 * @file Recursive value stringification with optional syntax-highlighted twin output.
 *
 * Domain: same readable shapes as legacy stringify (Map{…}, circular markers, depth `{ + }`).
 * Technical: heavy branches live in {@link ./stringifyArraySet} and {@link ./stringifyObjectMap};
 * `options.__syntaxPainter` enables parallel colored output without skewing `inlineCharacterLimit`.
 */

const { isRegexp, isObject, getObjName, expandWhiteSpaceDual } = require('./stringifyUtils');
const { stringifyArraySetBranch } = require('./stringifyArraySet');
const { stringifyObjectMapBranch } = require('./stringifyObjectMap');

/**
 * @param {*} input
 * @param {Object} options
 * @param {string} pad
 * @param {string} name - property name context for function stringify
 * @param {Array} seen - circular reference stack
 * @returns {string|{plain:string,colored:string}}
 */
function stringifyInner(input, options, pad, name, seen) {
  const painter = options.__syntaxPainter;
  const indent = options.indent || '\t';
  const currentDepth = options.depth ? pad.split(indent).length : null;

  let tokens;
  if (options.inlineCharacterLimit === undefined) {
    tokens = {
      newline: '\n',
      newlineOrSpace: '\n',
      pad,
      indent: pad + indent
    };
  } else {
    tokens = {
      newline: '@@__STRINGIFY_OBJECT_NEW_LINE__@@',
      newlineOrSpace: '@@__STRINGIFY_OBJECT_NEW_LINE_OR_SPACE__@@',
      pad: '@@__STRINGIFY_OBJECT_PAD__@@',
      indent: '@@__STRINGIFY_OBJECT_INDENT__@@'
    };
  }

  /**
   * Collapse placeholders to one line when under `inlineCharacterLimit`, else expand.
   *
   * @param {string} string - body with tokenizer placeholders
   * @param {function(): string} [reGenArrayWithIndexs] - rebuild with array indexes when expanding
   * @returns {string}
   */
  const expandWhiteSpace = (string, reGenArrayWithIndexs) => {
    if (options.inlineCharacterLimit === undefined) {
      return string;
    }

    const oneLined = string
      .replace(new RegExp(tokens.newline, 'g'), '')
      .replace(new RegExp(tokens.newlineOrSpace, 'g'), ' ')
      .replace(new RegExp(tokens.pad + '|' + tokens.indent, 'g'), '');

    if (oneLined.length <= options.inlineCharacterLimit) {
      return oneLined;
    }

    return (reGenArrayWithIndexs ? reGenArrayWithIndexs() : string)
      .replace(new RegExp(tokens.newline + '|' + tokens.newlineOrSpace, 'g'), '\n')
      .replace(new RegExp(tokens.pad, 'g'), pad)
      .replace(new RegExp(tokens.indent, 'g'), pad + indent);
  };

  /**
   * Pair plain and colored strings when a syntax painter is active.
   *
   * @param {string} plainStr
   * @param {string} coloredStr
   * @returns {string|{plain:string,colored:string}}
   */
  const wrapDual = (plainStr, coloredStr) => (painter ? { plain: plainStr, colored: coloredStr } : plainStr);

  if (seen.includes(input)) {
    if (Array.isArray(input)) {
      const pl = '[ ...! ]';
      if (!painter) return pl;
      return wrapDual(pl,
        painter.paint('bracket', '[ ')
        + painter.paint('circular', '...')
        + painter.paint('circular', '!')
        + painter.paint('bracket', ' ]'));
    }
    const tail = `${getObjName(input) || '!'}`;
    const pl = `{ ...${tail} }`;
    if (!painter) return pl;
    return wrapDual(pl,
      painter.paint('bracket', '{ ')
      + painter.paint('circular', '...')
      + painter.paint('circular', tail)
      + painter.paint('bracket', ' }'));
  }

  if (
    input === null
    || input === undefined
    || typeof input === 'number'
    || typeof input === 'boolean'
    || typeof input === 'bigint'
    || typeof input === 'symbol'
    || isRegexp(input)
  ) {
    const pl = String(input);
    if (!painter) return pl;
    let role = 'number';
    if (input === null || input === undefined) role = 'nullish';
    else if (typeof input === 'boolean') role = 'boolean';
    else if (typeof input === 'symbol') role = 'symbol';
    else if (isRegexp(input)) role = 'regex';
    else if (typeof input === 'number' && Number.isNaN(input)) role = 'number';
    return wrapDual(pl, painter.paint(role, pl));
  }

  if ('function' === typeof input) {
    const [start] = input.toString().split(')');
    const isArrow = !start.includes('function');
    const [, argsB] = start.replace('function', '')
      .replace(/ /g, '')
      .split('(');

    let realName = name;

    if (isArrow) {
      if (realName !== input.name) { realName = input.name; } else { realName = ''; }
    } else if (realName === input.name) {
      realName = 'ƒ';
    } else {
      realName = input.name;
    }

    const pl = `${realName}(${argsB})${isArrow ? '=>' : ''}{-}`;
    if (!painter) return pl;
    const c = painter.paint('function', realName)
      + painter.paint('bracket', '(')
      + painter.paint('function', argsB)
      + painter.paint('bracket', ')')
      + painter.paint('function', isArrow ? '=>' : '')
      + painter.paint('function', '{-}');
    return wrapDual(pl, c);
  }

  if (input instanceof Error) {
    const pl = `${input.name}("${input.message}")`;
    if (!painter) return pl;
    return wrapDual(pl,
      painter.paint('typeName', input.name)
      + painter.paint('bracket', '("')
      + painter.paint('string', input.message)
      + painter.paint('bracket', '")'));
  }

  if (input instanceof Date) {
    const inner = input.toJSON();
    const pl = `Date(${inner})`;
    if (!painter) return pl;
    return wrapDual(pl,
      painter.paint('typeName', 'Date')
      + painter.paint('bracket', '(')
      + painter.paint('string', inner)
      + painter.paint('bracket', ')'));
  }

  if (Buffer.isBuffer(input)) {
    const inner = Array.from(input).join();
    const pl = `Buffer[ ${inner} ]`;
    if (!painter) return pl;
    return wrapDual(pl,
      painter.paint('typeName', 'Buffer')
      + painter.paint('bracket', '[ ')
      + painter.paint('number', inner)
      + painter.paint('bracket', ' ]'));
  }

  if (Array.isArray(input)
    || input instanceof Set) {
    let typeOfObj = '';
    let arr = input;
    if (input instanceof Set) {
      typeOfObj = 'Set';
      arr = Array.from(input.values());
    }
    return stringifyArraySetBranch({
      input: arr,
      typeOfObj,
      options,
      pad,
      seen,
      indent,
      tokens,
      painter,
      wrapDual,
      stringifyInner,
      expandWhiteSpace,
      expandWhiteSpaceDual,
      currentDepth
    });
  }

  if (isObject(input)) {
    return stringifyObjectMapBranch({
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
      currentDepth,
      getObjName
    });
  }

  let str = input;
  str = str.replace(/\\/g, '\\\\');
  str = String(str).replace(/[\r\n]/g, (x) => (x === '\n' ? '\\n' : '\\r'));

  if (options.singleQuotes === false) {
    str = str.replace(/"/g, '\\"');
    const pl = `"${str}"`;
    if (!painter) return pl;
    return wrapDual(pl, painter.paint('string', pl));
  }

  str = str.replace(/'/g, '\\\'');
  const pl = `'${str}'`;
  if (!painter) return pl;
  return wrapDual(pl, painter.paint('string', pl));
}

/**
 * @param {*} input
 * @param {Object} [options]
 * @param {string} [pad]
 * @returns {string}
 */
function stringify(input, options, pad) {
  const seen = [];
  const opts = options || {};
  const basePad = pad === undefined ? '' : pad;
  const res = stringifyInner(input, opts, basePad, '', seen);
  if (opts.__syntaxPainter) {
    return res.colored;
  }
  return res;
}

module.exports = { stringify, stringifyInner };
