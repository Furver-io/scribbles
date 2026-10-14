/**
 * @file Scenarios: outgoing requests made OUTSIDE any trace carry no trace headers
 *
 * Domain: a service has `headers` configured so calls made while handling a
 * request propagate the trace. It also makes calls with no request behind
 * them: a boot-time health check, a cron job, a warm-up call. There is no
 * trace to propagate, so those calls must leave exactly as the developer
 * wrote them. They must never carry a made-up `traceparent`, and a
 * downstream service must never see `undefined` where a trace id belongs.
 *
 * Technical: loads scribbles once through `require('../index')` (what users
 * get from `require('scribbles')`), makes REAL `http.request` calls against a
 * local `http.createServer` on port 0 and asserts on the headers the server
 * received. Nothing private is touched. Each story restores the config it
 * changed so later test files in the same worker are unaffected.
 */

'use strict';

const http = require('http');
const scribbles = require('../index');

describe('Scenario: calls with no trace behind them', () => {
  let server;
  let port;
  let received;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      received = req.headers;
      res.end('ok');
    });
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    scribbles.config({ headers: null, headersMapping: undefined });
    server.close(done);
  });

  beforeEach(() => {
    received = null;
    scribbles.config({
      stdOut: null,
      dataOut: null,
      vendor: 'acme',
      headers: ['x-request-id'],
      headersMapping: undefined
    });
  });

  /**
   * Makes one real GET to the local server and resolves with the headers it saw.
   *
   * @param {Object} [headers] - caller-provided request headers
   * @returns {Promise<Object>} the headers the server received
   */
  const call = (headers) => new Promise((resolve, reject) => {
    http.request({ port, host: '127.0.0.1', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(received));
    }).on('error', reject).end();
  });

  it('a boot-time health check outside a trace sends no traceparent or tracestate', async () => {
    const seen = await call();

    expect(seen).not.toHaveProperty('traceparent');
    expect(seen).not.toHaveProperty('tracestate');
  });

  it('a call outside a trace keeps the headers the developer set, and adds nothing', async () => {
    const seen = await call({ authorization: 'Bearer abc', 'x-request-id': 'r-1' });

    expect(seen.authorization).toBe('Bearer abc');
    expect(seen['x-request-id']).toBe('r-1');
    expect(seen).not.toHaveProperty('traceparent');
    expect(JSON.stringify(seen)).not.toContain('undefined');
  });

  it('headersMapping alone does not make an untraced call carry a trace', async () => {
    scribbles.config({ headers: null, headersMapping: { 'x-correlation': 'x-request-id' } });

    const seen = await call();

    expect(seen).not.toHaveProperty('traceparent');
    expect(seen).not.toHaveProperty('tracestate');
  });

  it('the same service still propagates the trace for a call made inside one', async () => {
    const seen = await new Promise((resolve) => {
      scribbles.trace({ traceId: 'order-77' }, () => call().then(resolve));
    });

    expect(seen.traceparent).toMatch(/^00-order-77-[0-9a-f]+-01$/);
    expect(seen.tracestate).toMatch(/^acme=/);
  });

  it('a call made after the trace has ended carries no trace again', async () => {
    await new Promise((resolve) => {
      scribbles.trace({ traceId: 'order-78' }, () => call().then(resolve));
    });

    const seen = await call();

    expect(seen).not.toHaveProperty('traceparent');
  });

  it('trace.headers() outside a trace returns only the headers it was given', () => {
    expect(scribbles.trace.headers()).toEqual({});
    expect(scribbles.trace.headers({ 'x-mine': '1' })).toEqual({ 'x-mine': '1' });
  });
});
