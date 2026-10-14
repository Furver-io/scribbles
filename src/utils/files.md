# Utils

Shared utility functions.

## Directory Structure

```
utils/
├── appRelativePath.js
├── checkNodeVer.js
├── helpers.js
├── regexUtils.js
└── utils.js
```

## Files

### `appRelativePath.js`
Turns an absolute source file name into the `file` text a log line shows:
relative to the app root when inside it, absolute otherwise.

### `checkNodeVer.js`
Validates Node.js version compatibility.

### `helpers.js`
Utility functions including deepMerge and getSource for stack traces.

### `regexUtils.js`
Regular expression utility functions for pattern validation and conversion.

### `utils.js`
Utility functions for trace state parsing.
