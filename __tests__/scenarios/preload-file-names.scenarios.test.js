/**
 * @file Scenarios: a preloaded scribbles names each file by its place in the app
 *
 * Domain context
 * --------------
 * A developer starts the service with `node --require scribbles/register app.js` so that
 * even the entry file gets variable names. Every log line then names the file it came from
 * (`worker.js`, `lib/worker.js`), relative to the folder the app lives in, so lines read the
 * same on every machine. Before 2.1.1 the preload ran before Node had picked the entry file,
 * scribbles measured "the app folder" from where scribbles itself was installed, and the
 * file name came out as a broken absolute path (`//private/tmp/...`, or with its first
 * characters cut off when the install sat near the filesystem root).
 *
 * Technical context
 * -----------------
 * - Each story builds a scratch app (see `harness/workspace.cjs`), runs it in a real `node`
 *   child with the preload, and reads the formatted lines from stdout.
 * - The formatted output is `{fileName}:{lineNumber} {message} {value}`; the tests compare
 *   whole lines so a stray prefix or a missing variable name fails them. A call with only a
 *   value (`scribbles.info(total)`) has an empty message, hence the double space.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { runScenario, hasBinary } = require('./harness/spawn.cjs');
const { makeWorkspace, REPO_ROOT } = require('./harness/workspace.cjs');

const SETUP = [
  "const scribbles = require('scribbles');",
  "scribbles.config({ colors: false, logLevel: 'info', dataOut: null,",
  "  format: '{fileName}:{lineNumber} {message} {value}',",
  "  stdOut: (line) => process.stdout.write(line + '\\n') });"
].join('\n');

/**
 * Run `node --require scribbles/register <entry>` inside a workspace.
 *
 * @param {Object<string,string>} files - the app's files
 * @param {string} entry - entry file, relative to the workspace
 * @returns {{ result: Object, dir: string }} the run result and the workspace directory
 */
function runPreloaded(files, entry) {
  const ws = makeWorkspace(files);
  try {
    const result = runScenario({
      runtime: 'node',
      args: ['--require', 'scribbles/register'],
      entry: path.join(ws.dir, entry),
      cwd: ws.dir
    });
    return { result, dir: ws.dir };
  } finally {
    ws.cleanup();
  }
}

