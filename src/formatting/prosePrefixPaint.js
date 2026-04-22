/**
 * @file Semantic 24-bit (`38;2`) painting for the template prefix before `{value}`.
 *
 * Domain: operators tune readability by token meaning (git vs time vs message), not
 * placeholder index. Layout still comes from `config.format`; this module only assigns
 * brightness from tiers, handles wrapper brackets, empty `{message}`, and nests
 * `colorScheme[level]` on `{logLevel}` without a whole-line outer `colorize`.
 *
 * Technical: `scribbleStdOutFormat` slices the compiled first line at `outputValue`,
 * calls {@link paintProseTemplatePrefix}, then applies continuation dimming to later
 * lines. A naive `split('\\n')` on `{value}` text that embeds newlines could mis-align
 * the prefix walk; today stacks append after `{value}` so line 0 is safe — see
 * `formatScribbleStdOutLine` in `scribbleStdOutFormat.js`.
 */

const {
  ANSI,
  rgbFgOpen,
  parseProseHexColor,
  lerpRgbTowardBlack,
  clampProseFactor
} = require('./colors');
const {
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
} = require('./prosePrefixParse');

/**
 * Default semantic darken factors (before `proseImportanceScale` and `proseFieldDarken`).
 * Git-related tokens share one tier; `hash` matches `repo` per product convention.
 */
const DEFAULT_PROSE_DARKEN = {
  repo: 0.55,
  mode: 0.55,
  branch: 0.55,
  hash: 0.55,
  spanLabel: 0.5,
  spanId: 0.5,
  time: 0.3,
  fileName: 0.12,
  lineNumber: 0.12,
  logLevel: 0.12,
  message: 0
};

const UNKNOWN_TOKEN_DARKEN = 0.35;

/**
 * Paint the plain-text prefix (before `{value}`) with semantic `38;2` bands.
 *
 * @param {Object} opts
 * @param {string} opts.prefixText - Compiled substring before the rendered `{value}`.
 * @param {Object} opts.all - Flattened template data (same object passed to `__compile`).
 * @param {Object} opts.config - Scribbles config (`pretty`, `format`, …).
 * @param {string} [opts.levelColorName] - `colorScheme[level]` name for `{logLevel}` accent.
 * @returns {string} SGR-decorated prefix, or `prefixText` if anchor invalid / desync.
 */
