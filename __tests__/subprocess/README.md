# subprocess/

Subprocess-based tests that run OUTSIDE Jest's in-process instrumentation
to cover module-load-time code paths. Invoked by `npm run test:subprocess`
and merged with Jest coverage by `npm run test:full-coverage`.

Each file is a standalone Node script that:

1. Mocks/arranges the environment its target code path needs
   (`process.version` spoof, `PATH` tweak, etc.).
2. Requires the target module (clearing `require.cache` first to force
   module-top re-evaluation).
3. Asserts on observable side-effects (thrown error, fallback export
   shape).
4. `process.exit(0)` on success / `process.exit(1)` on failure.

See `files.md` for the per-file breakdown.

## How the coverage reports are merged

`npm run test:full-coverage` leaves one `coverage/coverage-final.json` that counts
every way the code is exercised:

1. `jest --coverage` — in-process tests (instrumented by Jest).
2. `nyc --silent jest __tests__/scenarios` — the scenario suites spawn real `node`
   children; nyc's environment is inherited, so those children report too.
3. `nyc --silent --clean=false node __tests__/subprocess/run-all.js` — the scripts here.
4. The Jest report is copied into `.nyc_output/` and `nyc report` merges all of it
   (Jest and nyc use the same instrumenter, so the statement maps are identical) and
   writes `text`, `json` and `lcov` into `coverage/`.

Anything that only the plain Jest run reaches (for example `Module._extensions['.cjs']`
being absent, which nyc itself defines) still counts, because the Jest pass is
step 1 and its counts are merged, never replaced.

