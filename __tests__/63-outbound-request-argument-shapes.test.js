/**
 * @file Scenarios: every way a developer calls `http.request` still works and is traced
 *
 * Domain: Node lets a developer call `http.request` as `(url)`,
 * `(url, callback)`, `(url, options, callback)` or `(options, callback)`, with
 * the url as a string or a `URL`, and with request headers as an object or as
 * an array of pairs. A service that traces its requests expects every one of
 * those shapes to keep working once scribbles is loaded, to reach the server
 * with the options the developer wrote, and to carry the active trace.
 *
 * Technical: loads scribbles once through `require('../index')`, makes REAL
 * `http.request` calls inside `scribbles.trace(...)` against a local
 * `http.createServer` on port 0 and asserts on the method and headers the
 * server received, plus on the objects the caller handed in (scribbles must
 * not scribble on them). Config is restored afterwards so later test files in
 * the same worker are unaffected.
 */

'use strict';

const http = require('http');
const scribbles = require('../index');

describe('Scenario: http.request argument shapes inside a trace', () => {
  let server;
  let base;
  let landed;
  let landedResolve;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      landedResolve({ method: req.method, url: req.url, headers: req.headers });
      res.end('ok');
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
   * Runs `makeRequest` inside a trace with a known id and resolves with what
   * the server saw. The response is drained so the form without a callback
   * (`http.request(url)`) needs no special handling.
   *
   * @param {function(function(http.IncomingMessage): void): http.ClientRequest} makeRequest
   *        issues the request, using the supplied response handler
   * @returns {Promise<{method: string, url: string, headers: Object}>}
   */
  const traced = (makeRequest) => new Promise((resolve, reject) => {
    scribbles.trace({ traceId: 'order-90' }, () => {
      const req = makeRequest((res) => res.resume());
      req.on('response', (res) => res.resume());
      req.on('error', reject);
      req.end();
      landed.then(resolve);
    });
  });

  it('a bare http.request(url) with no options and no callback is traced', async () => {
    const got = await traced(() => http.request(`${base}/bare`));

    expect(got.url).toBe('/bare');
    expect(got.headers.traceparent).toMatch(/^00-order-90-[0-9a-f]+-01$/);
  });

  it('http.request(urlString, callback) is traced', async () => {
    const got = await traced((onResponse) => http.request(`${base}/with-callback`, onResponse));

    expect(got.url).toBe('/with-callback');
    expect(got.headers.traceparent).toMatch(/^00-order-90-[0-9a-f]+-01$/);
  });

  it('http.request(URL, options, callback) still honours the options', async () => {
    const got = await traced((onResponse) =>
      http.request(new URL(`${base}/posted`), { method: 'POST' }, onResponse));

    expect(got.method).toBe('POST');
    expect(got.url).toBe('/posted');
    expect(got.headers.traceparent).toMatch(/^00-order-90-[0-9a-f]+-01$/);
  });

  it('the URL object and options object the caller passed in are left untouched', async () => {
    const url = new URL(`${base}/untouched`);
    const options = { method: 'PUT' };

    await traced((onResponse) => http.request(url, options, onResponse));

    expect(options).toEqual({ method: 'PUT' });
    expect(Object.keys(url)).toEqual([]);
  });

  it('headers given as an object are kept next to the trace', async () => {
    const got = await traced((onResponse) =>
      http.request(`${base}/headers`, { headers: { authorization: 'Bearer abc' } }, onResponse));

    expect(got.headers.authorization).toBe('Bearer abc');
    expect(got.headers.traceparent).toMatch(/^00-order-90-/);
  });

  it('headers given as an array of pairs are kept next to the trace', async () => {
    const got = await traced((onResponse) =>
      http.request(`${base}/pairs`, { headers: [['authorization', 'Bearer pairs']] }, onResponse));

    expect(got.headers.authorization).toBe('Bearer pairs');
    expect(got.headers.traceparent).toMatch(/^00-order-90-/);
  });

  it('headers given as a flat name/value array are kept next to the trace', async () => {
    const got = await traced((onResponse) =>
      http.request(`${base}/flat`, { headers: ['authorization', 'Bearer flat'] }, onResponse));

    expect(got.headers.authorization).toBe('Bearer flat');
    expect(got.headers.traceparent).toMatch(/^00-order-90-/);
  });

  it('a traceparent the caller sets explicitly wins over the injected one', async () => {
    const mine = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const got = await traced((onResponse) =>
      http.request(`${base}/explicit`, { headers: { traceparent: mine } }, onResponse));

    expect(got.headers.traceparent).toBe(mine);
  });
});
