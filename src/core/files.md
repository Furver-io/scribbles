# Core

Core logging functionality for scribbles.

## Directory Structure

```
core/
├── config.js
├── scribble.js
├── scribbleStdOutFormat.js
└── scribblesConfig.js
```

## Files

### `config.js`
Default configuration values for scribbles.

### `scribble.js`
Core scribble logging function that creates structured log entries; delegates final `body.toString()` line assembly to `scribbleStdOutFormat.js`.

### `scribbleStdOutFormat.js`
Formats one log body for `stdOut`: moment time, `outputMessage` / `outputValue` (optional syntax painter + `stringify`), template compile, and `formatGroupLogLineForStdOut`.

### `scribblesConfig.js`
Scribbles configuration and log level setup.
