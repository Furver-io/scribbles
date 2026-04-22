/**
 * @file Scribbles configuration and log level setup
 */
const compile = require("string-template/compile");
const { performance } = require('perf_hooks');

const config = require('./config');
const { getSource } = require('../utils/helpers');
const { defaultColorScheme, colorblindScheme, shouldEnableColors } = require('../formatting/colors');
const { mergeResolvedSyntaxScheme } = require('../formatting/stringifySyntax');
const { applyProsePrettyConfig } = require('./scribblesConfigProse');

/**
 * Default visible caption for `groupEnd` when the caller does not pass an override string.
 * @param {string} label - Label stored on the group stack; may be empty.
 * @returns {string} The label, or the string "Group" when empty.
 */
function defaultGroupEndCaption(label) {
  return label ? label : 'Group';
}

/**
 * Creates the config function for scribbles
 * @param {Object} deps - Dependencies
 * @param {Object} deps.scribbles - The scribbles object to configure
 * @param {Function} deps.scribble - The core scribble function
 * @param {Object} deps.gitValues - Git info
 * @param {Object} deps.cuidPrefix - Object with get/set for prefix
 * @param {string} deps.cuidPrefixRaw - Raw prefix string
 * @param {string[]} deps.resirvedFnNames - Reserved function names
 * @returns {Function} The config function
 */
