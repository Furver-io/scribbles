/**
 * @file Scenarios: a service wraps its work in `scribbles.trace` and needs the result back
 *
 * Domain: a service wraps each incoming job in `scribbles.trace(...)` so every log
 * line it writes carries the job's trace id. The caller of the wrapper (a queue
 * consumer, a request router, a test) needs what the job produced: the value of a
 * synchronous handler, the result of an async handler, or its failure.
 *
 * Technical: tests only use the public API from the ReadMe
 * (`require('../index')`, `scribbles.config`, `scribbles.trace`, `scribbles.log`) and
 * assert on what a caller can observe: the returned value, the awaited result, the
 * rejection, the arguments handed to the callback and the `dataOut` entries. The
 * callback's first argument stays the span id string the ReadMe documents; the
 * second argument is a `{ traceId, spanId }` context object.
 */

const scribbles = require('../index');

describe('Scenario: tracing a unit of work and getting its result back', () => {
  let entries;

  beforeEach(() => {
    entries = [];
    scribbles.config({
      mode: 'dev',
      logLevel: 'debug',
      stdOut: null,
      dataOut: (entry) => entries.push(entry),
      traceTrigger: undefined,
      headers: null,
      headersMapping: undefined
    });
  });

  it('a service traces a synchronous handler and the caller receives its result', () => {
    const answer = scribbles.trace('sync-job', () => {
      scribbles.log('working');
      return { status: 'done', count: 3 };
    });

    expect(answer).toEqual({ status: 'done', count: 3 });
    expect(entries).toHaveLength(1);
    expect(entries[0].trace.spanLabel).toBe('sync-job');
  });

  it('a service traces an async handler and the caller receives its result', async () => {
    const answer = await scribbles.trace({ spanLabel: 'async-job' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      scribbles.log('after the first await');
      return 'job result';
    });

    expect(answer).toBe('job result');
    expect(entries).toHaveLength(1);
    expect(entries[0].trace.spanLabel).toBe('async-job');
  });

  it('a caller gets the very promise the async handler returned', () => {
    const pending = Promise.resolve('ready');

    const returned = scribbles.trace(() => pending);

    expect(returned).toBe(pending);
  });

  it('a failing async handler rejects to the caller instead of becoming unhandled', async () => {
    const failure = new Error('job exploded');

    await expect(scribbles.trace('failing-job', async () => {
      await Promise.resolve();
      throw failure;
    })).rejects.toBe(failure);
  });

  it('a throwing synchronous handler still throws to the caller', () => {
    expect(() => scribbles.trace(() => { throw new Error('sync boom'); })).toThrow('sync boom');
  });

  it('a handler that returns nothing gives the caller undefined', () => {
    expect(scribbles.trace('quiet-job', () => {})).toBeUndefined();
  });

  it('a handler still receives the span id string first and the trace context second', () => {
    scribbles.trace('ids', (spanId, context) => {
      scribbles.log('inside');

      expect(typeof spanId).toBe('string');
      expect(context).toEqual({ traceId: entries[0].trace.traceId, spanId });
      expect(spanId).toBe(entries[0].trace.spanId);
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    expect(entries).toHaveLength(1);
  });

  it('the context carries the inbound trace id when the caller supplies a traceparent', () => {
    const inbound = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

    const seen = scribbles.trace({ traceId: inbound }, (spanId, context) => context);

    expect(seen.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });
});
