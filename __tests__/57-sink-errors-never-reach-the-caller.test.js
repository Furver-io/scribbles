/**
 * @file Scenarios: a failing log destination never breaks the code that logged
 *
 * Domain: a service ships its logs to somewhere that can fail (a log vendor,
 * a socket, a full disk, a formatter bug). The request handler that called
 * `scribbles.info(...)` must keep working, the healthy destination must keep
 * receiving entries, and the operator must be able to find out that a
 * destination broke: through an optional `onSinkError(error, sink, entry)`
 * hook, or, when no hook is set, through one line on stderr per broken sink.
 * A stdOut object that cannot print a configured level is a setup mistake and
 * is rejected when the options are applied, not on some later log call.
 *
 * Technical: every test reaches scribbles through `require('../index')` (the
 * same entry users get from `require('scribbles')`) and asserts only on what
 * the caller and the operator can observe: exceptions, return values, what the
 * healthy destinations received, hook calls and stderr output. Each test
 * resets the options it relies on because `scribbles.config` merges into
 * earlier calls. The module is loaded once for the whole file.
 */

const scribbles = require('../index');

describe('Scenario: a failing log destination', () => {
  let printed;
  let shipped;
  let sinkErrors;
  let stderr;

  beforeEach(() => {
    printed = [];
    shipped = [];
    sinkErrors = [];
    stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    scribbles.config({
      mode: 'dev',
      logLevel: 'debug',
      levels: ['error', 'warn', 'log', 'info', 'debug'],
      format: '{message}',
      stdOut: (line) => printed.push(line),
      dataOut: (entry) => shipped.push(entry),
      onSinkError: undefined,
      traceTrigger: undefined,
      stringify: undefined
    });
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  describe('a failing log shipper never breaks the request handler that logged', () => {
    it('lets the handler carry on and still returns the log entry', () => {
      scribbles.config({ dataOut: () => { throw new Error('vendor is down'); } });

      let entry;
      expect(() => { entry = scribbles.info('order placed', { id: 7 }); }).not.toThrow();

      expect(entry.input.message).toBe('order placed');
    });

    it('still prints the line on stdOut when dataOut fails', () => {
      scribbles.config({ dataOut: () => { throw new Error('vendor is down'); } });

      scribbles.info('order placed');

      expect(printed).toEqual(['order placed']);
    });

    it('keeps working on the next call after a failure', () => {
      let calls = 0;
      scribbles.config({
        dataOut: (entry) => {
          calls += 1;
          if (calls === 1) throw new Error('first call only');
          shipped.push(entry);
        }
      });

      scribbles.info('first');
      scribbles.info('second');

      expect(shipped.map((e) => e.input.message)).toEqual(['second']);
    });

    it('does not break a handler inside a trace that flushes buffered logs', () => {
      scribbles.config({
        traceTrigger: 'error',
        dataOut: () => { throw new Error('vendor is down'); }
      });

      expect(() => {
        scribbles.trace('checkout', () => {
          scribbles.info('buffered');
          scribbles.error('trigger flush');
        });
      }).not.toThrow();
      expect(printed).toEqual(['buffered', 'trigger flush']);
    });
  });

  describe('a failing terminal printer never breaks the caller', () => {
    it('lets the caller carry on and still ships the entry to dataOut', () => {
      scribbles.config({ stdOut: () => { throw new Error('stdout closed'); } });

      expect(() => scribbles.warn('disk almost full')).not.toThrow();

      expect(shipped.map((e) => e.input.message)).toEqual(['disk almost full']);
    });

    it('survives a formatter that cannot render the value', () => {
      scribbles.config({ stringify: () => { throw new Error('cannot render'); } });

      expect(() => scribbles.info('hello', { any: 'value' })).not.toThrow();

      expect(shipped.length).toBe(1);
    });

    it('survives a stdOut object whose method for the level throws', () => {
      scribbles.config({
        stdOut: {
          log: () => { throw new Error('console detached'); }
        }
      });

      expect(() => scribbles.log('hello')).not.toThrow();
    });
  });

  describe('an operator can find out which destination broke', () => {
    it('calls onSinkError with the error, "dataOut" and the entry', () => {
      const failure = new Error('vendor is down');
      scribbles.config({
        dataOut: () => { throw failure; },
        onSinkError: (...args) => sinkErrors.push(args)
      });

      scribbles.info('order placed');

      expect(sinkErrors.length).toBe(1);
      const [err, sink, entry] = sinkErrors[0];
      expect(err).toBe(failure);
      expect(sink).toBe('dataOut');
      expect(entry.input.message).toBe('order placed');
    });

    it('calls onSinkError with "stdOut" when the printer fails', () => {
      const failure = new Error('stdout closed');
      scribbles.config({
        stdOut: () => { throw failure; },
        onSinkError: (...args) => sinkErrors.push(args)
      });

      scribbles.info('order placed');

      expect(sinkErrors.length).toBe(1);
      expect(sinkErrors[0][0]).toBe(failure);
      expect(sinkErrors[0][1]).toBe('stdOut');
      expect(sinkErrors[0][2].input.message).toBe('order placed');
    });

    it('reports every failing destination separately when both fail', () => {
      scribbles.config({
        stdOut: () => { throw new Error('stdout closed'); },
        dataOut: () => { throw new Error('vendor is down'); },
        onSinkError: (err, sink) => sinkErrors.push(sink)
      });

      scribbles.info('order placed');

      expect(sinkErrors).toEqual(['stdOut', 'dataOut']);
    });

    it('reports every failure to the hook, not just the first', () => {
      scribbles.config({
        dataOut: () => { throw new Error('vendor is down'); },
        onSinkError: (err, sink) => sinkErrors.push(sink)
      });

      scribbles.info('one');
      scribbles.info('two');

      expect(sinkErrors).toEqual(['dataOut', 'dataOut']);
    });

    it('does not also write to stderr when a hook is handling failures', () => {
      scribbles.config({
        dataOut: () => { throw new Error('vendor is down'); },
        onSinkError: () => {}
      });

      scribbles.info('order placed');

      expect(stderr).not.toHaveBeenCalled();
    });

    it('never lets a throwing onSinkError hook break the caller', () => {
      scribbles.config({
        dataOut: () => { throw new Error('vendor is down'); },
        onSinkError: () => { throw new Error('hook is broken too'); }
      });

      expect(() => scribbles.info('order placed')).not.toThrow();
      expect(printed).toEqual(['order placed']);
    });

    it('writes one line to stderr per broken destination when no hook is set', () => {
      const brokenShipper = () => { throw new Error('vendor is down'); };
      scribbles.config({ dataOut: brokenShipper });

      scribbles.info('one');
      scribbles.info('two');
      scribbles.info('three');

      expect(stderr).toHaveBeenCalledTimes(1);
      const line = stderr.mock.calls[0][0];
      expect(line).toMatch(/scribbles/);
      expect(line).toMatch(/dataOut/);
      expect(line).toMatch(/vendor is down/);
      expect(line).toMatch(/onSinkError/);
    });

    it('reports a replacement destination again when it breaks in turn', () => {
      scribbles.config({ dataOut: () => { throw new Error('first vendor down'); } });
      scribbles.info('one');
      scribbles.config({ dataOut: () => { throw new Error('second vendor down'); } });
      scribbles.info('two');

      expect(stderr).toHaveBeenCalledTimes(2);
      expect(stderr.mock.calls[1][0]).toMatch(/second vendor down/);
    });

    it('ignores an onSinkError that is not a function and writes to stderr', () => {
      scribbles.config({
        dataOut: () => { throw new Error('vendor is down'); },
        onSinkError: 'not a function'
      });

      expect(() => scribbles.info('order placed')).not.toThrow();

      expect(stderr).toHaveBeenCalledTimes(1);
    });
  });

  describe('a stdOut object that cannot print a level you enabled', () => {
    it('is rejected when applying the options, naming the level', () => {
      expect(() => scribbles.config({
        stdOut: { error: () => {} },
        levels: ['error', 'warn', 'log'],
        logLevel: 'log'
      })).toThrow(/warn was not found on stdOut/);
    });

    it('is accepted when the missing levels are switched off by logLevel', () => {
      const errors = [];
      scribbles.config({
        stdOut: { error: (line) => errors.push(line) },
        levels: ['error', 'warn', 'log'],
        logLevel: 'error'
      });

      scribbles.error('only errors');
      scribbles.warn('switched off');

      expect(errors).toEqual(['only errors']);
    });

    it('leaves the previous working setup in place when the options are rejected', () => {
      expect(() => scribbles.config({ stdOut: { error: () => {} } })).toThrow();

      scribbles.info('still printed by the old stdOut');

      expect(printed).toEqual(['still printed by the old stdOut']);
    });

    it('does not break the caller when a timer needs a level the object lacks', () => {
      scribbles.config({
        stdOut: { error: () => {}, warn: () => {} },
        levels: ['error', 'warn'],
        logLevel: 'warn',
        onSinkError: (err, sink) => sinkErrors.push([sink, err.message])
      });

      expect(() => scribbles.timer('job')).not.toThrow();

      expect(sinkErrors).toEqual([['stdOut', 'timer was not found on stdOut']]);
    });
  });
});
