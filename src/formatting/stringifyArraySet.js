/**
 * @file Array and Set serialization branch for stringify (plain + optional syntax colors).
 */

const { paintTypePrefix } = require('./stringifyUtils');

/**
 * @param {Object} ctx
 * @param {*} ctx.input - array or Set values (Set already coerced to array by caller)
 * @param {string} ctx.typeOfObj - '' or 'Set'
 * @returns {string|{plain:string,colored:string}}
 */
function stringifyArraySetBranch(ctx) {
  const {
    input,
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
  } = ctx;

  if (input.length === 0) {
    const pl = typeOfObj + '[ ]';
    if (!painter) return pl;
    const c = paintTypePrefix(painter, typeOfObj) + painter.paint('bracket', '[ ]');
    return wrapDual(pl, c);
  }
  if (currentDepth > options.depth) {
    const pl = typeOfObj + '[ + ]';
    if (!painter) return pl;
    const c = paintTypePrefix(painter, typeOfObj)
      + painter.paint('bracket', '[ ')
      + painter.paint('truncation', '+')
      + painter.paint('bracket', ' ]');
    return wrapDual(pl, c);
  }
  seen.push(input);

  /**
   * Build plain (non-syntax) multiline array/Set body; optionally prefix numeric indexes.
   *
   * @param {boolean} addIndexs - when true, emit `i:` before each element (expanded layout).
   * @returns {string}
   */
  const doWorkPlain = (addIndexs) => `${typeOfObj}[ ` + tokens.newline + input.map((element, i) => {
    const eol = input.length - 1 === i ? tokens.newline
      : ',' + tokens.newlineOrSpace;

    let value = stringifyInner(element, options, pad + indent, '', seen);
    if (painter) value = value.plain;
    if (options.transform) {
      value = options.transform(input, i, value);
    }

    return tokens.indent + (addIndexs ? i + ':' : '') + value + eol;
  }).join('') + tokens.pad + ((tokens.pad || '').includes(' ') ? '' : ' ') + ']';

  /**
   * Build syntax-colored multiline array/Set body; mirrors {@link doWorkPlain} indices.
   *
   * @param {boolean} addIndexs
   * @returns {string}
   */
  const doWorkColored = (addIndexs) => {
    if (!painter) return doWorkPlain(addIndexs);
    return `${paintTypePrefix(painter, typeOfObj)}${painter.paint('bracket', '[ ')}` + tokens.newline + input.map((element, i) => {
      const eolPlain = input.length - 1 === i ? tokens.newline
        : ',' + tokens.newlineOrSpace;

      const sub = stringifyInner(element, options, pad + indent, '', seen);
      let pl = sub.plain;
      let col = sub.colored;
      if (options.transform) {
        pl = options.transform(input, i, pl);
        col = painter.paint('transformOutput', pl);
      }

      const idxPart = addIndexs
        ? painter.paint('arrayIndex', String(i)) + painter.paint('colon', ':')
        : '';

      let eolCol = eolPlain;
      if (input.length - 1 !== i) {
        eolCol = painter.paint('comma', ',') + tokens.newlineOrSpace;
      }

      return tokens.indent + idxPart + col + eolCol;
    }).join('') + tokens.pad + ((tokens.pad || '').includes(' ') ? '' : ' ') + painter.paint('bracket', ']');
  };

  const returnValuePlain = doWorkPlain(false);
  if (!painter) {
    seen.pop();
    return expandWhiteSpace(returnValuePlain, () => doWorkPlain(true));
  }

  const returnValueColored = doWorkColored(false);
  seen.pop();

  const pair = expandWhiteSpaceDual(
    options,
    tokens,
    pad,
    indent,
    returnValuePlain,
    returnValueColored,
    () => doWorkPlain(true),
    () => doWorkColored(true)
  );
  return wrapDual(pair.plain, pair.colored);
}

module.exports = { stringifyArraySetBranch };
