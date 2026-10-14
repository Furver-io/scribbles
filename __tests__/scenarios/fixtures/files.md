# Scenario fixtures

Test fixture applications for the scenario suites.

## Directory Structure

```
fixtures/
├── basic-logging/
├── log-level-env/
├── README.md
└── files.md
```

## Subdirectories

### `basic-logging/`
The canonical fixture: a minimal entry+lib pair that calls
`scribbles.log(...)` with a mix of literal and variable arguments.
Used by every basic-logging scenario (Node-CJS, Node-ESM, Bun-CJS,
Bun-ESM, bun-test). See `basic-logging/files.md`.

### `log-level-env/`
One-file app that logs once per level; spawned with different `LOG_LEVEL` values to prove an unknown level stops the app at boot. See `log-level-env/files.md`.
