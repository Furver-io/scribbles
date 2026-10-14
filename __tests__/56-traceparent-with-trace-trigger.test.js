/**
 * @file Scenarios: a request with an inbound traceparent runs under a traceTrigger
 *
 * Domain: a service sits behind a gateway that sends a W3C `traceparent`. It wants
 * the quiet-until-trouble behaviour of `traceTrigger` (buffer the request's logs,
 * flush them when an error happens) and wants every entry tagged with the request
 * it belongs to (url, path, query, params, method), plus the caller's span id
 * (`parentId`) so the trace can be stitched together downstream.
 *
 * Technical: tests use the public API only (`require('../index')`, `scribbles.config`
 * with `traceTrigger`, `scribbles.trace` with request fields, `scribbles.log`,
 * `scribbles.error`, `scribbles.trace.headers`) and assert on the `dataOut` entries,
 * the outgoing headers and the fact that logging inside the trace never throws.
 */

const scribbles = require('../index');

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_ID}-01`;

const REQUEST = {
  headers: { 'x-request-id': 'req-42' },
  url: '/orders/7?expand=items',
  path: '/orders/7',
  query: { expand: 'items' },
  params: { id: '7' },
  method: 'POST'
};

describe('Scenario: inbound traceparent combined with traceTrigger', () => {
  let entries;

  /**
   * @param {string|undefined} traceTrigger - level that flushes the buffered logs
   * @returns {void}
   */
  const setup = (traceTrigger) => {
    entries = [];
    scribbles.config({
      mode: 'dev',
      logLevel: 'debug',
      levels: ['error', 'warn', 'info', 'log', 'debug'],
      stdOut: null,
      dataOut: (entry) => entries.push(entry),
      traceTrigger,
      headers: null,
      headersMapping: undefined
    });
  };

  afterAll(() => setup(undefined));

  it('logging inside the trace does not throw and the quiet logs wait for the trigger', () => {
    setup('error');

    expect(() => scribbles.trace({ traceId: TRACEPARENT, ...REQUEST }, () => {
      scribbles.info('quiet so far');
      expect(entries).toHaveLength(0);
      scribbles.error('now it hurts');
    })).not.toThrow();

    expect(entries.map((entry) => entry.input.message)).toEqual(['quiet so far', 'now it hurts']);
  });

  it('every flushed entry still carries the request it belongs to', () => {
    setup('error');

    scribbles.trace({ traceId: TRACEPARENT, spanLabel: 'order-api', ...REQUEST }, () => {
      scribbles.info('before');
      scribbles.error('failure');
      scribbles.info('after');
    });

    expect(entries).toHaveLength(3);
    for (const { trace } of entries) {
      expect(trace).toMatchObject({
        traceId: TRACE_ID,
        spanLabel: 'order-api',
        url: REQUEST.url,
        path: REQUEST.path,
        query: REQUEST.query,
        params: REQUEST.params,
        method: REQUEST.method
      });
    }
  });

  it('outgoing calls still forward the request headers and the inbound trace id', () => {
    setup('error');

    const outgoing = scribbles.trace({ traceId: TRACEPARENT, ...REQUEST }, () => scribbles.trace.headers());

    expect(outgoing['x-request-id']).toBe('req-42');
    expect(outgoing.traceparent.split('-')[1]).toBe(TRACE_ID);
  });

  it('request fields are kept when a traceparent is used without a traceTrigger', () => {
    setup(undefined);

    scribbles.trace({ traceId: TRACEPARENT, ...REQUEST }, () => scribbles.info('plain'));

    expect(entries).toHaveLength(1);
    expect(entries[0].trace).toMatchObject({ traceId: TRACE_ID, path: '/orders/7', method: 'POST' });
  });

  it('the caller span id from the traceparent is reported as parentId', () => {
    setup(undefined);

    scribbles.trace({ traceId: TRACEPARENT }, () => scribbles.info('with parent'));
    scribbles.trace({ traceId: 'no-parent-here' }, () => scribbles.info('without parent'));

    expect(entries[0].trace.parentId).toBe(PARENT_ID);
    expect(entries[1].trace.parentId).toBeUndefined();
  });
});
