/**
 * Type definitions for `scribbles/transform`.
 */

/**
 * Rewrite `scribbles.<level>(...)` call sites so each carries file, line and argument-name
 * metadata. Returns the source unchanged when nothing matches.
 *
 * The `file` metadata is `filename` relative to `root` (default: the folder of the process
 * entry file) when the file is inside it, otherwise the absolute `filename`.
 */
export function transformSource(source: string, filename: string, root?: string): string;
