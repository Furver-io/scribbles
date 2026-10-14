/**
 * @file Scenarios: a misspelled log level is rejected instead of silencing every log
 *
 * Domain: an operator sets `LOG_LEVEL=warning` (the level is called `warn`) or a developer
 * calls `scribbles.config({ logLevel: 'warning' })` against the default levels. Before the
 * fix every log call, errors included, became a silent no-op and the service ran blind. Now
 * the mistake is refused with an error that names the bad level and lists the valid ones, and
 * the previous working setup stays in place. For the environment variable that means the app
 * stops at start-up (fail fast, visible in the first deploy) rather than running without logs.
 *
 * Technical: in-process stories reach scribbles through `require('../index')` and assert on
 * the exception and on what the logger still prints afterwards. The `LOG_LEVEL` stories need a
 * fresh process because the variable is read when scribbles loads, so they spawn
 * `fixtures/log-level-env/entry.js` through the scenario harness and assert on exit code and
 * output. Each in-process test resets the options it relies on because `scribbles.config`
 * merges into earlier calls. The module is loaded once for the whole file.
 */

const path = require('path');
const scribbles = require('../index');
const { runScenario } = require('./scenarios/harness/spawn.cjs');

const ENTRY = path.resolve(__dirname, 'scenarios', 'fixtures', 'log-level-env', 'entry.js');
const DEFAULT_LEVELS = ['error', 'warn', 'log', 'info', 'debug'];

describe('Scenario: an unknown logLevel passed to config()', () => {
  let printed;

  beforeEach(() => {
    printed = [];
    scribbles.config({
      mode: 'dev',
      levels: DEFAULT_LEVELS,
      logLevel: 'debug',
      format: '{message}',
      stdOut: (line) => printed.push(line),
      dataOut: null,
      traceTrigger: undefined
    });
  });

  describe('a developer who writes logLevel "warning" with the default levels', () => {
    it('gets an Error that names the bad level and lists the valid ones', () => {
      let caught;
      try {
        scribbles.config({ logLevel: 'warning' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toContain('"warning"');
      expect(caught.message).toContain('error, warn, log, info, debug');
    });

    it('does not silence errors: the previous working setup stays in place', () => {
      expect(() => scribbles.config({ logLevel: 'warning' })).toThrow();

      scribbles.error('payment failed');
      scribbles.debug('still debug level');

      expect(printed).toEqual(['payment failed', 'still debug level']);
    });

    it('is told even when the level only differs by case', () => {
      expect(() => scribbles.config({ logLevel: 'WARN' })).toThrow(/"WARN"/);
    });

    it('is told when logLevel is set to nothing at all', () => {
      expect(() => scribbles.config({ logLevel: undefined })).toThrow(/"undefined"/);
    });
  });

  describe('every documented level is still accepted', () => {
    it.each(DEFAULT_LEVELS)('lets "%s" through and silences only the levels below it', (level) => {
      scribbles.config({ logLevel: level });

      DEFAULT_LEVELS.forEach((name) => scribbles[name](`${name} message`));

      const expected = DEFAULT_LEVELS
        .slice(0, DEFAULT_LEVELS.indexOf(level) + 1)
        .map((name) => `${name} message`);
      expect(printed).toEqual(expected);
    });
  });

  describe('a developer who defines their own levels', () => {
    it('can use the ReadMe levels with a logLevel that is one of them', () => {
      scribbles.config({
        levels: ['fatal', 'error', 'warning', 'info'],
        logLevel: 'warning'
      });

      scribbles.fatal('fatal shown');
      scribbles.warning('warning shown');
      scribbles.info('info hidden');

      expect(printed).toEqual(['fatal shown', 'warning shown']);
    });

    it('is told when new levels leave the current logLevel without a match', () => {
      // logLevel is still 'debug' from the previous setup but the new levels have no 'debug'.
      let caught;
      try {
        scribbles.config({ levels: ['fatal', 'error'] });
      } catch (err) {
        caught = err;
      }

      expect(caught.message).toContain('"debug"');
      expect(caught.message).toContain('fatal, error');
    });

    it('is not told anything when levels and logLevel are changed together', () => {
      expect(() => scribbles.config({ levels: ['fatal', 'error'], logLevel: 'error' })).not.toThrow();
    });
  });
});

describe('Scenario: an unknown LOG_LEVEL environment variable', () => {
  it('an operator who mistypes LOG_LEVEL is told at start-up instead of running without logs', () => {
    const result = runScenario({ runtime: 'node', entry: ENTRY, env: { LOG_LEVEL: 'bogus' } });

    expect(result.timedOut).toBe(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('"bogus"');
    expect(result.stderr).toContain('LOG_LEVEL');
    expect(result.stderr).toContain('error, warn, log, info, debug');
    expect(result.stdout).not.toContain('app started');
  });

  it('LOG_LEVEL=warn keeps errors and warnings and hides the rest', () => {
    const result = runScenario({ runtime: 'node', entry: ENTRY, env: { LOG_LEVEL: 'warn' } });

    expect(result.status).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual([
      'level error shown',
      'level warn shown',
      'app started'
    ]);
  });

  it('an empty LOG_LEVEL means the default and shows every level', () => {
    const result = runScenario({ runtime: 'node', entry: ENTRY, env: { LOG_LEVEL: '' } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('level debug shown');
  });
});
