/**
 * @file Scenarios: many requests arrive carrying the same W3C traceparent
 *
 * Domain: an upstream gateway retries or fans out calls to a service, so the same
 * valid `traceparent` header (`00-<32 hex trace id>-<16 hex parent id>-01`) reaches
 * it again and again. Every request must be logged and propagated under the same
 * 32-hex trace id, not only every other one.
 *
 * Technical: tests use the public API only (`require('../index')`, `scribbles.config`,
 * `scribbles.trace`, `scribbles.log`, `scribbles.trace.headers`) and assert on the
 * `trace.traceId` of the `dataOut` entries and on the outgoing `traceparent` header.
 */

const scribbles = require('../index');

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const TRACEPARENT = `00-${TRACE_ID}-b7ad6b7169203331-01`;

describe('Scenario: the same traceparent arrives on consecutive requests', () => {
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

  it('four requests with one valid traceparent are all logged under the same trace id', () => {
    for (let request = 0; request < 4; request++) {
      scribbles.trace({ traceId: TRACEPARENT }, () => scribbles.log(`request ${request}`));
    }

    expect(entries.map((entry) => entry.trace.traceId)).toEqual(Array(4).fill(TRACE_ID));
  });

  it('four requests with one valid traceparent all forward the same trace id downstream', () => {
    const forwarded = [];
    for (let request = 0; request < 4; request++) {
      scribbles.trace({ traceId: TRACEPARENT }, () => {
        forwarded.push(scribbles.trace.headers().traceparent.split('-')[1]);
      });
    }

    expect(forwarded).toEqual(Array(4).fill(TRACE_ID));
  });

  it('a plain trace id between traceparent requests is kept as given and does not disturb them', () => {
    scribbles.trace({ traceId: TRACEPARENT }, () => scribbles.log('first'));
    scribbles.trace({ traceId: 'my-own-trace-id' }, () => scribbles.log('plain'));
    scribbles.trace({ traceId: TRACEPARENT }, () => scribbles.log('second'));
    scribbles.trace({ traceId: TRACEPARENT }, () => scribbles.log('third'));

    expect(entries.map((entry) => entry.trace.traceId))
      .toEqual([TRACE_ID, 'my-own-trace-id', TRACE_ID, TRACE_ID]);
  });
});
