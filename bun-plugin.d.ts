/**
 * Type definitions for `scribbles/bun-plugin`.
 */

/** Minimal shape of the object `Bun.build({ plugins })` accepts. */
export interface ScribblesBunPlugin {
    name: string;
    setup(build: {
        onLoad(
            options: { filter: RegExp },
            callback: (args: { path: string }) => Promise<{ contents: string; loader: string } | undefined>
        ): void;
    }): void;
}

export interface ScribblesBunPluginOptions {
    /** Which module paths to consider. Default: JS/TS/JSX files outside `node_modules`. */
    filter?: RegExp;
}

declare function scribblesBunPlugin(options?: ScribblesBunPluginOptions): ScribblesBunPlugin;

export default scribblesBunPlugin;
