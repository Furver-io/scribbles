/**
 * @file Pure source-code transformer for Scribbles call sites
 *
 * Domain context
 * --------------
 * This is the heart of Scribbles' "automatic variable name extraction"
 * feature — the invisible machinery that makes `scribbles.log(user.name)`
 * emit `user.name:<value>` rather than just `<value>`. End users never see
 * this file and are *not* expected to write `.at(...)` calls by hand. Quoting
 * the project's design notes:
 *
 *   "The `.at(` is not intended to be used normally and is an escape hatch.
 *    As long as you use the word `scribbles` as your variable, there is a
 *    runtime source-code parser that dynamically replaces `scribbles.xxx`
 *    calls with an in-line `.at` in order to give accurate file and line
 *    numbers … It's intended that you will use `scribbles.log`, `scribbles.error`
 *    etc., and scribbles will look for this marker and automatically inject
 *    the correct location information."
 *
 * This transformer is the thing that does that replacement. Given the raw
 * source text of a JS/TS file, it rewrites every `scribbles.<level>(args...)`
 * call so that the runtime receives both the original arguments AND a packet
 * of lazy metadata describing the call site:
 *
 *   before:  scribbles.log("hello", user.name, err)
 *   after:   scribbles.log.at(
 *              { file:"/app/lib.js", line:17, col:4,
 *                args:[false, x=>x`user.name`, x=>x`err`] },
 *              "hello", user.name, err
 *            )
 *
 * The `.at(...)` method is installed on each level at config time by
 * `src/core/scribblesConfig.js` — it accepts the metadata as its first arg
 * and then delegates to the regular `scribble(...)` function. The lazy
 * `x=>x\`user.name\`` thunks are evaluated later in the caller's lexical
 * scope (where `user` is defined), which is the *only* way to resolve the
 * value of `user.name` after the call site has been rewritten. Without this
 * in-scope closure, a post-hoc source-parsing approach could recover the
 * *name* `"user.name"` but never its runtime *value* — which is why a
 * compile/load-time transform is the only mechanism that preserves full
 * feature parity.
 *
 * Technical context
 * -----------------
 * - Extracted from the pre-v2 `src/parsing/loader.js` during the multi-runtime
 *   refactor so this transformation can be reused verbatim by every loader
 *   adapter (Node-CJS `Module._extensions`, Node-ESM `module.register()`,
 *   Bun's `Bun.plugin`, and future bundler plugins). The function is pure —
 *   no I/O, no module globals mutated, no runtime assumptions — which lets
 *   each adapter own its own side-effects while sharing the algorithm.
 * - The transform is line-based: it splits on `\n` and processes one line at
 *   a time, handing each line to a lookahead character pump that is allowed
 *   to cross line boundaries for multi-line calls. This matches how the
 *   pre-v2 loader worked and preserves identical output for the existing
 *   test corpus (a non-negotiable T2 constraint).
 * - The list of recognized levels comes from `config.levels` plus the
 *   reserved `status` level. When users register custom levels via
 *   `scribbles.config({ levels: [...] })`, those names take effect for any
 *   file transformed AFTER the config call. The reserved logging variants
 *   `timer` / `timerEnd` / `group*` are injected via the same `.at` mechanism
 *   by `scribblesConfig.js` and do not need to appear in `levels2check` here.
 * - Filenames are made relative to the app root (`src/utils/appRelativePath.js`)
 *   so the emitted `file:"..."` string is stable across machines and invocation
 *   cwd. A file outside the root (e.g. a dependency that also uses Scribbles)
 *   keeps its absolute path.
 */

'use strict';

const { appRelativePath } = require('../utils/appRelativePath');
const config = require('../core/config');
const { loadArgNames } = require('./args-parser');

/**
 * Rewrite a source file's text so that every `scribbles.<level>(...)` call
 * becomes a `scribbles.<level>.at({...metadata}, ...originalArgs)` call.
 *
 * @param {string} source   - Raw source text. May contain any whitespace /
 *        line ending style; only `\n` is treated as a line break (`\r` is
 *        carried as a regular character and does not affect line numbering).
 * @param {string} filename - Absolute filename. Used to derive the `file`
 *        metadata emitted at each call site.
 * @param {string} [root] - Absolute app root the `file` metadata is relative to.
 *        Defaults to the folder of the process entry file.
 * @returns {string} The rewritten source. Functionally identical to the input
 *        at runtime for any non-matching line; matching lines are replaced
 *        with equivalent code that additionally carries call-site metadata.
 */
function transformSource(source, filename, root) {
  // Compute the user-facing `file` string: relative-to-the-app-root when the file
  // lives inside the user's project, otherwise its absolute path.
  const path = appRelativePath(filename, root);

  // Include `status` alongside the configured log levels because it accepts
  // the same `.at(metadata, ...)` shape and users can legitimately call it as
  // `scribbles.status(...)`. If new reserved names with the same shape are
  // added in the future, they should be appended here.
  const levels2check = [...config.levels, "status"];

  return source.split("\n").map((line, index, lines) => {
    // Fast-path bail: if the substring `scribbles.` is not present on this
    // line, there is nothing to rewrite. This is the common case for most
    // user code and keeps the transform cheap.
    if (0 > line.indexOf("scribbles.")) {
      return line;
    }

    for (const level of levels2check) {
      const find = "scribbles." + level + "(";
      const indexOf = line.indexOf(find);
      if (0 > indexOf) continue;

      // Character pump used by `loadArgNames`. It walks forward through the
      // argument list starting immediately after the opening `(`, and is
      // allowed to advance across lines when a call spans multiple lines.
      // Each call returns `[prevChar, currentChar]`; both may be "" when
      // positioned past the end of the final line, which `splitArgs` treats
      // as a terminator.
      let runningCharPointer = indexOf + find.length;
      let linePointer = index;
      let myLine = line;
      /**
       * Advance one character through the source and return the pair
       * `[prevChar, currentChar]` that `splitArgs` consumes. When the
       * pointer reaches the end of the current line we wrap to the
       * start of the next line (lookahead can cross line boundaries
       * when a `scribbles.log(...)` call spans multiple lines). Both
       * elements of the returned pair may be the empty string when
       * the pointer is past the end of the final line; `splitArgs`
       * treats that pair as a stream terminator.
       *
       * @returns {[string, string]} `[prevChar, currentChar]`.
       */
      const getNextChar = () => {
        if (runningCharPointer > myLine.length) {
          runningCharPointer = 0;
          myLine = lines[++linePointer];
        }
        const result = [
          myLine[runningCharPointer - 1] || "",
          myLine[runningCharPointer]
        ];
        runningCharPointer++;
        return result;
      };

      // Inject `.at({...}, ` immediately after the matched call prefix. The
      // original arguments remain in place — the runtime sees both the
      // metadata packet and the full, untouched argument list.
      return line.replace(
        find,
        `scribbles.${level}.at({file:${JSON.stringify(path)},line:${index + 1},col:${indexOf},args:[${loadArgNames(getNextChar)}]},`
      );
    }

    return line;
  }).join("\n");
}

module.exports = { transformSource };
