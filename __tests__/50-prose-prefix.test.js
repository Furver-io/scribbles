/**
 * @file Integration tests for `pretty.prose*` semantic prefix painting on stdOut.
 *
 * Domain: with colors and value-column syntax highlighting, the template prefix before
 * `{value}` uses `38;2` tiers by token meaning; `{logLevel}` nests `colorScheme[level]`.
 * Technical: assertions use captured `stdOut` only (public surface).
 */

describe('Prose semantic prefix (38;2)', () => {
  let scribbles;
  let stdOutCalls;

  const fullFormat =
    '{repo}:{mode}:{branch} [{spanLabel} {spanId}] {time} #{hash} <{logLevel}> {fileName}:{lineNumber} {message} {value} {stackTrace}';

  beforeEach(() => {
    jest.resetModules();
    scribbles = require('../index');
    stdOutCalls = [];
    scribbles.config({
      mode: 'dev',
      colors: true,
      stdOut: (msg) => stdOutCalls.push(msg),
      dataOut: null,
      format: fullFormat,
      pretty: { syntaxHighlight: true, inlineCharacterLimit: 200 }
    });
  });

  it('should emit multiple 38;2 segments on the first line for the default anchor', () => {
    scribbles.log('hello', { x: 1 });
    const first = stdOutCalls[0].split('\n')[0];
    const n = (first.match(/\x1b\[38;2;/g) || []).length;
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('should still paint prose when the value column has no ANSI (message-only / empty value)', () => {
    scribbles.log('hello');
    const first = stdOutCalls[stdOutCalls.length - 1].split('\n')[0];
    const n = (first.match(/\x1b\[38;2;/g) || []).length;
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('should nest logLevel 16-color inside prose dimming (38;2 then cyan)', () => {
    scribbles.log('hello', { x: 1 });
    const first = stdOutCalls[0].split('\n')[0];
    expect(first).toMatch(/\x1b\[38;2;\d+;\d+;\d+m\x1b\[36mlog\x1b\[39m/);
  });

  it('should use a greener 38;2 anchor when proseColor is #00FF00', () => {
    scribbles.config({
      format: '{message} {value}',
      pretty: {
        syntaxHighlight: true,
        inlineCharacterLimit: 200,
        proseColor: '#00FF00'
      }
    });
    scribbles.log('hi', { n: 1 });
    const first = stdOutCalls[stdOutCalls.length - 1].split('\n')[0];
    const m = first.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
    expect(m).not.toBeNull();
    expect(Number(m[2])).toBeGreaterThanOrEqual(180);
    expect(Number(m[1])).toBeLessThanOrEqual(80);
  });

  it('should dim continuation lines after a multi-line error body', () => {
    const err = new Error('fail');
    scribbles.error('ctx', { a: 1 }, err);
    const out = stdOutCalls[stdOutCalls.length - 1];
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1].startsWith('\x1b[38;2;')).toBe(true);
  });

  it('should not emit ANSI when colors is false', () => {
    scribbles.config({
      colors: false,
      format: '{message} {value}',
      pretty: { syntaxHighlight: true, inlineCharacterLimit: 200 }
    });
    scribbles.log('z', { q: 1 });
    expect(stdOutCalls[stdOutCalls.length - 1]).not.toContain('\x1b[');
  });

  it('should fall back to plain prefix level color when prosePrefix is false', () => {
    scribbles.config({
      format: '{message} {value}',
      pretty: {
        syntaxHighlight: true,
        inlineCharacterLimit: 200,
        prosePrefix: false
      }
    });
    scribbles.log('plain', { x: 1 });
    const line = stdOutCalls[stdOutCalls.length - 1];
    expect(line.startsWith('\x1b[36m')).toBe(true);
  });

  it('should throw on invalid proseColor hex', () => {
    expect(() => {
      scribbles.config({
        colors: true,
        pretty: { proseColor: '#GGGGGG' }
      });
    }).toThrow(/proseColor/);
  });

  it('should paint empty bracket span as a single empty-region tone when inner tokens are empty', () => {
    scribbles.log('msg', { y: 2 });
    const first = stdOutCalls[stdOutCalls.length - 1].split('\n')[0];
    expect(first).toContain('[ ]');
    expect(first).toMatch(/\x1b\[38;2;\d+;\d+;\d+m\[ \]/);
  });
});
