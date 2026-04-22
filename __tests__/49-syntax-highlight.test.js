/**
 * @file Integration tests for pretty.syntaxHighlight on stdout (value column).
 *
 * Domain: ReadMe Value Serialization shapes gain distinct SGR segments; line-level
 * color is omitted when syntax highlight is on to avoid reset/stacking issues.
 */

const { ANSI } = require('../src/formatting/colors');
const { defaultSyntaxColorScheme } = require('../src/formatting/stringifySyntax');

describe('Syntax highlight on serialized values', () => {
  let stdOutCalls = [];

  beforeEach(() => {
    stdOutCalls = [];
    const scribbles = require('../index');
    scribbles.config({
      mode: 'dev',
      colors: true,
      stdOut: (msg) => stdOutCalls.push(msg),
      dataOut: null,
      format: '{value}',
      stringify: undefined,
      pretty: {
        syntaxHighlight: true,
        inlineCharacterLimit: 200
      }
    });
  });

  it('should emit ANSI for Map, Set, Date, Error, Buffer, RegExp', () => {
    const scribbles = require('../index');
    scribbles.log('x', {
      m: new Map([['a', 1]]),
      s: new Set([1]),
      d: new Date('2024-01-01T00:00:00.000Z'),
      e: new Error('oops'),
      b: Buffer.from([1, 2]),
      r: /foo/gi
    });
    const out = stdOutCalls[0];
    expect(out).toContain(ANSI.brightMagenta);
    expect(out).toContain(ANSI.green);
    expect(out.split('\x1b[').length).toBeGreaterThan(6);
  });

  it('should paint circular and depth markers', () => {
    const scribbles = require('../index');
    const o = { a: 1 };
    o.self = o;
    scribbles.log('c', o);
    expect(stdOutCalls[0]).toMatch(/\x1b\[91m|\x1b\[31m/);

    scribbles.config({ pretty: { syntaxHighlight: true, depth: 1, inlineCharacterLimit: 200 } });
    scribbles.log('d', { nest: { deep: 1 } });
    expect(stdOutCalls[1]).toContain('+');
    expect(stdOutCalls[1]).toMatch(/\x1b\[35m|\x1b\[95m/);
  });

  it('should paint String disambiguation for JSON-like strings', () => {
    const scribbles = require('../index');
    scribbles.config({
      format: '{value}',
      pretty: { syntaxHighlight: true, inlineCharacterLimit: 200 }
    });
    scribbles.log('lbl', '{not_json}');
    expect(stdOutCalls[stdOutCalls.length - 1]).toContain(ANSI.brightMagenta);
  });

  it('should not emit syntax SGR when colors false', () => {
    const scribbles = require('../index');
    scribbles.config({
      colors: false,
      pretty: { syntaxHighlight: true, inlineCharacterLimit: 200 }
    });
    scribbles.log('z', { a: 1 });
    expect(stdOutCalls[stdOutCalls.length - 1]).not.toContain('\x1b[');
  });

  it('should not wrap full line in level color when syntax highlight on', () => {
    const scribbles = require('../index');
    scribbles.config({
      colors: true,
      format: '{value}',
      pretty: { syntaxHighlight: true, inlineCharacterLimit: 200 }
    });
    scribbles.log('plain', { x: 1 });
    const out = stdOutCalls[stdOutCalls.length - 1];
    expect(out).not.toMatch(/^\x1b\[36m[^\x1b]*$/);
    expect(out).toContain(ANSI.brightCyan);
  });

  it('should use custom syntaxColorScheme when provided', () => {
    const scribbles = require('../index');
    scribbles.config({
      pretty: {
        syntaxHighlight: true,
        inlineCharacterLimit: 200,
        syntaxColorScheme: { number: 'blue' }
      }
    });
    scribbles.log('n', 42);
    const out = stdOutCalls[stdOutCalls.length - 1];
    expect(out).toContain(ANSI.blue);
    expect(defaultSyntaxColorScheme.number).toBe('yellow');
  });

  it('should not auto-highlight when custom stringify is set', () => {
    const scribbles = require('../index');
    scribbles.config({
      stringify: (v) => `CUSTOM:${JSON.stringify(v)}`,
      pretty: { syntaxHighlight: true, inlineCharacterLimit: 200 }
    });
    scribbles.log('c', { a: 1 });
    const out = stdOutCalls[stdOutCalls.length - 1];
    expect(out).toContain('CUSTOM:');
    expect(out).not.toContain(ANSI.green);
  });
});
