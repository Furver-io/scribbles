# Formatting

Output formatting and display.

## Directory Structure

```
formatting/
├── colors.js
├── groupLogPrefix.js
├── stringify.js
├── stringifyImpl.js
├── stringifyUtils.js
├── stringifyArraySet.js
├── stringifyObjectMap.js
└── stringifySyntax.js
```

## Files

### `colors.js`
ANSI color utilities for terminal output, including color schemes, colorblind accessibility mode, and auto-detection (respects `NO_COLOR`, `FORCE_COLOR`, and `CI` environment variables). Also hosts `groupTreeOpenAtDepth` and helpers for per-depth 24-bit rail colors when `pretty.groupBrackets` and colors are on.

### `groupLogPrefix.js`
Builds group-marker and in-group line prefixes for `body.toString` (tree rails, optional colored lanes); delegates to `colors.js` for 24-bit segments. When `pretty.syntaxHighlight` is on and the `{value}` column contains syntax SGR, applies `colorScheme[level]` only to the plain template prefix before that column (not a single outer wrap of the whole line); `stringifySyntax.js` ends each token with SGR 39 instead of a full reset where appropriate.

### `stringify.js`
Thin re-export of `stringifyImpl.stringify` (value serialization entry for tests and `scribble.js`).

### `stringifyImpl.js`
Core recursive stringification dispatcher (primitives, functions, special types); delegates array/Set and object/Map branches to sibling modules.

### `stringifyUtils.js`
Shared type helpers (`getObjName`, `isRegexp`, …) and `expandWhiteSpaceDual` for paired plain/colored inline expansion.

### `stringifyArraySet.js`
Array and `Set` serialization including `inlineCharacterLimit` regeneration with optional array indices.

### `stringifyObjectMap.js`
Plain object and `Map` serialization (keys, `transform`, filter, Promise-shaped keys).

### `stringifySyntax.js`
Default and colorblind syntax palettes (`defaultSyntaxColorScheme`, `syntaxColorblindScheme`), `mergeResolvedSyntaxScheme` (user `syntaxColorScheme` shallow-merge), `createSyntaxPainter` (per-token SGR open + SGR 39 default-fg close), `paintValueLabel`, and `paintStringDisambiguation` for the `{value}` column. Role names are documented in `ReadMe.md` under **Value syntax highlighting (reference)**.
