/**
 * @file Scenarios: scribbles starts quietly and fails in one plain line
 *
 * Domain context
 * --------------
 * Services run in places that are not git checkouts (a container image, an extracted
 * release) and operators set `LOG_LEVEL` by hand. Two start-up behaviours matter there:
 *
 *   - Not finding git is normal. Before 2.1.1 every start printed git's own
 *     `fatal: not a git repository (or any of the parent directories): .git` on stderr
 *     because scribbles asked git for the commit hash. The values now come from `gitEnv`
 *     (environment variables the deploy sets) or stay empty, and nothing is printed.
 *   - A mistyped `LOG_LEVEL` must stop the app (that is the existing fail-fast rule), but
 *     the operator needs one line that names the bad value and the allowed levels. Before
 *     2.1.1 the published bundle first dumped lines of its minified source on stderr.
 *
 * Technical context
 * -----------------
 * - Each story runs a scratch app (see `harness/workspace.cjs`) in a real `node` child and,
 *   where the behaviour is runtime-specific, in a real `bun` child. The app requires the
 *   package by name, so the built `dist/scribbles.js` is what runs (`npm run build` first).
 * - The scratch app sits in the OS temp directory, which is not inside any git checkout.
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { runScenario, hasBinary } = require('./harness/spawn.cjs');
const { makeWorkspace } = require('./harness/workspace.cjs');
const { bootWithHostPackage } = require('./harness/host-package.cjs');

const RUNTIMES = ['node'].concat(hasBinary('bun') ? ['bun'] : []);

const APP = [
  "const scribbles = require('scribbles');",
  "scribbles.config({ colors: false, logLevel: 'info', dataOut: null,",
  "  format: '[{branch}|{hash}|{repo}] {message}',",
  "  stdOut: (line) => process.stdout.write(line + '\\n') });",
  "scribbles.info('started');",
  ''
].join('\n');

describe.each(RUNTIMES)('Scenario: starting a service outside a git checkout (%s)', (runtime) => {
  let ws;
  beforeAll(() => { ws = makeWorkspace({ 'app.js': APP }); });
  afterAll(() => ws.cleanup());

  it('prints no git error on stderr and logs with empty git fields', () => {
    const result = runScenario({ runtime, entry: path.join(ws.dir, 'app.js'), cwd: ws.dir });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('[||] started');
  });

  it('takes the commit, branch and repo from the variables named in gitEnv', () => {
    const script = APP.replace("dataOut: null,", "dataOut: null,\n  gitEnv: { hash: 'DEPLOY_SHA', branch: 'DEPLOY_BRANCH', repo: 'DEPLOY_REPO' },");
    const withEnv = makeWorkspace({ 'app.js': script });
    try {
      const result = runScenario({
        runtime,
        entry: path.join(withEnv.dir, 'app.js'),
        cwd: withEnv.dir,
        env: { DEPLOY_SHA: '0123456789abcdef', DEPLOY_BRANCH: 'release', DEPLOY_REPO: 'checkout-service' }
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe('[release|0123456|checkout-service] started');
    } finally {
      withEnv.cleanup();
    }
  });
});

describe('Scenario: starting a service inside a git checkout', () => {
  it('still reads the branch, commit and repo name from git, without noise', () => {
    const ws = makeWorkspace({ 'app.js': APP });
    try {
      const git = (...args) => execFileSync('git', ['-C', ws.dir, ...args], { encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'trunk');
      git('remote', 'add', 'origin', 'https://example.com/acme/checkout-service.git');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'first');
      const hash = git('rev-parse', '--short', 'HEAD');

      const result = runScenario({ runtime: 'node', entry: path.join(ws.dir, 'app.js'), cwd: ws.dir });

      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe(`[trunk|${hash}|checkout-service] started`);
    } finally {
      ws.cleanup();
    }
  });
});

describe.each(RUNTIMES)('Scenario: an operator mistypes LOG_LEVEL (%s)', (runtime) => {
  let ws;
  beforeAll(() => { ws = makeWorkspace({ 'app.js': APP }); });
  afterAll(() => ws.cleanup());

  it('gets one plain line naming the value and the allowed levels, and the app stops', () => {
    const result = runScenario({
      runtime,
      entry: path.join(ws.dir, 'app.js'),
      cwd: ws.dir,
      env: { LOG_LEVEL: 'warning' }
    });

    const lines = result.stderr.trim().split('\n');
    expect(result.status).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^scribbles: Unknown logLevel "warning"\./);
    expect(lines[0]).toContain('error, warn, log, info, debug');
    expect(result.stdout).toBe('');
  });
});

describe('Scenario: a refused start-up configuration, run from the source tree', () => {
  // Same story as above through the repo's own `index.js` instead of the built bundle, so the
  // start-up code itself is what the coverage run sees.
  const ENTRY = path.resolve(__dirname, 'fixtures', 'log-level-env', 'entry.js');

  it('an unknown LOG_LEVEL prints one plain line and exits with status 1', () => {
    const result = runScenario({ runtime: 'node', entry: ENTRY, env: { LOG_LEVEL: 'bogus' } });

    const lines = result.stderr.trim().split('\n');
    expect(result.status).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^scribbles: Unknown logLevel "bogus"\./);
    expect(result.stdout).toBe('');
  });
});

describe('Scenario: a start-up problem other than an unknown log level', () => {
  it('still throws from require, with its stack, so a host can catch it (only the log-level refusal exits)', () => {
    const { status, stderr } = bootWithHostPackage({ name: 'host', scribbles: { levels: ['config'], logLevel: 'config' } }, 'console.log("{}")');

    expect(status).toBe(1);
    expect(stderr).toContain('You cant use "config" as a log level!');
    expect(stderr).toMatch(/\n\s+at /);
  });

  it('an unknown log level in the host package.json block also gives the one plain line', () => {
    const { status, stderr } = bootWithHostPackage({ name: 'host', scribbles: { logLevel: 'loud' } }, 'console.log("{}")');

    expect(status).toBe(1);
    expect(stderr.trim().split('\n')).toHaveLength(1);
    expect(stderr).toMatch(/^scribbles: Unknown logLevel "loud"\./);
  });
});
