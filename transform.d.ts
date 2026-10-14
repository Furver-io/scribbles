/**
 * Type definitions for `scribbles/transform`.
 */

/**
 * Rewrite `scribbles.<level>(...)` call sites so each carries file, line and argument-name
 * metadata. Returns the source unchanged when nothing matches.
 */
export function transformSource(source: string, filename: string): string;
