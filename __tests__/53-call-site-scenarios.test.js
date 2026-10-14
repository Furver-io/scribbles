/**
 * @file Scenarios: the file and line a log line reports for its call site
 *
 * Domain: operators rely on `{fileName}:{lineNumber}` to jump from a log line to the
 * code that wrote it. Developers do not always call `scribbles.log(...)` directly:
 * they hand it to `forEach`, `.then` and similar callbacks, where the immediate
 * caller is a native frame with no file or line.
 *
 * Technical: black-box through `require('../index')`; the assertions read the
 * `fileName` and `lineNumber` that scribbles reports in `dataOut` and in the
 * stdOut text.
 */

const scribbles = require('../index');

describe('Scenario: call-site reporting when scribbles is used as a callback', () => {
  let lines;
  let bodies;

  beforeEach(() => {
    lines = [];
    bodies = [];
    scribbles.config({
      mode: 'dev',
      logLevel: 'debug',
      colors: false,
      format: '{fileName}:{lineNumber} {message}',
      stdOut: (line) => lines.push(line),
      dataOut: (body) => bodies.push(body)
    });
  });

  it('still reports a file and a line number when log is passed straight to forEach', () => {
    ['first', 'second'].forEach(scribbles.log);

    expect(lines).toHaveLength(2);
    lines.forEach((line) => {
      expect(line).toMatch(/^[\w.-]+\.js:\d+ (first|second)$/);
    });
    bodies.forEach((body) => {
      expect(body.context.fileName).toMatch(/\.js$/);
      expect(body.context.lineNumber).toBeGreaterThan(0);
    });
  });

  it('still prints the message with a file and line when log is chained as a promise handler', async () => {
    await Promise.resolve('resolved').then(scribbles.info);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\S+:\d+ resolved$/);
  });

  it('reports this test file for a direct call', () => {
    scribbles.log('direct');

    expect(lines[0]).toMatch(/^53-call-site-scenarios\.test\.js:\d+ direct$/);
  });
});
