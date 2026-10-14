# Core

Core logging functionality for scribbles.

## Directory Structure

```
core/
├── config.js
├── scribble.js
├── scribbleStdOutFormat.js
├── sinks.js
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

### `sinks.js`
Resolves which function prints a level on `stdOut`, validates an `stdOut` object against the enabled levels at config time (`assertStdOutCoversLevels`) and delivers each entry to `stdOut` and `dataOut` (`deliverToSinks`) with failure isolation: a throwing destination is reported through the `onSinkError` hook (or once on stderr) and never reaches the caller.

### `scribblesConfig.js`
Scribbles configuration and log level setup.

### `scribblesConfigProse.js`
Default and validation for `pretty.prose*` (`applyProsePrettyConfig`); keeps `scribblesConfig.js` within the repository line-count gate.
