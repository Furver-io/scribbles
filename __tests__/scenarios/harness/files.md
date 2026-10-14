# Scenario harness

Support utilities used by every scenario suite.

## Directory Structure

```
harness/
├── host-package.cjs
├── spawn.cjs
├── README.md
└── files.md
```

## Files

### `host-package.cjs`
`bootWithHostPackage(hostPackage, probe)` boots the repo's `index.js` in a
fresh `node` child while a preload makes a synthetic host `package.json`
appear at the path `index.js` reads, then returns the JSON line the probe
printed. Replaces the old scenarios that wrote a real file outside the repo,
which other Jest workers could read mid-test.

### `spawn.cjs`
Shared child-process spawner. Exposes two helpers:
  - `runScenario({ runtime, entry, args, cwd, env, timeoutMs })` —
    launches a real `node` / `bun` process against a fixture file and
    returns `{ stdout, stderr, status, timedOut }` for the scenario
    test to assert on.
  - `hasBinary(name)` — cheap probe used by the Bun-dependent suites
    to `describe.skip` themselves when Bun is not installed on the
    developer's machine.
The `.cjs` extension keeps the module outside Jest's default
`testMatch` discovery pattern, so it is never mistaken for a test
file.
