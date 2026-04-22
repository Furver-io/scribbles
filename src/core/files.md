# Core

Core logging functionality for scribbles.

## Directory Structure

```
core/
├── config.js
├── scribble.js
├── scribbleStdOutFormat.js
├── scribblesConfig.js
└── scribblesConfigProse.js
```

## Files

### `config.js`
Default configuration values for scribbles.

### `scribble.js`
Core scribble logging function that creates structured log entries; delegates final `body.toString()` line assembly to `scribbleStdOutFormat.js`.

### `scribbleStdOutFormat.js`
Formats one log body for `stdOut`: moment time, `outputMessage` / `outputValue` (optional syntax painter + `stringify`), template compile, optional **prose** painting (`prosePrefixPaint.js`) and continuation dimming on extra lines after `split('\n')`, then `formatGroupLogLineForStdOut`.

### `scribblesConfig.js`
Scribbles configuration and log level setup.

### `scribblesConfigProse.js`
Default and validation for `pretty.prose*` (`applyProsePrettyConfig`); keeps `scribblesConfig.js` within the repository line-count gate.
