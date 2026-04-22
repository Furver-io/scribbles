/**
 * @file Tests for colored log output
 */

describe('Colored Log Output', () => {
  let scribbles;
  let stdOutCalls;
  const { ANSI, colorize, shouldEnableColors, defaultColorScheme, colorblindScheme } = require('../src/formatting/colors');

  beforeEach(() => {
    jest.resetModules();
    scribbles = require('../index');
    stdOutCalls = [];
    scribbles.config({
      stdOut: (msg) => stdOutCalls.push(msg),
      dataOut: null,
      colors: true,
      format: '<{logLevel}> {message}'
    });
  });

  describe('Color configuration', () => {
    it('should enable colors when colors: true', () => {
      scribbles.log('test');
      expect(stdOutCalls[0]).toContain('\x1b[');
    });

    it('should disable colors when colors: false', () => {
      scribbles.config({ colors: false });
      scribbles.log('test');
      expect(stdOutCalls[0]).not.toContain('\x1b[');
    });

    it('should disable colors in prod mode by default', () => {
      scribbles.config({
        mode: 'production',
        colors: undefined,
        colorScheme: undefined
      });
      scribbles.log('test');
      expect(stdOutCalls[0]).not.toContain('\x1b[');
    });
  });

  describe('Log level colors', () => {
    it('should colorize error logs red', () => {
      scribbles.error('error message');
      expect(stdOutCalls[0]).toContain(ANSI.red);
    });

    it('should colorize warn logs yellow', () => {
      scribbles.warn('warning message');
      expect(stdOutCalls[0]).toContain(ANSI.yellow);
    });

    it('should colorize log logs cyan', () => {
      scribbles.log('log message');
      expect(stdOutCalls[0]).toContain(ANSI.cyan);
    });

    it('should colorize info logs green', () => {
      scribbles.info('info message');
      expect(stdOutCalls[0]).toContain(ANSI.green);
    });

    it('should colorize debug logs gray', () => {
      scribbles.debug('debug message');
      expect(stdOutCalls[0]).toContain(ANSI.gray);
    });
  });

  describe('Custom color scheme', () => {
    it('should accept custom colorScheme', () => {
      scribbles.config({
        colors: true,
        colorScheme: {
          log: 'magenta'
        }
      });
      scribbles.log('custom color');
      expect(stdOutCalls[0]).toContain(ANSI.magenta);
    });

    it('should merge custom scheme with defaults', () => {
      scribbles.config({
        colors: true,
        colorScheme: {
          log: 'blue'
        }
      });
      scribbles.error('still red');
      expect(stdOutCalls[0]).toContain(ANSI.red);
    });
  });

  describe('Colorblind accessibility mode', () => {
    it('should use colorblind scheme when enabled', () => {
      scribbles.config({
        colors: true,
        colorblindMode: true,
        colorScheme: undefined
      });
      scribbles.error('error');
      expect(stdOutCalls[0]).toContain(ANSI.brightRed);
    });

    it('should use white for log in colorblind mode', () => {
      scribbles.config({
        colors: true,
        colorblindMode: true,
        colorScheme: undefined
      });
      scribbles.log('test');
      expect(stdOutCalls[0]).toContain(ANSI.white);
    });
  });

  describe('Timer colors', () => {
    it('should colorize timer output', () => {
      scribbles.config({
        colors: true,
        format: '<{logLevel}> {message}'
      });
      scribbles.timer('test-timer');
      expect(stdOutCalls[0]).toContain(ANSI.blue);
    });

    it('should colorize timerEnd output', () => {
      scribbles.config({
        colors: true,
        format: '<{logLevel}> {message}'
      });
      scribbles.timer('test-timer2');
      stdOutCalls = [];
      scribbles.timerEnd('test-timer2');
      expect(stdOutCalls[0]).toContain(ANSI.blue);
    });
  });

  describe('Group colors', () => {
    it('should colorize group start', () => {
      scribbles.config({
        colors: true,
        format: '<{logLevel}> {message}'
      });
      scribbles.group.start('Test Group');
      expect(stdOutCalls[0]).toContain(ANSI.magenta);
    });

    it('should colorize group end', () => {
      scribbles.config({
        colors: true,
        format: '<{logLevel}> {message}'
      });
      scribbles.group.start('Test Group');
      stdOutCalls = [];
      scribbles.group.end();
      expect(stdOutCalls[0]).toContain(ANSI.magenta);
    });
  });
});

