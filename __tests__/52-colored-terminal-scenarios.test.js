/**
 * @file Scenarios: what an operator sees in a colored (dev-mode) terminal
 *
 * Domain: a developer runs a service locally with `mode: 'dev'`, colors on and
 * the default syntax highlighting. They log values of every kind, tune the line
 * `format`, switch the semantic prose tiers on or off, nest console groups and
 * occasionally mistype a color option.
 *
 * Technical: every test reaches scribbles through `require('../index')` (the
 * same entry users get from `require('scribbles')`), captures the string handed
 * to `stdOut` and asserts only on what a terminal would show: the visible text
 * (ANSI stripped) and whether colors surround it. Each test starts from a
 * freshly loaded copy so options from one story never leak into the next.
 */

const scribbles = require('../index');

/**
 * Every documented `pretty` option set back to "not set", because
 * `scribbles.config` merges `pretty` into what an earlier call left behind.
 */
const PRETTY_UNSET = Object.fromEntries([
  'inlineCharacterLimit', 'indent', 'depth', 'singleQuotes', 'filter', 'transform',
  'groupBrackets', 'syntaxHighlight', 'syntaxColorScheme', 'prosePrefix', 'proseColor',
  'proseImportanceScale', 'proseFieldDarken', 'proseMessageLift', 'proseWrapperExtraDarken',
  'proseEmptyRegionDarken', 'proseContinuationDarken'
].map((key) => [key, undefined]));

const ESC = String.fromCharCode(27);
const SGR = new RegExp(ESC + '\\[[0-9;]*m', 'g');

/**
 * @param {string} line - terminal line with SGR sequences
 * @returns {string} the text a human reads
 */
const visible = (line) => line.replace(SGR, '');

/**
 * @param {string} text
 * @returns {RegExp} matches `text` directly wrapped in SGR open ... foreground-reset
 */
const painted = (text) =>
  new RegExp(ESC + '\\[[0-9;]+m' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ESC + '\\[39m');