describe('Scenario: node --require scribbles/register names files relative to the app', () => {
  it('a developer sees "worker.js" and the entry file "app.js" with their variable names', () => {
    const { result } = runPreloaded({
      'app.js': `${SETUP}\nconst { handleOrder } = require('./worker.js');\nconst r = handleOrder(2);\nscribbles.log('done', r);\n`,
      'worker.js': "const scribbles = require('scribbles');\nexports.handleOrder = (qty) => {\n  const total = qty * 3;\n  scribbles.info(total);\n  return total;\n};\n"
    }, 'app.js');

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Error');
    expect(result.stdout.trim().split('\n')).toEqual([
      'worker.js:4  total:6',
      'app.js:7 done r:6'
    ]);
  });

  it('a module in a sub-folder is named with its folder, "lib/worker.js"', () => {
    const { result } = runPreloaded({
      'app.js': `${SETUP}\nrequire('./lib/worker.js');\n`,
      'lib/worker.js': "const scribbles = require('scribbles');\nconst total = 6;\nscribbles.info(total);\n"
    }, 'app.js');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('lib/worker.js:3  total:6');
  });

  it('a module in a folder whose name starts like the app folder keeps its whole path', () => {
    // app lives in <ws>/app, the shared module in <ws>/app-shared: not inside the app.
    const ws = makeWorkspace({
      'app/app.js': `${SETUP}\nrequire('../app-shared/tool.js');\n`,
      'app-shared/tool.js': "const scribbles = require('scribbles');\nconst total = 6;\nscribbles.info(total);\n"
    });
    try {
      const result = runScenario({
        runtime: 'node',
        args: ['--require', 'scribbles/register'],
        entry: path.join(ws.dir, 'app', 'app.js'),
        cwd: ws.dir
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(`${path.join(ws.dir, 'app-shared', 'tool.js')}:3  total:6`);
    } finally {
      ws.cleanup();
    }
  });

  it('an evaluated script (node -e) names modules relative to the working directory', () => {
    const ws = makeWorkspace({
      'lib/worker.js': "const scribbles = require('scribbles');\nconst total = 6;\nscribbles.info(total);\n"
    });
    try {
      const result = runScenario({
        runtime: 'node',
        args: ['--require', 'scribbles/register', '-e',
          `${SETUP}\nrequire('./lib/worker.js')`],
        entry: '--',
        cwd: ws.dir
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('lib/worker.js:3  total:6');
    } finally {
      ws.cleanup();
    }
  });
});

const WORKER = "const scribbles = require('scribbles');\nconst total = 6;\nscribbles.info(total);\n";

describe('Scenario: other ways of starting the app name files the same way', () => {
  it('node --require scribbles/register . (a folder entry) names files relative to that folder', () => {
    const ws = makeWorkspace({ 'app/index.js': `${SETUP}\nrequire('./lib/x.js');\n`, 'app/lib/x.js': WORKER });
    try {
      const result = runScenario({
        runtime: 'node', args: ['--require', 'scribbles/register'], entry: '.', cwd: path.join(ws.dir, 'app')
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('lib/x.js:3  total:6');
    } finally {
      ws.cleanup();
    }
  });

  it('an entry started through a symlink (a .bin launcher) names files relative to the real app', () => {
    const ws = makeWorkspace({ 'real/app/index.js': `${SETUP}\nrequire('./lib/x.js');\n`, 'real/app/lib/x.js': WORKER });
    try {
      fs.mkdirSync(path.join(ws.dir, 'bin'));
      fs.symlinkSync(path.join(ws.dir, 'real', 'app', 'index.js'), path.join(ws.dir, 'bin', 'start.js'));
      const result = runScenario({
        runtime: 'node', args: ['--require', 'scribbles/register'], entry: path.join(ws.dir, 'bin', 'start.js'), cwd: ws.dir
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('lib/x.js:3  total:6');
    } finally {
      ws.cleanup();
    }
  });

  it('node -e with an extra argument still names modules relative to the working directory', () => {
    const ws = makeWorkspace({ 'lib/x.js': WORKER });
    try {
      const result = runScenario({
        runtime: 'node',
        args: ['--require', 'scribbles/register', '-e', `${SETUP}\nrequire('./lib/x.js')`, '--'],
        entry: '/etc/hosts',
        cwd: ws.dir
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('lib/x.js:3  total:6');
    } finally {
      ws.cleanup();
    }
  });

  it('a mistyped entry file is reported by Node, not by scribbles', () => {
    const ws = makeWorkspace({});
    try {
      const result = runScenario({
        runtime: 'node', args: ['--require', 'scribbles/register'], entry: path.join(ws.dir, 'nope.js'), cwd: ws.dir
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Cannot find module');
      expect(result.stderr).not.toContain('scribbles:');
    } finally {
      ws.cleanup();
    }
  });

  it('node --import scribbles/register started from the filesystem root (a container WORKDIR) names files relative to the entry folder', () => {
    const ws = makeWorkspace({
      'app/app.mjs': "import scribbles, { config } from 'scribbles';\nimport './lib/w.mjs';\n"
        + "config({ colors: false, logLevel: 'info', dataOut: null, format: '{fileName}:{lineNumber} {message} {value}',\n"
        + "  stdOut: (line) => process.stdout.write(line + '\\n') });\nconst r = 2;\nscribbles.log('done', r);\n",
      'app/lib/w.mjs': "import scribbles from 'scribbles';\nconst total = 6;\nscribbles.info(total);\n"
    });
    try {
      const result = runScenario({
        runtime: 'node',
        args: ['--import', path.join(REPO_ROOT, 'register.mjs')],
        entry: path.join(ws.dir, 'app', 'app.mjs'),
        cwd: path.parse(ws.dir).root
      });

      expect(result.status).toBe(0);
      // `w.mjs` runs before the app configures its format, so its line has the default layout.
      const [fromLib, fromApp] = result.stdout.trim().split('\n');
      expect(fromLib).toContain(' lib/w.mjs:3  total:6');
      expect(fromApp).toBe('app.mjs:6 done r:2');
    } finally {
      ws.cleanup();
    }
  });
});

const describeBun = hasBinary('bun') ? describe : describe.skip;

describeBun('Scenario: bun --preload scribbles/register names files relative to the app', () => {
  it('an ES-module app logs "worker.mjs" and "app.mjs" with their variable names', () => {
    const ws = makeWorkspace({
      'app.mjs': "import scribbles, { config } from 'scribbles';\n"
        + "import { handleOrder } from './lib/worker.mjs';\n"
        + "config({ colors: false, logLevel: 'info', dataOut: null,\n"
        + "  format: '{fileName}:{lineNumber} {message} {value}',\n"
        + "  stdOut: (line) => process.stdout.write(line + '\\n') });\n"
        + 'const r = handleOrder(2);\n'
        + "scribbles.log('done', r);\n",
      'lib/worker.mjs': "import scribbles from 'scribbles';\n"
        + 'export function handleOrder(qty) {\n  const total = qty * 3;\n  scribbles.info(total);\n  return total;\n}\n'
    });
    try {
      const result = runScenario({
        runtime: 'bun',
        args: ['--preload', 'scribbles/register'],
        entry: path.join(ws.dir, 'app.mjs'),
        cwd: ws.dir
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'lib/worker.mjs:4  total:6',
        'app.mjs:7 done r:6'
      ]);
    } finally {
      ws.cleanup();
    }
  });
});
