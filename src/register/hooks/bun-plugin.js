/**
 * @file `scribbles/bun-plugin` — a `Bun.build` plugin that keeps variable names in bundles
 *
 * Domain context
 * --------------
 * Scribbles learns the variable behind each log argument (`userName:alice`) by rewriting
 * `scribbles.<level>(...)` call sites. At run time the preload (`scribbles/register`) does
 * that. A bundle produced by `Bun.build` runs without the preload, so the rewrite has to
 * happen at bundle time. This plugin runs the same `transformSource` over every project
 * source file while Bun reads it, so the bundle carries the call-site metadata with it.
 *
 * Usage: `Bun.build({ entrypoints, plugins: [require('scribbles/bun-plugin')()] })`.
 *
 * Technical context
 * -----------------
 * - Files without the text `scribbles.` and everything under `node_modules` are left to
 *   Bun (the handler returns `undefined`, which `Bun.build` treats as "not handled").
 * - The loader handed back matches the file extension so Bun's own TypeScript / JSX
 *   compilation still runs on the rewritten text.
 * - Reads files with `fs.promises` so the plugin contract is testable under Node too.
 */

'use strict';

const fs = require('fs');
const { transformSource } = require('../../parsing/transform');

const DEFAULT_FILTER = /\.(?:[mc]?[jt]s|[jt]sx)$/;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
const LOADERS = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx' };

/**
 * Create the Bun plugin object.
 *
 * @param {Object} [options]
 * @param {RegExp} [options.filter] - Which module paths to consider (default: JS/TS/JSX files).
 * @returns {{ name: string, setup: function(Object): void }} plugin for `Bun.build({ plugins })`
 */
function scribblesBunPlugin(options) {
  const filter = (options && options.filter) || DEFAULT_FILTER;
  return {
    name: 'scribbles-transform',
    setup(build) {
      build.onLoad({ filter }, async (args) => {
        if (NODE_MODULES.test(args.path)) return undefined;
        const source = await fs.promises.readFile(args.path, 'utf8');
        if (source.indexOf('scribbles.') < 0) return undefined;
        const extension = /\.([a-z]+)$/.exec(args.path)[1];
        return { contents: transformSource(source, args.path), loader: LOADERS[extension] };
      });
    }
  };
}

module.exports = scribblesBunPlugin;
