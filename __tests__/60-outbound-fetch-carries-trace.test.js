/**
 * @file Scenarios: outgoing `fetch` carries the trace of the request being handled
 *
 * Domain: a service traces each incoming request with `scribbles.trace(...)`
 * and calls other services with the global `fetch` (Node 18+ and Bun). The
 * ReadMe promises that, with `headers` configured, scribbles injects the
 * trace headers into outgoing calls so a downstream service continues the
 * same trace. `fetch` is how most new code calls out, so it has to carry the
 * trace in every shape a developer uses it: a URL string or `URL`, a
 * `Request`, headers as an object, a `Headers` instance or an array of
 * pairs, before or after an `await`, and without disturbing what the
 * developer wrote. Stories that need a clean process (a runtime with no global
 * fetch, and Bun) live in `scenarios/outbound-fetch-runtimes.scenarios.test.js`.
 *
 * Technical: loads scribbles once through `require('../index')`, makes REAL
 * `fetch` calls against a local `http.createServer` on port 0 and asserts on
 * the method, body and headers the server actually received, plus on the
 * objects the caller handed in. Config is restored afterwards so later files
 * are unaffected.
 */

'use strict';

const http = require('http');
const scribbles = require('../index');

const TRACEPARENT = /^00-order-60-[0-9a-f]+-01$/;

describe('Scenario: a traced service calls out with fetch', () => {
  let server;
  let base;
  let landed;
  let landedResolve;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        landedResolve({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString()
        });
        res.end('downstream-reply');
      });
    });
    server.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    scribbles.config({ headers: null, headersMapping: undefined });
    server.close(done);
  });

  beforeEach(() => {
    landed = new Promise((resolve) => { landedResolve = resolve; });
    scribbles.config({
      stdOut: null,
      dataOut: null,
      vendor: 'acme',
      headers: ['x-request-id'],
      headersMapping: undefined
    });
  });

  /**
   * Runs `call` inside a trace with a known id and resolves with what the
   * server saw.
   *
   * @param {function(): Promise<Response>} call - issues the fetch
   * @returns {Promise<{method: string, url: string, headers: Object, body: string}>}
   */
  const inTrace = (call) => new Promise((resolve, reject) => {
    scribbles.trace({ traceId: 'order-60' }, () => {
      call().catch(reject);
      landed.then(resolve);
    });
  });

  it('a service traces an incoming request and its outgoing fetch carries the same trace id', async () => {
    const got = await inTrace(() => fetch(`${base}/orders`));

    expect(got.method).toBe('GET');
    expect(got.url).toBe('/orders');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
    expect(got.headers.tracestate).toMatch(/^acme=/);
  });

  it('the caller still gets the downstream reply', async () => {
    const reply = await new Promise((resolve, reject) => {
      scribbles.trace({ traceId: 'order-60' }, () => {
        fetch(`${base}/reply`).then((res) => res.text()).then(resolve, reject);
      });
    });

    expect(reply).toBe('downstream-reply');
  });

  it('the trace survives an await before the fetch', async () => {
    const got = await inTrace(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fetch(`${base}/after-await`);
    });

    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('fetch(URL) is traced', async () => {
    const got = await inTrace(() => fetch(new URL(`${base}/url-object`)));

    expect(got.url).toBe('/url-object');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('headers given as an object are kept next to the trace', async () => {
    const got = await inTrace(() => fetch(`${base}/object`, {
      method: 'POST',
      body: 'payload',
      headers: { authorization: 'Bearer object' }
    }));

    expect(got.method).toBe('POST');
    expect(got.body).toBe('payload');
    expect(got.headers.authorization).toBe('Bearer object');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('headers given as a Headers instance are kept next to the trace', async () => {
    const mine = new Headers({ authorization: 'Bearer instance' });

    const got = await inTrace(() => fetch(`${base}/instance`, { headers: mine }));

    expect(got.headers.authorization).toBe('Bearer instance');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
    expect(mine.has('traceparent')).toBe(false);
  });

  it('headers given as an array of pairs are kept next to the trace', async () => {
    const got = await inTrace(() => fetch(`${base}/pairs`, {
      headers: [['authorization', 'Bearer pairs'], ['x-mine', '1']]
    }));

    expect(got.headers.authorization).toBe('Bearer pairs');
    expect(got.headers['x-mine']).toBe('1');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('a Request object keeps its method, body and headers and carries the trace', async () => {
    const request = new Request(`${base}/request-object`, {
      method: 'PUT',
      body: 'from-request',
      headers: { authorization: 'Bearer request' }
    });

    const got = await inTrace(() => fetch(request));

    expect(got.method).toBe('PUT');
    expect(got.url).toBe('/request-object');
    expect(got.body).toBe('from-request');
    expect(got.headers.authorization).toBe('Bearer request');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('headers in init replace the Request headers, as fetch always does, and carry the trace', async () => {
    const request = new Request(`${base}/override`, { headers: { 'x-from-request': 'yes' } });

    const got = await inTrace(() => fetch(request, { headers: { 'x-from-init': 'yes' } }));

    expect(got.headers['x-from-init']).toBe('yes');
    expect(got.headers).not.toHaveProperty('x-from-request');
    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });

  it('a traceparent the caller sets explicitly wins over the injected one', async () => {
    const mine = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

    const got = await inTrace(() => fetch(`${base}/explicit`, { headers: { Traceparent: mine } }));

    expect(got.headers.traceparent).toBe(mine);
  });

  it('options other than headers still reach fetch', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(new Promise((resolve, reject) => {
      scribbles.trace({ traceId: 'order-60' }, () => {
        fetch(`${base}/aborted`, { signal: controller.signal }).then(resolve, reject);
      });
    })).rejects.toThrow(/abort/i);
  });

  it('a fetch with no usable url fails the way fetch does, with a rejection', async () => {
    await expect(new Promise((resolve, reject) => {
      scribbles.trace({ traceId: 'order-60' }, () => {
        fetch().then(resolve, reject);
      });
    })).rejects.toMatchObject({ name: 'TypeError' });
  });

  it('a fetch outside a trace leaves exactly as written', async () => {
    const outside = fetch(`${base}/outside`, { headers: { 'x-mine': '1' } });
    const got = await landed;
    await outside;

    expect(got.headers['x-mine']).toBe('1');
    expect(got.headers).not.toHaveProperty('traceparent');
    expect(got.headers).not.toHaveProperty('tracestate');
  });

  it('with no headers configured a fetch inside a trace is left alone', async () => {
    scribbles.config({ headers: null, headersMapping: undefined });

    const got = await inTrace(() => fetch(`${base}/not-configured`));

    expect(got.headers).not.toHaveProperty('traceparent');
  });

  it('headersMapping alone is enough to trace a fetch', async () => {
    scribbles.config({ headers: null, headersMapping: { 'x-correlation': 'x-request-id' } });

    const got = await inTrace(() => fetch(`${base}/mapping`));

    expect(got.headers.traceparent).toMatch(TRACEPARENT);
  });
});
