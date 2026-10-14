# log-level-env fixture files

## Directory Structure

```
log-level-env/
├── entry.js
├── README.md
└── files.md
```

## Files

### `entry.js`
Requires scribbles, writes one line per level to stdout and then `app started`. Lets a test
see which levels the `LOG_LEVEL` environment variable lets through, or that boot failed.