describe('Color utilities', () => {
  const { ANSI, colorize, shouldEnableColors } = require('../src/formatting/colors');

  describe('colorize()', () => {
    it('should wrap text with color codes', () => {
      const result = colorize('hello', 'red');
      expect(result).toBe('\x1b[31mhello\x1b[0m');
    });

    it('should return original text for unknown color', () => {
      const result = colorize('hello', 'notacolor');
      expect(result).toBe('hello');
    });

    it('should handle empty string', () => {
      const result = colorize('', 'red');
      expect(result).toBe('\x1b[31m\x1b[0m');
    });
  });

  describe('shouldEnableColors()', () => {
    const originalEnv = { ...process.env };
    const originalStdout = process.stdout;

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should respect NO_COLOR environment variable', () => {
      process.env.NO_COLOR = '1';
      expect(shouldEnableColors()).toBe(false);
    });

    it('should respect FORCE_COLOR environment variable', () => {
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = '1';
      expect(shouldEnableColors()).toBe(true);
    });
  });

  describe('ANSI codes', () => {
    it('should have reset code', () => {
      expect(ANSI.reset).toBe('\x1b[0m');
    });

    it('should have standard colors', () => {
      expect(ANSI.red).toBe('\x1b[31m');
      expect(ANSI.green).toBe('\x1b[32m');
      expect(ANSI.yellow).toBe('\x1b[33m');
      expect(ANSI.blue).toBe('\x1b[34m');
      expect(ANSI.magenta).toBe('\x1b[35m');
      expect(ANSI.cyan).toBe('\x1b[36m');
      expect(ANSI.gray).toBe('\x1b[90m');
    });

    it('should have bright colors', () => {
      expect(ANSI.brightRed).toBe('\x1b[91m');
      expect(ANSI.brightGreen).toBe('\x1b[92m');
      expect(ANSI.brightYellow).toBe('\x1b[93m');
      expect(ANSI.brightBlue).toBe('\x1b[94m');
      expect(ANSI.brightMagenta).toBe('\x1b[95m');
      expect(ANSI.brightCyan).toBe('\x1b[96m');
    });
  });

  describe('groupTreeOpenAtDepth', () => {
    const { groupTreeOpenAtDepth, ANSI } = require('../src/formatting/colors');
    const nonColorKeys = new Set(['reset', 'bold', 'dim', 'underline']);

    it('should emit 24-bit foreground openers only', () => {
      for (let d = 1; d <= 12; d++) {
        expect(groupTreeOpenAtDepth(d, false).startsWith('\x1b[38;2;')).toBe(true);
        expect(groupTreeOpenAtDepth(d, true).startsWith('\x1b[38;2;')).toBe(true);
      }
    });

    it('should never match a named ANSI foreground SGR used by colorize()', () => {
      const namedCodes = Object.entries(ANSI)
        .filter(([k]) => !nonColorKeys.has(k))
        .map(([, v]) => v);
      for (let d = 1; d <= 16; d++) {
        const a = groupTreeOpenAtDepth(d, false);
        const b = groupTreeOpenAtDepth(d, true);
        for (const code of namedCodes) {
          expect(a).not.toBe(code);
          expect(b).not.toBe(code);
        }
      }
    });
  });
});

describe('Color schemes', () => {
  const { defaultColorScheme, colorblindScheme } = require('../src/formatting/colors');

  describe('defaultColorScheme', () => {
    it('should map all log levels to colors', () => {
      expect(defaultColorScheme.error).toBe('red');
      expect(defaultColorScheme.warn).toBe('yellow');
      expect(defaultColorScheme.log).toBe('cyan');
      expect(defaultColorScheme.info).toBe('green');
      expect(defaultColorScheme.debug).toBe('gray');
    });

    it('should map timer levels', () => {
      expect(defaultColorScheme.timer).toBe('blue');
      expect(defaultColorScheme.timerEnd).toBe('blue');
    });

    it('should map group levels', () => {
      expect(defaultColorScheme.group).toBe('magenta');
      expect(defaultColorScheme.groupCollapsed).toBe('magenta');
      expect(defaultColorScheme.groupEnd).toBe('magenta');
    });
  });

  describe('colorblindScheme', () => {
    it('should use bright/distinct colors for accessibility', () => {
      expect(colorblindScheme.error).toBe('brightRed');
      expect(colorblindScheme.warn).toBe('brightYellow');
      expect(colorblindScheme.log).toBe('white');
      expect(colorblindScheme.info).toBe('brightCyan');
      expect(colorblindScheme.debug).toBe('dim');
    });
  });
});
