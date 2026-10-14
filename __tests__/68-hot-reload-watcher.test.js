/**
 * @file Scenarios: scribbles keeps `bun --hot` / `bun --watch` reloading when a logging module changes
 *
 * Domain context
 * --------------
 * Under `bun --hot` a developer edits a module that logs through scribbles and expects the
 * running process to pick the change up. Bun only watches files it read itself, so scribbles
 * watches the modules it rewrites and, on a change, rewrites a "tick" file that Bun does
 * watch. These stories describe that behaviour from the developer's side; the real Bun
 * process is exercised in `scenarios/bun-hot-reload.scenarios.test.js`.
 *
 * Technical context
 * -----------------
 * `createHotReloader` and `locateTick` take their effects as arguments, so the stories hand
 * them an in-memory file system and record what they do: which files were watched, what was
 * written to the tick, which modules were loaded, what was said to the developer. The shared watched-set lives on `globalThis` (it must
 * survive a hot reload), so each story clears it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHotReloader, createDefaultReloader, isHotRun, locateTick } = require('../src/register/hot-reload');

const WATCHED_KEY = Symbol.for('scribbles.hot-reload.watched');
const TICK = '/tmp/scribbles-hot-test.cjs';

/**
 * An in-memory stand-in for the parts of `fs` the reloader uses.
 *
 * @param {string[]} existing - files that already exist
 * @returns {Object} fake fs plus the recorded effects
 */
function fakeDisk(existing = []) {
  const files = new Map(existing.map((name) => [name, '']));
  const watchers = [];
  const disk = {
    files,
    watchers,
    failWrites: false,
    failWatch: false,
    existsSync: (name) => files.has(name),
    writeFileSync: (name, text) => {
      if (disk.failWrites) throw new Error('EACCES: permission denied');
      files.set(name, text);
    },
    watch(name, options, listener) {
      if (disk.failWatch) throw new Error('EMFILE: too many open files');
      const watcher = { name, options, listener, closed: false, errorHandler: undefined };
      watcher.on = (event, handler) => { if (event === 'error') watcher.errorHandler = handler; };
      watcher.close = () => { watcher.closed = true; };
      watchers.push(watcher);
      return watcher;
    }
  };
  return disk;
}

/**
 * @param {boolean} hot - whether the run is a hot run
 * @param {string[]} [existing] - files already on disk
 * @returns {{ reloader: Object, disk: Object, loaded: string[], said: string[], located: number[] }}
 *          the reloader and what it touched
 */
function setup(hot, existing) {
  const disk = fakeDisk(existing);
  const loaded = [];
  const said = [];
  const located = [];
  const reloader = createHotReloader({
    hot,
    fs: disk,
    load: (name) => loaded.push(name),
    locate: () => { located.push(1); return TICK; },
    warn: (line) => said.push(line)
  });
  return { reloader, disk, loaded, said, located };
}

afterEach(() => { delete globalThis[WATCHED_KEY]; });

describe('Scenario: which runs count as hot', () => {
  it('bun --hot and bun --watch do, a plain bun run does not', () => {
    expect(isHotRun(true, ['--hot'])).toBe(true);
    expect(isHotRun(true, ['--watch'])).toBe(true);
    expect(isHotRun(true, [])).toBe(false);
    expect(isHotRun(true, ['--inspect'])).toBe(false);
  });

  it('node never does, even with its own --watch flag', () => {
    expect(isHotRun(false, ['--watch'])).toBe(false);
  });
});

describe('Scenario: a plain (non-hot) run', () => {
  it('watches nothing, writes nothing and does not even look for a temp directory', () => {
    const { reloader, disk, loaded, located } = setup(false);

    reloader.ensureTick();
    reloader.watch('/app/lib.js');

    expect(disk.files.size).toBe(0);
    expect(disk.watchers).toHaveLength(0);
    expect(loaded).toEqual([]);
    expect(located).toEqual([]);
  });
});

