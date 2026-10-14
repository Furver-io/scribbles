/**
 * @file Keeps `bun --hot` / `bun --watch` working for modules scribbles rewrites
 *
 * Domain context
 * --------------
 * A developer runs `bun --hot server.ts` and edits a module that calls `scribbles.log(...)`.
 * Bun re-runs the program when a file it has loaded changes. But scribbles rewrites the call
 * sites of such a module (that is how variable names appear), and Bun only watches files it
 * read itself: a module handed to it by a plugin (`.mjs`, `.ts`) or compiled by our CommonJS
 * extension hook (`.js`) is not on its list. Before 2.1.1 the edit was silently ignored.
 *
 * What this module does
 * ---------------------
 * In a hot or watch run under Bun it watches every project module scribbles rewrites and, when
 * one changes, rewrites a small "tick" file that the program has loaded. The tick IS on Bun's
 * list, so Bun reloads (or restarts) the program, which reads the edited module again.
 * Outside Bun's hot and watch modes nothing is watched and no file is written.
 *
 * Technical context
 * -----------------
 * - The tick lives in a private per-user directory under the real path of the OS temp
 *   directory (`scribbles-hot-<uid>`, mode 0700, refused unless it is a real directory owned by
 *   the current user), because the tick is `require`d: a file anyone else could pre-create or
 *   symlink in a shared `/tmp` would be code execution or an overwrite. The real path matters
 *   too: Bun reports loaded files by real path, and a symlinked temp directory (macOS) would
 *   otherwise make the tick look like a project module and reload forever.
 * - The tick is named after the working directory and entry file so two services started from
 *   one folder do not reload each other, and repeated runs reuse one file.
 * - Everything that must survive a hot reload (the watched set) lives on `globalThis`: Bun's
 *   `--hot` re-evaluates modules inside the same process, scribbles' own modules included.
 * - This is a development helper: any failure (unwritable temp directory, a file that cannot
 *   be watched) turns hot reload off with one line on stderr and never reaches the app.
 * - Watchers are unref'd so they never keep a process alive. Dependencies under `node_modules`
 *   are not watched.
 * - The effects are injected so the behaviour is exercised under Node as well; Bun itself is
 *   proven by `bun-hot-reload.scenarios.test.js`.
 */

'use strict';

const HOT_FLAG = /^--(hot|watch)$/;
const DEPENDENCY = /[\\/]node_modules[\\/]/;
const STATE_KEY = Symbol.for('scribbles.hot-reload.watched');

/**
 * @param {boolean} underBun - whether the runtime is Bun
 * @param {string[]} execArgv - the runtime's own command-line flags
 * @returns {boolean} true for `bun --hot` and `bun --watch` runs
 */
function isHotRun(underBun, execArgv) {
  return underBun && execArgv.some((flag) => HOT_FLAG.test(flag));
}

/**
 * Find (creating it when needed) the private directory that holds the tick, and name the tick.
 *
 * @param {Object} env
 * @param {Object} env.fs - `realpathSync`, `mkdirSync`, `lstatSync`
 * @param {string} env.tmp - the OS temp directory
 * @param {number} env.uid - the current user id (negative on Windows, which has none)
 * @param {string} env.key - what makes this program distinct (working directory and entry file)
 * @param {function(string, string): string} env.join - path join
 * @param {function(string): string} env.hash - short stable hash of a string
 * @returns {string} absolute path of the tick file
 * @throws {Error} when the directory exists but is not private to this user
 */
function locateTick({ fs, tmp, uid, key, join, hash }) {
  const dir = join(fs.realpathSync(tmp), `scribbles-hot-${uid}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const found = fs.lstatSync(dir);
  const owner = uid < 0 ? found.uid : uid;
  // Windows has no user ids and reports every directory as 0777, so only a real uid is checked.
  if (!found.isDirectory() || found.uid !== owner || (uid >= 0 && (found.mode & 0o077) !== 0)) {
    throw new Error(`${dir} is not a private directory owned by this user`);
  }
  return join(dir, `${hash(key)}.cjs`);
}

/**
 * @param {Object} env
 * @param {boolean} env.hot - whether this is a hot or watch run
 * @param {Object} env.fs - `existsSync`, `watch`, `writeFileSync`
 * @param {function(string): *} env.load - how the tick file joins the module graph (`require`)
 * @param {function(): string} env.locate - returns the tick file path (may throw)
 * @param {function(string): void} env.warn - tells the developer hot reload is off
 * @returns {{ ensureTick: function(): void, watch: function(string): void }} the reloader
 */
function createHotReloader({ hot, fs, load, locate, warn }) {
  let counter = 0;
  let located;
  let off = false;

  /** @returns {string} the tick file path, found on first use */
  function tickFile() {
    located = located || locate();
    return located;
  }

  /**
   * Run a step of hot reload; a failure switches the feature off instead of reaching the app.
   *
   * @param {function(): void} step - the work
   */
  function guarded(step) {
    if (off) return;
    try {
      step();
    } catch (err) {
      off = true;
      warn(`scribbles: hot reload is off (${err.message}). Restart the process to see edits.`);
    }
  }

  /** Rewrite the tick so Bun sees a changed file. */
  function bump() {
    guarded(() => {
      counter += 1;
      fs.writeFileSync(tickFile(), `module.exports = ${Date.now()}.${counter};\n`);
    });
  }

  return {
    /**
     * Make sure the tick exists and is part of the program Bun watches. Called on every
     * (re)load of scribbles, so it must not rewrite an existing tick: that would itself be a
     * change and reload the program forever.
     */
    ensureTick() {
      if (!hot) return;
      guarded(() => {
        if (!fs.existsSync(tickFile())) bump();
        if (!off) load(tickFile());
      });
    },

    /**
     * Reload the program whenever `filename` changes.
     *
     * @param {string} filename - absolute path of a module scribbles rewrote
     */
    watch(filename) {
      if (!hot || DEPENDENCY.test(filename)) return;
      guarded(() => {
        const watched = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = new Set());
        if (watched.has(filename) || filename === tickFile()) return;
        const watcher = fs.watch(filename, { persistent: false }, bump);
        watched.add(filename);
        watcher.on('error', () => { watcher.close(); watched.delete(filename); });
      });
    }
  };
}

/**
 * The reloader for this process. Everything that costs anything (the temp directory lookup,
 * hashing) happens only in a hot run.
 *
 * @param {boolean} hot - whether this is a hot or watch run
 * @returns {{ ensureTick: function(): void, watch: function(string): void }} the reloader
 */
function createDefaultReloader(hot) {
  const fs = require('fs');
  return createHotReloader({
    hot,
    fs,
    load: require,
    locate: () => locateTick({
      fs,
      tmp: require('os').tmpdir(),
      uid: process.getuid ? process.getuid() : /* istanbul ignore next -- Windows has no getuid */ -1,
      key: process.cwd() + '\0' + process.argv[1],
      join: require('path').join,
      hash: (text) => require('crypto').createHash('sha1').update(text).digest('hex').slice(0, 12)
    }),
    warn: (line) => process.stderr.write(line + '\n')
  });
}

module.exports = createDefaultReloader(isHotRun(typeof globalThis.Bun !== 'undefined', process.execArgv));
module.exports.createDefaultReloader = createDefaultReloader;
module.exports.createHotReloader = createHotReloader;
module.exports.locateTick = locateTick;
module.exports.isHotRun = isHotRun;