function paintProseTemplatePrefix(opts) {
  const { prefixText, all, config, levelColorName } = opts;
  const pretty = config.pretty;
  const anchor = parseProseHexColor(pretty.proseColor || '#DDDDDD');
  if (!anchor) {
    return prefixText;
  }

  const scale = pretty.proseImportanceScale !== undefined ? pretty.proseImportanceScale : 1;
  const wrapperExtra =
    pretty.proseWrapperExtraDarken !== undefined ? pretty.proseWrapperExtraDarken : 0.05;
  const emptyReg =
    pretty.proseEmptyRegionDarken !== undefined ? pretty.proseEmptyRegionDarken : 0.75;
  const msgLift = pretty.proseMessageLift !== undefined ? pretty.proseMessageLift : 0;
  const userField = pretty.proseFieldDarken || {};
  const mergedBase = Object.assign({}, DEFAULT_PROSE_DARKEN, userField);

  /**
   * @param {string} name
   * @returns {number}
   */
  const darkenTok = (name) =>
    clampProseFactor(
      (mergedBase[name] !== undefined ? mergedBase[name] : UNKNOWN_TOKEN_DARKEN) * scale
    );

  const segments = sliceBeforeValueToken(
    flattenBracketLiterals(parseFormatSegments(config.format))
  );

  let cursor = 0;
  let out = '';

  /**
   * @param {Object} sink - Accumulator with mutable string field `s`.
   * @param {string} text
   * @param {number} d
   * @returns {void}
   */
  function appendProsePlain(sink, text, d) {
    const [r, g, b] = lerpRgbTowardBlack(anchor.r, anchor.g, anchor.b, clampProseFactor(d));
    sink.s += rgbFgOpen(r, g, b) + text + ANSI.fgDefault;
  }

  /**
   * @param {Object} sink - Accumulator with mutable string field `s`.
   * @param {string} name
   * @param {string} rendered
   * @returns {void}
   */
  function appendTokenBody(sink, name, rendered) {
    let d = darkenTok(name);
    if (name === 'message') {
      if (!rendered.trim()) {
        d = clampProseFactor(emptyReg * scale);
      } else {
        d = clampProseFactor(Math.max(0, d - msgLift));
      }
    }
    if (name === 'logLevel' && levelColorName && ANSI[levelColorName]) {
      const [r, g, b] = lerpRgbTowardBlack(anchor.r, anchor.g, anchor.b, clampProseFactor(d));
      sink.s += rgbFgOpen(r, g, b) + ANSI[levelColorName] + rendered + ANSI.fgDefault;
      return;
    }
    appendProsePlain(sink, rendered, d);
  }

  /**
   * @param {number} openIdx
   * @param {string} openCh
   * @param {string} closeCh
   * @returns {number} Next segment index after the wrapper, or `-1` if not consumed.
   */
  function tryConsumeWrapper(openIdx, openCh, closeCh) {
    const closeIdx = findClosingBracketIndex(segments, openIdx, openCh, closeCh);
    if (closeIdx === -1 || closeIdx <= openIdx) {
      return -1;
    }
    const raw = buildRawRange(segments, all, openIdx, closeIdx);
    if (!prefixText.startsWith(raw, cursor)) {
      return -1;
    }

    const innerTokNames = [];
    for (let k = openIdx + 1; k < closeIdx; k++) {
      if (segments[k].type === 'token') {
        innerTokNames.push(segments[k].name);
      }
    }
    const allEmpty =
      innerTokNames.length === 0
      || innerTokNames.every((n) => coerceField(all, n) === '');

    const sink = { s: '' };

    if (allEmpty) {
      const d = clampProseFactor(emptyReg * scale);
      const [r, g, b] = lerpRgbTowardBlack(anchor.r, anchor.g, anchor.b, d);
      sink.s += rgbFgOpen(r, g, b) + raw + ANSI.fgDefault;
    } else {
      const innerBase = Math.max(...innerTokNames.map((n) => darkenTok(n)));
      const dBracket = clampProseFactor(innerBase + wrapperExtra);

      appendProsePlain(sink, openCh, dBracket);

      const innerLo = openIdx + 1;
      const innerHi = closeIdx - 1;
      for (let k = innerLo; k <= innerHi; k++) {
        const sg = segments[k];
        if (sg.type === 'literal') {
          const ptn = prevTokenInRange(segments, k, innerLo, innerHi);
          const ntn = nextTokenInRange(segments, k, innerLo, innerHi);
          let dLit = innerBase;
          if (ptn && ntn) {
            dLit = Math.max(darkenTok(ptn), darkenTok(ntn));
          } else if (ptn) {
            dLit = Math.max(darkenTok(ptn), innerBase);
          } else if (ntn) {
            dLit = Math.max(innerBase, darkenTok(ntn));
          }
          appendProsePlain(sink, sg.text, dLit);
        } else {
          const rend = coerceField(all, sg.name);
          appendTokenBody(sink, sg.name, rend);
        }
      }

      appendProsePlain(sink, closeCh, dBracket);
    }

    if (raw.length === 0) {
      return -1;
    }

    out += sink.s;
    cursor += raw.length;
    return closeIdx + 1;
  }

  let si = 0;
  while (si < segments.length) {
    const seg = segments[si];
    if (seg.type === 'literal') {
      let nextSi = -1;
      if (seg.text === '[') {
        nextSi = tryConsumeWrapper(si, '[', ']');
      } else if (seg.text === '<') {
        nextSi = tryConsumeWrapper(si, '<', '>');
      } else if (seg.text === '(') {
        nextSi = tryConsumeWrapper(si, '(', ')');
      } else if (seg.text === '{') {
        nextSi = tryConsumeWrapper(si, '{', '}');
      }
      if (nextSi !== -1) {
        si = nextSi;
        continue;
      }
      if (!prefixText.startsWith(seg.text, cursor)) {
        return prefixText;
      }
      const p = prevTokenName(segments, si);
      const n = nextTokenName(segments, si);
      const dp = p ? darkenTok(p) : clampProseFactor(UNKNOWN_TOKEN_DARKEN * scale);
      const dn = n ? darkenTok(n) : clampProseFactor(UNKNOWN_TOKEN_DARKEN * scale);
      const litSink = { s: '' };
      appendProsePlain(litSink, seg.text, Math.max(dp, dn));
      out += litSink.s;
      cursor += seg.text.length;
      si++;
      continue;
    }

    const rendered = coerceField(all, seg.name);
    if (!prefixText.startsWith(rendered, cursor)) {
      return prefixText;
    }
    const tb = { s: '' };
    appendTokenBody(tb, seg.name, rendered);
    out += tb.s;
    cursor += rendered.length;
    si++;
  }

  return out;
}

module.exports = {
  paintProseTemplatePrefix,
  DEFAULT_PROSE_DARKEN
};