describe('Scenario: a developer starts bun --hot', () => {
  it('gets a tick file the program loads, created on first start', () => {
    const { reloader, disk, loaded } = setup(true);

    reloader.ensureTick();

    expect(disk.files.get(TICK)).toMatch(/^module\.exports = \d+\.1;\n$/);
    expect(loaded).toEqual([TICK]);
  });

  it('keeps an existing tick untouched on later (re)loads, so a reload does not trigger another', () => {
    const { reloader, disk, loaded } = setup(true, [TICK]);

    reloader.ensureTick();
    reloader.ensureTick();

    expect(disk.files.get(TICK)).toBe('');
    expect(loaded).toEqual([TICK, TICK]);
  });

  it('watches each rewritten module once, without keeping the process alive', () => {
    const { reloader, disk } = setup(true);

    reloader.watch('/app/lib.js');
    reloader.watch('/app/lib.js');
    reloader.watch('/app/other.js');

    expect(disk.watchers.map((w) => w.name)).toEqual(['/app/lib.js', '/app/other.js']);
    expect(disk.watchers[0].options).toEqual({ persistent: false });
  });

  it('never watches the tick itself, which would reload forever', () => {
    const { reloader, disk } = setup(true);

    reloader.watch(TICK);

    expect(disk.watchers).toHaveLength(0);
  });

  it('does not watch dependencies under node_modules', () => {
    const { reloader, disk } = setup(true);

    reloader.watch('/app/node_modules/lib/index.js');
    reloader.watch('C:\\app\\node_modules\\lib\\index.js');

    expect(disk.watchers).toHaveLength(0);
  });

  it('finds the tick location once, even when a module is watched before the tick is loaded', () => {
    const { reloader, disk, located } = setup(true);

    reloader.watch('/app/lib.js');
    disk.watchers[0].listener('change', 'lib.js');
    reloader.ensureTick();

    expect(located).toEqual([1]);
  });

  it('rewrites the tick with new content every time a watched module changes', () => {
    const { reloader, disk } = setup(true);
    reloader.watch('/app/lib.js');

    disk.watchers[0].listener('change', 'lib.js');
    const first = disk.files.get(TICK);
    disk.watchers[0].listener('change', 'lib.js');
    const second = disk.files.get(TICK);

    expect(first).toMatch(/^module\.exports = \d+\.1;\n$/);
    expect(second).toMatch(/^module\.exports = \d+\.2;\n$/);
    expect(second).not.toBe(first);
  });

  it('forgets a module whose watcher failed (deleted file) and watches it again when it returns', () => {
    const { reloader, disk } = setup(true);
    reloader.watch('/app/lib.js');

    disk.watchers[0].errorHandler(new Error('ENOENT'));
    reloader.watch('/app/lib.js');

    expect(disk.watchers[0].closed).toBe(true);
    expect(disk.watchers).toHaveLength(2);
    expect(disk.watchers[1].closed).toBe(false);
  });
});

describe('Scenario: hot reload is a helper and never takes the app down', () => {
  it('an unwritable temp directory turns it off with one line, and the app starts', () => {
    const { reloader, disk, loaded, said } = setup(true);
    disk.failWrites = true;

    expect(() => reloader.ensureTick()).not.toThrow();
    reloader.ensureTick();
    reloader.watch('/app/lib.js');

    expect(said).toEqual(['scribbles: hot reload is off (EACCES: permission denied). Restart the process to see edits.']);
    expect(loaded).toEqual([]);
    expect(disk.watchers).toHaveLength(0);
  });

  it('a file that cannot be watched (too many open files) turns it off with one line', () => {
    const { reloader, disk, said } = setup(true);
    disk.failWatch = true;

    expect(() => reloader.watch('/app/lib.js')).not.toThrow();
    reloader.watch('/app/other.js');

    expect(said).toHaveLength(1);
    expect(said[0]).toContain('EMFILE');
    expect(disk.watchers).toHaveLength(0);
  });

  it('a file that failed to watch is not remembered as watched', () => {
    const { reloader, disk } = setup(true);
    disk.failWatch = true;
    reloader.watch('/app/lib.js');
    const retry = setup(true);

    retry.reloader.watch('/app/lib.js');

    expect(retry.disk.watchers).toHaveLength(1);
  });

  it('a failing tick write inside a watch callback is reported, not thrown into the process', () => {
    const { reloader, disk, said } = setup(true);
    reloader.watch('/app/lib.js');
    disk.failWrites = true;

    expect(() => disk.watchers[0].listener('change', 'lib.js')).not.toThrow();

    expect(said).toHaveLength(1);
  });
});