describe('Scenario: colored dev terminal output', () => {
  let lines;

  /**
   * Reconfigure scribbles as a fresh dev-mode logger that captures every stdOut line.
   * Options a previous story set (pretty, colorScheme, colorblindMode) are reset first
   * so no story leaks into the next.
   *
   * @param {Object} [opts] - extra `scribbles.config` options
   * @returns {void}
   */
  const setup = (opts) => {
    lines = [];
    scribbles.config(Object.assign({
      mode: 'dev',
      logLevel: 'debug',
      colors: true,
      stdOut: (line) => lines.push(line),
      dataOut: null,
      format: '{message} {value}',
      colorScheme: undefined,
      colorblindMode: undefined
    }, opts, { pretty: Object.assign({}, PRETTY_UNSET, opts && opts.pretty) }));
  };

  describe('a developer logs values of every kind', () => {
    it('paints each primitive, symbol, function and JSON-looking string in the value column', () => {
      setup();
      const flag = false;
      const nothing = null;
      const missing = undefined;
      const count = 0;
      const nan = NaN;
      const huge = 12n;
      const zero = 0n;
      const id = Symbol('id');
      const handler = (req) => req;
      const json = '[1,2]';
      const plain = 'hello';

      scribbles.log('flag', flag);
      scribbles.log('nothing', nothing);
      scribbles.log('missing', missing);
      scribbles.log('count', count);
      scribbles.log('nan', nan);
      scribbles.log('huge', huge);
      scribbles.log('zero', zero);
      scribbles.log('id', id);
      scribbles.log('handler', handler);
      scribbles.log('json', json);
      scribbles.log('plain', plain);

      const expectedValues = [
        'false', 'null', 'undefined', '0', 'NaN', '12', '0', 'Symbol(id)',
        handler.toString(), 'String"[1,2]"', 'hello'
      ];
      expect(lines).toHaveLength(expectedValues.length);
      lines.forEach((line, i) => {
        expect(visible(line)).toMatch(/ /);
        expect(visible(line).endsWith(expectedValues[i])).toBe(true);
      });
      expect(lines[0]).toMatch(painted('false'));
      expect(lines[1]).toMatch(painted('null'));
      expect(lines[2]).toMatch(painted('undefined'));
      expect(lines[3]).toMatch(painted('0'));
      expect(lines[4]).toMatch(painted('NaN'));
      expect(lines[5]).toMatch(painted('12'));
      expect(lines[6]).toMatch(painted('0'));
      expect(lines[7]).toMatch(painted('Symbol(id)'));
      expect(lines[8]).toMatch(painted(handler.toString()));
      expect(lines[9]).toMatch(painted('String'));
      expect(lines[10]).toMatch(painted('hello'));
    });

    it('shows nested empty, truncated, circular and unusual members distinctly', () => {
      setup({ pretty: { depth: 1, inlineCharacterLimit: 300 } });

      scribbles.log('shapes', {
        none: [],
        noneSet: new Set(),
        noneObj: {},
        noneMap: new Map(),
        deepList: [[1]],
        deepSet: new Set([new Set([1])]),
        deepObj: { a: { b: 1 } },
        flag: true,
        nothing: null,
        pattern: /ab+c/gi,
        big: 5n,
        notANumber: NaN,
        sym: Symbol('k'),
        text: "it's \\ \"quoted\"\nnext\rline"
      });

      const text = visible(lines[0]);
      expect(text).toContain('none:[ ]');
      expect(text).toContain('noneSet:Set[ ]');
      expect(text).toContain('noneObj:{ }');
      expect(text).toContain('noneMap:Map{ }');
      expect(text).toContain('deepList:[ + ]');
      expect(text).toContain('deepSet:Set[ + ]');
      expect(text).toContain('deepObj:{ + }');
      expect(text).toContain('flag:true');
      expect(text).toContain('nothing:null');
      expect(text).toContain('pattern:/ab+c/gi');
      expect(text).toContain('big:5');
      expect(text).toContain('notANumber:NaN');
      expect(text).toContain('sym:Symbol(k)');
      expect(text).toContain('\\n');
      expect(text).toContain('\\r');
      expect(lines[0]).toMatch(painted('/ab+c/gi'));
    });

    it('names the class of an instance and keeps empty instances compact', () => {
      setup({ pretty: { inlineCharacterLimit: 300 } });
      class User { constructor() { this.name = 'ada'; } }
      class Nothing {}

      scribbles.log('user', new User());
      scribbles.log('nothing', new Nothing());
      scribbles.log('team', [new User()]);

      expect(visible(lines[0])).toContain('User { name:"ada" }');
      expect(visible(lines[1])).toContain('Nothing { }');
      expect(visible(lines[2])).toContain('[ User { name:"ada" } ]');
      expect(lines[0]).toMatch(painted('User'));
    });

    it('marks an array or object that contains itself instead of looping forever', () => {
      setup({ pretty: { inlineCharacterLimit: 300 } });
      const loop = [1];
      loop.push(loop);
      const owner = { name: 'n' };
      owner.self = owner;

      scribbles.log('loop', loop);
      scribbles.log('owner', owner);

      expect(visible(lines[0])).toContain('[ ...! ]');
      expect(visible(lines[1])).toContain('self:{ ...');
    });

    it('keeps long arrays readable when they exceed the line width', () => {
      setup({ pretty: { inlineCharacterLimit: 20 } });
      scribbles.log('list', ['alpha', 'beta', 'gamma', 'delta']);
      scribbles.log('uniq', new Set(['alpha', 'beta', 'gamma', 'delta']));
      scribbles.log('obj', { first: 'alpha', second: 'beta', third: 'gamma' });

      expect(visible(lines[0])).toContain('0:"alpha"');
      expect(visible(lines[0])).toContain('3:"delta"');
      expect(visible(lines[1])).toContain('1:"beta"');
      expect(visible(lines[2])).toContain('second:"beta"');
      expect(lines[0].split('\n').length).toBeGreaterThan(3);
    });

    it('lets the developer rewrite every printed value with pretty.transform', () => {
      setup({
        pretty: {
          inlineCharacterLimit: 300,
          transform: (container, key, printed) => printed.toUpperCase()
        }
      });
      scribbles.log('shout', { a: 'x', b: ['y', 'z'], c: new Set(['w']) });

      const text = visible(lines[0]);
      expect(text).toContain('a:"X"');
      expect(text).toContain('"Y"');
      expect(text).toContain('"Z"');
      expect(text).toContain('"W"');
    });

    it('quotes strings with single quotes and keeps odd keys readable when asked', () => {
      setup({ pretty: { singleQuotes: true, inlineCharacterLimit: 300 } });
      const key = Symbol('tag');
      scribbles.log('mixed', {
        quote: "it's",
        'odd-key': 1,
        [key]: 2,
        3: 'three'
      });
      scribbles.log('lookup', new Map([[{ id: 1 }, 'x'], [[1, 2], 'y'], ['plain', 'z'], [key, 'w']]));

      const first = visible(lines[0]);
      expect(first).toContain("quote:'it\\'s'");
      expect(first).toContain("'odd-key':1");
      expect(first).toContain('Symbol(tag):2');
      expect(first).toContain("'3':'three'");
      const second = visible(lines[1]);
      expect(second).toContain("{ id:1 }:'x'");
      expect(second).toContain("[ 1, 2 ]:'y'");
      expect(second).toContain("plain:'z'");
      expect(second).toContain("Symbol(tag):'w'");
    });

    it('names a transformed object property by its key when the printed form is rewritten', () => {
      setup({
        colors: false,
        pretty: {
          inlineCharacterLimit: 300,
          transform: (container, key, printed) => `<${printed}>`
        }
      });
      scribbles.log('plain', { 'a-b': 1, list: [1], set: new Set([2]) });

      expect(lines[0]).toContain('"a-b":<1>');
      expect(lines[0]).toContain('list:<[ <1> ]>');
      expect(lines[0]).toContain('set:<Set[ <2> ]>');
    });

    it('prints functions held in objects with their names and arrows', () => {
      setup({ pretty: { inlineCharacterLimit: 300 } });
      function named(a, b) { return a + b; }
      const arrow = (x, y) => x + y;
      scribbles.log('fns', { named, arrow, inline: function (z) { return z; }, other: () => 1 });

      const text = visible(lines[0]);
      expect(text).toContain('named:ƒ(a,b){-}');
      expect(text).toContain('arrow:(x,y)=>{-}');
      expect(text).toContain('inline:');
      expect(text).toContain('other:');
    });
  });

  describe('a developer chooses which value color to use', () => {
    it('falls back to plain text for a color name the terminal does not know', () => {
      setup({ pretty: { syntaxColorScheme: { string: 'chartreuse', number: 'yellow' } } });
      scribbles.log('s', 'hello');
      scribbles.log('n', 7);

      expect(visible(lines[0]).endsWith('hello')).toBe(true);
      expect(lines[0]).not.toMatch(painted('hello'));
      expect(lines[1]).toMatch(painted('7'));
    });

    it('uses the fallback color for a role the developer blanked out', () => {
      setup({ pretty: { syntaxColorScheme: { string: undefined } } });
      scribbles.log('s', 'hello');

      expect(visible(lines[0]).endsWith('hello')).toBe(true);
      expect(lines[0]).toMatch(painted('hello'));
    });

    it('switches to the colorblind palette on request', () => {
      setup({ colorblindMode: true });
      scribbles.log('n', 7);
      scribbles.log('s', 'hello');

      expect(visible(lines[0]).endsWith('7')).toBe(true);
      expect(lines[1]).toMatch(painted('hello'));
    });
  });

  describe('a developer tunes the semantic prose of the line prefix', () => {
    it('keeps brackets, angle brackets, parens and braces around their fields readable', () => {
      setup({ format: '[{logLevel}] <{message}> ({repo}) { {mode} } {value}' });
      scribbles.log('hello', 1);

      const line = lines[0];
      expect(visible(line)).toMatch(/^\[log\] <hello> \(.*\) \{ dev \} 1$/);
      expect(line).toMatch(painted('hello'));
      expect(line).toMatch(painted('<'));
    });

    it('keeps nested wrappers readable', () => {
      setup({ format: '[[{message}]] {value}' });
      scribbles.log('hello', 1);

      expect(visible(lines[0])).toBe('[[hello]] 1');
      expect(lines[0]).toMatch(painted('hello'));
    });

    it('prints an escaped brace pair in the format as the developer wrote it', () => {
      setup({ format: '{{note}} {message}' });
      scribbles.log('hello');
      expect(visible(lines[0])).toBe('{note} hello');

      setup({ format: '{{ {message}' });
      scribbles.log('hello');
      expect(visible(lines[0])).toBe('{{ hello');
    });

    it('colors literals that sit around fields inside one wrapper', () => {
      setup({ format: '[a {message} b {logLevel} c] {value}' });
      scribbles.log('hello', 1);
      scribbles.log('hello');

      expect(visible(lines[0])).toBe('[a hello b log c] 1');
      expect(visible(lines[1])).toBe('[a hello b log c] ');
      expect(lines[0]).toMatch(painted('a '));
    });

    it('dims an empty wrapper and an empty message', () => {
      setup({ format: '[{message}] {logLevel} {message}' });
      scribbles.log('');

      expect(visible(lines[0])).toBe('[] log ');
      expect(lines[0]).toMatch(painted('[]'));
    });

    it('prints fields that have no data, a trailing literal and an unclosed bracket', () => {
      setup({ format: '{message} {nothingHere} ~' });
      scribbles.log('hello');
      expect(visible(lines[0])).toContain('hello');
      expect(visible(lines[0]).endsWith('~')).toBe(true);

      setup({ format: '[{message}' });
      scribbles.log('hello');
      expect(visible(lines[0])).toBe('[hello');
    });

    it('survives a multi-line message wrapped in brackets', () => {
      setup({ format: '[{message}]' });
      scribbles.log('first\nsecond');
      scribbles.log('first\nsecond', 1);

      expect(visible(lines[0])).toBe('[first\nsecond]');
      expect(visible(lines[1])).toContain('first');
    });

    it('survives a multi-line message beside plain fields', () => {
      setup({ format: '{logLevel}|{message}|{logLevel}' });
      scribbles.log('first\nsecond');
      setup({ format: '{message}|{logLevel}' });
      scribbles.log('first\nsecond');

      expect(visible(lines[0])).toBe('first\nsecond|log');
    });

    it('accepts a null proseColor as "use the default"', () => {
      setup({ format: '{message}', pretty: { proseColor: null } });
      scribbles.log('hello');

      expect(visible(lines[0])).toBe('hello');
      expect(lines[0]).toMatch(painted('hello'));
    });

    it('does not crash when the importance scale is not a number', () => {
      setup({ format: '{logLevel} {message}', pretty: { proseImportanceScale: NaN } });
      scribbles.log('hello');

      expect(visible(lines[0])).toBe('log hello');
    });

    it('rejects a proseColor that is not a #RRGGBB string', () => {
      expect(() => scribbles.config({ colors: true, pretty: { proseColor: 123 } }))
        .toThrow('pretty.proseColor must be a #RRGGBB hex string');
      expect(() => scribbles.config({ colors: true, pretty: { proseColor: 'red' } }))
        .toThrow('pretty.proseColor must be a #RRGGBB hex string');
    });

    it('lets the developer switch the tiers off and colors the plain prefix by level', () => {
      setup({ pretty: { prosePrefix: false } });
      scribbles.log('hello', 1);
      scribbles.log('hello');

      expect(visible(lines[0])).toBe('hello 1');
      expect(lines[0]).toMatch(painted('1'));
      expect(visible(lines[1])).toBe('hello ');
    });

    it('stays plain when colors are off', () => {
      setup({ colors: false });
      scribbles.log('hello', 1);

      expect(lines[0]).toBe('hello 1');
    });
  });

  describe('a developer reads console groups in a colored terminal', () => {
    /**
     * Run one group with a bare message and a value-bearing line inside it.
     *
     * @returns {void}
     */
    const logInsideGroup = () => {
      scribbles.group.start('Group A');
      scribbles.log('inner');
      scribbles.log('inner', { a: 1 });
      scribbles.group.end();
    };

    it('draws a colored tree with the prose tiers on', () => {
      setup({ pretty: { groupBrackets: true } });
      logInsideGroup();

      expect(visible(lines[0])).toContain('┌ Group A');
      expect(visible(lines[1])).toContain('⎜');
      expect(visible(lines[3])).toContain('└ ');
    });

    it('draws a colored tree with the prose tiers off', () => {
      setup({ pretty: { groupBrackets: true, prosePrefix: false } });
      logInsideGroup();

      expect(visible(lines[0])).toContain('┌ Group A');
      expect(visible(lines[1])).toContain('inner');
      expect(visible(lines[2])).toContain('a:1');
      expect(visible(lines[3])).toContain('└ ');
    });

    it('leaves a level uncolored when the scheme disables it', () => {
      setup({
        pretty: { groupBrackets: true, prosePrefix: false },
        colorScheme: { log: null }
      });
      logInsideGroup();

      expect(visible(lines[1])).toContain('inner');
      expect(lines[1]).not.toMatch(painted('inner'));
    });

    it('indents by group depth when brackets are off', () => {
      setup({ pretty: { groupBrackets: false, prosePrefix: false } });
      logInsideGroup();

      expect(visible(lines[1])).toMatch(/^ +inner/);
      expect(visible(lines[2])).toMatch(/^ +inner/);
    });

    it('ends a group that was never started without failing, with or without a caption', () => {
      setup();
      scribbles.group.end();
      scribbles.group.end('nothing was open');

      expect(lines).toHaveLength(2);
      expect(visible(lines[1])).toContain('nothing was open');
    });
  });
});
