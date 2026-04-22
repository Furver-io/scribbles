/**
 * @file Format-string parsing helpers for {@link ./prosePrefixPaint}.
 *
 * Domain: `config.format` defines layout; we tokenize literals and `{name}` slots,
 * split wrapper punctuation into standalone segments, and slice before `{value}`.
 * Technical: mirrors `string-template` placeholder rules for `coerceField` so the
 * painted prefix stays byte-identical to the compiled plain prefix when no SGR runs.
 */

/**
 * @param {string} formatStr
 * @returns {Array<{ type: 'literal', text: string }|{ type: 'token', name: string }>}
 */
function parseFormatSegments(formatStr) {
  const re = /\{([0-9a-zA-Z]+)\}/g;
  const segments = [];
  let lastIndex = 0;
  let m = re.exec(formatStr);
  while (m !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'literal', text: formatStr.slice(lastIndex, m.index) });
    }
    segments.push({ type: 'token', name: m[1] });
    lastIndex = m.index + m[0].length;
    m = re.exec(formatStr);
  }
  if (lastIndex < formatStr.length) {
    segments.push({ type: 'literal', text: formatStr.slice(lastIndex) });
  }
  return segments;
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @returns {typeof segments}
 */
function flattenBracketLiterals(segments) {
  const OPEN = new Set(['[', '<', '(', '{']);
  const CLOSE = new Set([']', '>', ')', '}']);
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type !== 'literal') {
      out.push(seg);
      continue;
    }
    let buf = '';
    for (let j = 0; j < seg.text.length; j++) {
      const c = seg.text[j];
      if (OPEN.has(c) || CLOSE.has(c)) {
        if (buf) {
          out.push({ type: 'literal', text: buf });
          buf = '';
        }
        out.push({ type: 'literal', text: c });
      } else {
        buf += c;
      }
    }
    if (buf) {
      out.push({ type: 'literal', text: buf });
    }
  }
  return out;
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @returns {typeof segments}
 */
function sliceBeforeValueToken(segments) {
  const idx = segments.findIndex((s) => s.type === 'token' && s.name === 'value');
  if (idx === -1) {
    return segments;
  }
  return segments.slice(0, idx);
}

/**
 * @param {object} all
 * @param {string} name
 * @returns {string}
 */
function coerceField(all, name) {
  if (!all || !Object.prototype.hasOwnProperty.call(all, name)) {
    return '';
  }
  const v = all[name];
  if (v === null || v === undefined) {
    return '';
  }
  return String(v);
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @param {number} si
 * @param {string} openCh
 * @param {string} closeCh
 * @returns {number}
 */
function findClosingBracketIndex(segments, si, openCh, closeCh) {
  let depth = 0;
  for (let k = si; k < segments.length; k++) {
    const s = segments[k];
    if (s.type !== 'literal') {
      continue;
    }
    if (s.text === openCh) {
      depth++;
    } else if (s.text === closeCh) {
      depth--;
      if (depth === 0) {
        return k;
      }
    }
  }
  return -1;
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @param {object} all
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
function buildRawRange(segments, all, from, to) {
  let s = '';
  for (let k = from; k <= to; k++) {
    const seg = segments[k];
    if (seg.type === 'literal') {
      s += seg.text;
    } else {
      s += coerceField(all, seg.name);
    }
  }
  return s;
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @param {number} j
 * @param {number} lo
 * @param {number} hi
 * @returns {string|null}
 */
function prevTokenInRange(segments, j, lo, hi) {
  for (let k = j - 1; k >= lo; k--) {
    if (segments[k].type === 'token') {
      return segments[k].name;
    }
  }
  return null;
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @param {number} j
 * @param {number} lo
 * @param {number} hi
 * @returns {string|null}
 */
function nextTokenInRange(segments, j, lo, hi) {
  for (let k = j + 1; k <= hi; k++) {
    if (segments[k].type === 'token') {
      return segments[k].name;
    }
  }
  return null;
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @param {number} j
 * @returns {string|null}
 */
function prevTokenName(segments, j) {
  return prevTokenInRange(segments, j, 0, segments.length - 1);
}

/**
 * @param {ReturnType<typeof parseFormatSegments>} segments
 * @param {number} j
 * @returns {string|null}
 */
function nextTokenName(segments, j) {
  return nextTokenInRange(segments, j, 0, segments.length - 1);
}

module.exports = {
  parseFormatSegments,
  flattenBracketLiterals,
  sliceBeforeValueToken,
  coerceField,
  findClosingBracketIndex,
  buildRawRange,
  prevTokenInRange,
  nextTokenInRange,
  prevTokenName,
  nextTokenName
};
