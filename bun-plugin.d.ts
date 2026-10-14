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
    /**
     * Folder the file names in the log lines are relative to. Default: the working directory
     * of the build, normally the project root. Files outside it keep their absolute path.
     */
    root?: string;
}

declare function scribblesBunPlugin(options?: ScribblesBunPluginOptions): ScribblesBunPlugin;

export default scribblesBunPlugin;
