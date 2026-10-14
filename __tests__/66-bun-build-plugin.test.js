/**
 * @file Scenarios: the `scribbles/bun-plugin` contract a bundler relies on
 *
 * Domain context
 * --------------
 * A team adds `plugins: [scribblesPlugin()]` to `Bun.build`. Bun calls the plugin's
 * `setup(build)` once and then asks the registered `onLoad` handler for every module it
 * reads. The handler must rewrite project sources that log through scribbles, and must
 * decline (return `undefined`) for dependencies and for files that never log.
 *
 * Technical context
 * -----------------
 * Bun's plugin host is tiny — `build.onLoad(options, callback)` — so the test supplies a
 * stand-in host that records the registration and then plays Bun's part by invoking the
 * callback with a real file path. Behaviour under a real `Bun.build` is proven in
 * `__tests__/scenarios/bun-build.scenarios.test.js` when Bun is installed. The plugin is
 * the module the `scribbles/bun-plugin` subpath export points at.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const scribblesBunPlugin = require('../src/register/hooks/bun-plugin');

/**
 * Register the plugin with a stand-in Bun build host.
 *
 * @param {Object} [options] - plugin options
 * @returns {{ name: string, filter: RegExp, load: function(string): Promise<*> }} what Bun would hold
 */
function registerWithBun(options) {
  const registered = {};
  const plugin = scribblesBunPlugin(options);
  plugin.setup({
    onLoad(loadOptions, callback) {
      registered.filter = loadOptions.filter;
      registered.load = (file) => callback({ path: file });
    }
  });
  registered.name = plugin.name;
  return registered;
}

describe('Scenario: scribbles Bun build plugin', () => {
  let dir;
  const write = (relative, text) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };

  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-bun-plugin-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('announces itself and asks Bun for JavaScript and TypeScript modules', () => {
    const bun = registerWithBun();

    expect(bun.name).toBe('scribbles-transform');
    ['a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.mts', 'a.cts', 'a.tsx', 'a.jsx'].forEach((file) => {
      expect(bun.filter.test(file)).toBe(true);
    });
    expect(bun.filter.test('a.css')).toBe(false);
  });

  it('rewrites a source file that logs so the bundle keeps its variable names', async () => {
    const bun = registerWithBun();
    const file = write('service.ts', "const userName = 'alice';\nscribbles.log('user', userName);\n");

    const loaded = await bun.load(file);

    expect(loaded.loader).toBe('ts');
    expect(loaded.contents).toContain('scribbles.log.at({file:');
    expect(loaded.contents).toContain("'user', userName);");
  });

  it('hands Bun the loader that matches each extension', async () => {
    const bun = registerWithBun();
    const expected = { 'a.js': 'js', 'a.mjs': 'js', 'a.cjs': 'js', 'a.jsx': 'jsx', 'a.mts': 'ts', 'a.cts': 'ts', 'a.tsx': 'tsx' };

    for (const [name, loader] of Object.entries(expected)) {
      const loaded = await bun.load(write(name, "scribbles.info('x', y);\n"));
      expect(loaded.loader).toBe(loader);
    }
  });

  it('leaves files that never log to Bun', async () => {
    const bun = registerWithBun();

    expect(await bun.load(write('plain.js', 'module.exports = 1;\n'))).toBeUndefined();
  });

  it('leaves dependencies in node_modules to Bun even when they mention scribbles', async () => {
    const bun = registerWithBun();
    const file = write('node_modules/lib/index.js', "scribbles.log('x', y);\n");

    expect(await bun.load(file)).toBeUndefined();
  });

  it('lets the team narrow the files it handles with a filter', () => {
    const bun = registerWithBun({ filter: /\.tsx$/ });

    expect(bun.filter.test('a.tsx')).toBe(true);
    expect(bun.filter.test('a.js')).toBe(false);
  });
});
