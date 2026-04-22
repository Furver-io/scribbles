/**
 * @file Default and validation for `pretty.prose*` options during `scribbles.config()`.
 *
 * Domain: semantic template-prefix painting needs stable defaults and a validated anchor
 * hex so stdout never receives malformed `38;2` sequences.
 * Technical: mutates `config.pretty` and sets `__proseResolved` when colors are on;
 * invoked from `scribblesConfig.js` after syntax palette resolution.
 */

const { parseProseHexColor } = require('../formatting/colors');

/**
 * Set prose defaults, validate `proseColor`, and cache `__proseResolved` when applicable.
 *
 * @param {Object} config - Active scribbles config (`pretty`, `colors`).
 * @returns {void}
 */
function applyProsePrettyConfig(config) {
  if (!config.pretty) {
    return;
  }

  if (undefined === config.pretty.prosePrefix) {
    config.pretty.prosePrefix = true;
  }
  if (undefined === config.pretty.proseColor) {
    config.pretty.proseColor = '#DDDDDD';
  }
  if (undefined === config.pretty.proseImportanceScale) {
    config.pretty.proseImportanceScale = 1;
  }
  if (undefined === config.pretty.proseFieldDarken) {
    config.pretty.proseFieldDarken = {};
  }
  if (undefined === config.pretty.proseMessageLift) {
    config.pretty.proseMessageLift = 0;
  }
  if (undefined === config.pretty.proseWrapperExtraDarken) {
    config.pretty.proseWrapperExtraDarken = 0.05;
  }
  if (undefined === config.pretty.proseEmptyRegionDarken) {
    config.pretty.proseEmptyRegionDarken = 0.75;
  }
  if (undefined === config.pretty.proseContinuationDarken) {
    config.pretty.proseContinuationDarken = 0.65;
  }

  if (config.colors && config.pretty.prosePrefix !== false) {
    const hex = config.pretty.proseColor;
    if (hex != null && !parseProseHexColor(hex)) {
      throw new Error('pretty.proseColor must be a #RRGGBB hex string');
    }
    const anchorRgb = parseProseHexColor(hex || '#DDDDDD');
    if (anchorRgb) {
      config.pretty.__proseResolved = {
        anchorRgb,
        proseImportanceScale: config.pretty.proseImportanceScale,
        proseContinuationDarken: config.pretty.proseContinuationDarken,
        proseEmptyRegionDarken: config.pretty.proseEmptyRegionDarken,
        proseWrapperExtraDarken: config.pretty.proseWrapperExtraDarken
      };
    }
  } else {
    delete config.pretty.__proseResolved;
  }
}

module.exports = { applyProsePrettyConfig };