describe('Scenario: where the tick file lives', () => {
  const OWNER = 501;

  /**
   * @param {Object} found - what `lstatSync` reports for the private directory
   * @returns {Object} fake fs recording the directory it was asked to create
   */
  function tmpFs(found) {
    const made = [];
    return {
      made,
      realpathSync: (p) => (p === '/var/tmp-link' ? '/private/var/tmp' : p),
      mkdirSync: (dir, options) => made.push([dir, options]),
      lstatSync: () => found
    };
  }

  const locate = (fakeFs, uid) => locateTick({
    fs: fakeFs, tmp: '/var/tmp-link', uid, key: '/app\0/app/main.js', join: path.join, hash: (text) => `h${text.length}`
  });
  const private700 = { isDirectory: () => true, uid: OWNER, mode: 0o40700 };

  it('is a private per-user directory under the real path of the temp directory', () => {
    const fakeFs = tmpFs(private700);

    const tick = locate(fakeFs, OWNER);

    expect(tick).toBe('/private/var/tmp/scribbles-hot-501/h17.cjs');
    expect(fakeFs.made).toEqual([['/private/var/tmp/scribbles-hot-501', { recursive: true, mode: 0o700 }]]);
  });

  it('is refused when the directory belongs to someone else (a pre-planted lookalike)', () => {
    expect(() => locate(tmpFs({ ...private700, uid: 0 }), OWNER)).toThrow(/not a private directory/);
  });

  it('is refused when the directory is a symlink or a file rather than a directory', () => {
    expect(() => locate(tmpFs({ ...private700, isDirectory: () => false }), OWNER)).toThrow(/not a private directory/);
  });

  it('is refused when other users can write to the directory', () => {
    expect(() => locate(tmpFs({ ...private700, mode: 0o40777 }), OWNER)).toThrow(/not a private directory/);
  });

  it('accepts the directory on a system without user ids (Windows reports a negative id)', () => {
    const tick = locate(tmpFs({ ...private700, uid: 0, mode: 0o40777 }), -1);

    expect(tick).toBe('/private/var/tmp/scribbles-hot--1/h17.cjs');
  });
});

describe('Scenario: the reloader a real hot run gets (real files, real temp directory)', () => {
  let tmp;
  let tmpdir;

  // The temp directory is whatever `os.tmpdir()` says; point it at a scratch folder.
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribbles-hot-unit-'));
    tmpdir = jest.spyOn(os, 'tmpdir').mockReturnValue(tmp);
  });
  afterEach(() => {
    tmpdir.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a private tick in the temp directory, loads it, and rewrites it when a module changes', async () => {
    const module1 = path.join(tmp, 'lib.js');
    fs.writeFileSync(module1, 'one');
    const watchSpy = jest.spyOn(fs, 'watch');
    const reloader = createDefaultReloader(true);

    reloader.ensureTick();
    reloader.watch(module1);
    const dir = fs.readdirSync(fs.realpathSync(tmp)).find((name) => name.startsWith('scribbles-hot-'));
    const tickPath = path.join(fs.realpathSync(tmp), dir, fs.readdirSync(path.join(fs.realpathSync(tmp), dir))[0]);
    const before = fs.readFileSync(tickPath, 'utf8');
    // Editors save repeatedly; keep saving until the (platform-dependent) watcher notices.
    for (let edit = 0; edit < 40 && fs.readFileSync(tickPath, 'utf8') === before; edit += 1) {
      fs.writeFileSync(module1, `edit ${edit}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    watchSpy.mock.results.forEach((result) => result.value.close());
    watchSpy.mockRestore();

    expect(fs.statSync(path.join(fs.realpathSync(tmp), dir)).mode & 0o077).toBe(0);
    expect(before).toMatch(/^module\.exports = \d+\.1;\n$/);
    expect(fs.readFileSync(tickPath, 'utf8')).not.toBe(before);
    delete globalThis[WATCHED_KEY];
  });

  it('says so on stderr, once, and leaves the app alone when the temp directory is not a directory', () => {
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, '');
    tmpdir.mockReturnValue(blocker);
    const writes = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((text) => { writes.push(text); return true; });
    try {
      const reloader = createDefaultReloader(true);

      reloader.ensureTick();
      reloader.ensureTick();
    } finally {
      spy.mockRestore();
    }

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^scribbles: hot reload is off \(/);
  });
});