function createConfig(deps) {
  const { scribbles, scribble, gitValues, cuidPrefix, cuidPrefixRaw, resirvedFnNames } = deps;

  /**
   * Configures scribbles with the given options
   * @param {Object} [opts] - Configuration options
   */
  return function scribblesConfig(opts = {}) {

    if (opts && opts.levels) {
      opts.levels.forEach((logLevel) => {
        if (-1 < resirvedFnNames.indexOf(logLevel)) {
          throw new Error('You cant use "' + logLevel + '" as a log level!')
        }
      }) // END forEach
    } // END if

    // Clean config - remove old log level functions
    config.levels.forEach((logLevel) => {
      delete scribbles[logLevel];
    })

    // Overwrite options
    const defaultPretty = config.pretty = config.pretty || {}

    Object.assign(config, opts);
    // Shallow copy avoids `Object.assign(config.pretty, a, config.pretty)` when
    // `opts.pretty` replaced `config.pretty` by reference — user keys must win.
    const prettyIncoming = opts.pretty ? { ...opts.pretty } : {};
    Object.assign(config.pretty, defaultPretty, prettyIncoming);

    // Setup colors configuration
    if (config.colors === undefined) {
      // Dev mode: colors enabled by default (if TTY supports it)
      // Prod mode: colors disabled by default
      if (config.mode.toLowerCase() === 'dev') {
        config.colors = shouldEnableColors();
      } else {
        config.colors = false;
      }
    }

    // Setup color scheme
    if (config.colors) {
      if (!config.colorScheme) {
        config.colorScheme = config.colorblindMode
          ? { ...colorblindScheme }
          : { ...defaultColorScheme };
      } else {
        // Merge user colorScheme with defaults
        const baseScheme = config.colorblindMode
          ? colorblindScheme
          : defaultColorScheme;
        config.colorScheme = { ...baseScheme, ...config.colorScheme };
      }
    }

    // Setup pretty printing — `config.pretty` is guaranteed truthy here
    // because the `config.pretty = config.pretty || {}` on line 45
    // already ran for this call, and the `Object.assign(config, opts)`
    // above only replaces `pretty` with a user-supplied OBJECT (never
    // with a falsy value in any documented call shape). The prior
    // defensive `config.pretty = config.pretty || {}` at this line was
    // dead code and was removed per CASE's dead-code rule.
    if (undefined === config.pretty.inlineCharacterLimit) {
      if ("dev" === config.mode.toLowerCase()) {
        config.pretty.inlineCharacterLimit = process.stdout && process.stdout.columns || 80
        if (undefined === config.pretty.indent) {
          config.pretty.indent = "  "
        }
      } else {
        config.pretty.inlineCharacterLimit = Number.POSITIVE_INFINITY
      }
    }

    if (undefined === config.pretty.singleQuotes) {
      config.pretty.singleQuotes = false
    }

    // Value-column syntax highlighting (keys, brackets, types, …) defaults on; set false to opt out.
    if (undefined === config.pretty.syntaxHighlight) {
      config.pretty.syntaxHighlight = true;
    }

    // Resolved syntax palette for value serialization (used when colors + syntaxHighlight)
    if (config.colors && config.pretty && config.pretty.syntaxHighlight) {
      config.pretty.__syntaxColorResolved = mergeResolvedSyntaxScheme(
        !!config.colorblindMode,
        config.pretty.syntaxColorScheme
      );
    } else if (config.pretty) {
      delete config.pretty.__syntaxColorResolved;
    }

    applyProsePrettyConfig(config);

    // Setup git info from environment
    if (config.gitEnv) {
      if (config.gitEnv.hash
        && process.env[config.gitEnv.hash]) {
        gitValues.hash = process.env[config.gitEnv.hash].substr(0, 7)
      }
      if (config.gitEnv.repo
        && process.env[config.gitEnv.repo]) {
        gitValues.repo = process.env[config.gitEnv.repo]
      }
      if (config.gitEnv.branch
        && process.env[config.gitEnv.branch]) {
        gitValues.branch = process.env[config.gitEnv.branch]
      }
    } // END packageJson_scribbles.gitEnv

    cuidPrefix.set(gitValues.hash.slice(-2) + cuidPrefixRaw)

    // Setup log levels
    config.logRange = config.levels.indexOf(config.logLevel)

    config.levels.forEach((logLevel, index) => {
      if (index <= config.logRange) {
        scribbles[logLevel] = scribble.bind(null, null, logLevel)
        scribbles[logLevel].at = function at(from, label, value, error) {
          const args = Array.prototype.slice.call(arguments)
          args.splice(1, 0, logLevel);
          return scribble.apply(null, args)
        }
      } else {
        scribbles[logLevel] = () => { }
        scribbles[logLevel].at = () => { }
      }
    }) // END config.levels.forEach

    // Attach log functions to a global object if configured
    if (config.global) {
      const globalTarget = config.global === "global" ? global
        : config.global === "console" ? console
        : config.global;
      config.levels.forEach((logLevel) => {
        globalTarget[logLevel] = scribbles[logLevel];
      });
    }

    scribbles.status = scribble.bind(null, null, "statusX")
    scribbles.status.at = function at(from, label, value, error) {
      const args = Array.prototype.slice.call(arguments)
      args[1] = "statusX"
      return scribble.apply(null, args)
    }

    const times = {}

    /**
     * Formats and logs timer output with elapsed and increment times
     * @param {Object} from - Source location info
     * @param {string} level - Log level (timer or timerEnd)
     * @param {string} tag - Timer tag identifier
     * @param {string} [message] - Optional message
     * @returns {Object} The structured log body
     */
    function timePrint(from, level, tag, message) {
      tag = tag + ""
      const timeAr = times[tag]
      let elapsed = 0, increment = 0
      if (1 < timeAr.length) {
        const [a, b] = timeAr.slice(-2)
        increment = b - a
        elapsed = timeAr[timeAr.length - 1] - timeAr[0]
      }
      return scribble.call({ originalMessage: message },
        from,
        level,
        `${tag}${message ? `:${message}` : ""} (+${increment.toFixed(2)}ms|${elapsed.toFixed(2)}ms)`,
        { tag, elapsed, increment })
    } // END timePrint

    scribbles.timer = (tag, message) => {
      tag = tag + ""
      const t = times[tag] || []
      t.push(Math.round(performance.now() * 100) / 100)
      times[tag] = t
      return timePrint(getSource(new Error().stack), "timer", tag, message)
    } // END timeLog

    scribbles.timerEnd = (tag, message) => {
      tag = tag + ""
      if (!times[tag]) {
        throw new Error(`Timer '${tag}' does not exist`)
      }
      times[tag].push(performance.now())
      const result = timePrint(getSource(new Error().stack), "timerEnd", tag, message)
      delete times[tag]
      return result
    }// END timeEnd

    // Group functions (issue #13)
    let groupIdCounter = 0
    const groupStack = [] // Array of { id, label, collapsed }

    scribbles.group = {
      start: (label) => {
        const id = ++groupIdCounter
        groupStack.push({ id, label: label || '' })
        const from = getSource(new Error().stack)
        const result = scribble.call(null, from, 'group', label || 'Group')
        result.groupId = id
        return id
      },

      collapsed: (label) => {
        const id = ++groupIdCounter
        groupStack.push({ id, label: label || '', collapsed: true })
        const from = getSource(new Error().stack)
        const result = scribble.call(null, from, 'groupCollapsed', label || 'Group')
        result.groupId = id
        return id
      },

      /**
       * Close a group and emit `groupEnd` with a visible summary line.
       *
       * Domain: operators need closing lines to name what finished, mirroring
       * `group.start` labels — default is the same label stored at start; callers
       * can override per close.
       *
       * Call shapes (first arg type disambiguates):
       * - `end()` — LIFO pop; message = started label or `"Group"`.
       * - `end("summary")` — LIFO pop; message = `"summary"`.
       * - `end(id)` — splice from `id`; message = that group's stored label (or `"Group"`).
       * - `end(id, "summary")` — splice from `id`; message = `"summary"` (empty string allowed).
       *
       * Technical: unknown `id` skips splice (existing no-op semantics); message falls
       * back to `''` when nothing was closed and no override was passed.
       *
       * @param {number|string|undefined} groupIdOrEndLabel - Numeric id, or LIFO end-caption string, or omit.
       * @param {string|undefined} endLabel - When first arg is id, optional caption (including `''`).
       * @returns {Object} Log body from `scribble`.
       */
      end: (groupIdOrEndLabel, endLabel) => {
        const from = getSource(new Error().stack)
        /** @type {number|undefined} */
        let targetId
        /** @type {string|undefined} */
        let messageOverride

        if (typeof groupIdOrEndLabel === 'number') {
          targetId = groupIdOrEndLabel
          if (typeof endLabel === 'string') {
            messageOverride = endLabel
          }
        } else if (typeof groupIdOrEndLabel === 'string') {
          messageOverride = groupIdOrEndLabel
        }

        if (targetId !== undefined) {
          const idx = groupStack.findIndex(g => g.id === targetId)
          if (idx !== -1) {
            const closed = groupStack[idx]
            groupStack.splice(idx)
            const msg =
              messageOverride !== undefined
                ? messageOverride
                : defaultGroupEndCaption(closed.label)
            return scribble.call(null, from, 'groupEnd', msg)
          }
          const msg = messageOverride !== undefined ? messageOverride : ''
          return scribble.call(null, from, 'groupEnd', msg)
        }

        const popped = groupStack.pop()
        if (!popped) {
          const msg = messageOverride !== undefined ? messageOverride : ''
          return scribble.call(null, from, 'groupEnd', msg)
        }
        const msg =
          messageOverride !== undefined
            ? messageOverride
            : defaultGroupEndCaption(popped.label)
        return scribble.call(null, from, 'groupEnd', msg)
      }
    }

    // Export groupStack for scribble.js to access
    scribbles._groupStack = groupStack

    config.__compile = compile(config.format)

  } // END scribblesConfig
}

module.exports = { createConfig };
