/**
 * @file Core scribble logging function
 */
const config = require('./config');
const args2keys = require('../parsing/args2keys');
const { getSource } = require('../utils/helpers');
const status = require('../system/status');
const { myNamespace } = require('../tracing/namespace');
const { parceStringVals } = require('../parsing/parceStringVals');
const { formatScribbleStdOutLine } = require('./scribbleStdOutFormat');

const notUsed = { not: 'used' }

/**
 * Creates the core scribble function with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {string} deps.sVer - Scribbles version
 * @param {Object} deps.gitValues - Git info (repo, branch, hash)
 * @param {string} deps.hostname - Machine hostname
 * @param {string} deps.cuidPrefix - Unique instance prefix
 * @param {Object} deps.pValues - Process values
 * @param {Object} deps.scribbles - Reference to scribbles object for group stack access
 * @returns {Function} The scribble logging function
 */
function createScribble(deps) {
  const { sVer, gitValues, hostname, cuidPrefix, pValues, scribbles } = deps;

  /**
   * Core logging function that creates structured log entries
   * @param {Object|null} from - Source location info (file, line, col)
   * @param {string} level - Log level (log, info, warn, error, etc.)
   * @param {...*} args - Log arguments (message, value, error)
   * @returns {Object} The structured log body object
   */
  function scribble(from, level, ...args) {

    const argNames = from ? from.args.map(a => a ? a(parceStringVals) : "") : []

    let statusinfo, now;
    if ("status" === level) {
      const vals = args[1]
      statusinfo = vals.statusinfo;
      now = vals.now

      args[1] = vals.value;
    }

    let { message, value, error, indexs } = args2keys(args, notUsed);
    if ("statusX" === level) {
      const now = new Date();
      from = from || getSource(new Error().stack)
      const body = {}
      status().then(statusinfo => {
        Object.assign(statusinfo.process, pValues)
        const result = scribble(from, "status", message, { statusinfo, value, now }, error)
        Object.assign(body, result)
      })
      return body
    } // END if statusX

    let originalMessage = notUsed !== error
      && notUsed !== message ? error.message
      : undefined;
    if (notUsed === message
      && notUsed !== error) {
      message = error.message;
    }


    let correlaterValue = myNamespace()
    const traceVals = correlaterValue('traceVals') || {};
    const { traceId, spanId, span64, tracestate, spanLabel, trigger, logs,
            url, path, query, params, method } = traceVals

    const stackTrace = notUsed !== error ? error.stack.split("\n")
      .slice(1)
      .filter(line => !!line)
      .map((line) => line.trim().indexOf("at") === 0 ? line.split(/at(.+)/)[1].trim()
        : line.trim())
      : undefined
    from = from || getSource(new Error().stack)

    if (this.originalMessage) {
      originalMessage = this.originalMessage
    }

    const body = {
      v: sVer,
      git: {
        repo: gitValues.repo,
        branch: gitValues.branch,
        hash: gitValues.hash
      },
      trace: {
        traceId,
        spanId,
        span64,
        spanLabel,
        tracestate,
        url,
        path,
        query,
        params,
        method
      },
      info: {
        time: new Date(),
        mode: config.mode,
        hostname,
        instance: cuidPrefix.get(),
        logLevel: level
      },
      context: {
        fileName: from.file,
        lineNumber: from.line,
        method: from.type,
        groupLevel: scribbles._groupStack ? scribbles._groupStack.length : 0,
        groupLabel: scribbles._groupStack ? scribbles._groupStack.map(g => g.label).filter(Boolean).join(' > ') : '',
      },
      input: {
        message: notUsed === message ? undefined : message,
        originalMessage,
        value: notUsed === value ? undefined : value,
        stackTrace,
        from: new Error().stack.split('\n').slice(1).filter(line => !!line).map(line => line.trim())
      },
      toString: function () {
        return formatScribbleStdOutLine({
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
        });
      }
    } // END body

    if (statusinfo) {
      body.status = statusinfo
    }

    /**
     * Outputs the log body to configured destinations
     * @param {Object} body - The structured log body
     */
    const output = (body) => {

      if (config.stdOut) {
        let stdOut;
        if (config.stdOut[level]) {
          stdOut = config.stdOut[level]
        } else if ('function' === typeof config.stdOut) {
          stdOut = config.stdOut
        } else if ('function' === typeof config.stdOut.log) {
          stdOut = config.stdOut.log
        } else {
          throw new Error(`${level} was not found on stdOut`)
        }
        stdOut(body.toString())
      } // END if config.stdOut
      config.dataOut && config.dataOut(body);
    }

    // Am I inside a trace ?
    if (traceId
      && config.traceTrigger) {
      if (trigger) {
        output(body)
      } else if (config.levels.indexOf(config.traceTrigger)
        >= config.levels.indexOf(level)) {
        traceVals.trigger = true;
        logs.forEach(output)
        output(body)
      } else {
        logs.push(body)
      }
    } else {
      output(body)
    }

    return body;
  }// END scribble

  return scribble;
}

module.exports = { createScribble, myNamespace, parceStringVals };
