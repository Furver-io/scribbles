/**
 * @file Entry point for the log-level-env scenario: boots scribbles and logs at every level
 *
 * Domain context
 * --------------
 * Models an application whose operator sets the `LOG_LEVEL` environment variable. The app
 * requires scribbles, prints each line to stdout and logs once per level, then prints a marker
 * line so the test can tell that the app really started.
 *
 * Technical context
 * -----------------
 * - `LOG_LEVEL` is read when scribbles loads, so the scenario must run in a fresh process.
 * - Lines are written to stdout (never `console.error`) so the test can read what each level
 *   produced from one stream; `format` is reduced to the message to keep assertions simple.
 * - No test assertions here; the test asserts on this process's exit code and output.
 */

const scribbles = require('../../../../index');

scribbles.config({
  mode: 'dev',
  colors: false,
  format: '{message}',
  stdOut: (line) => process.stdout.write(line + '\n'),
  dataOut: null
});

scribbles.error('level error shown');
scribbles.warn('level warn shown');
scribbles.log('level log shown');
scribbles.info('level info shown');
scribbles.debug('level debug shown');
process.stdout.write('app started\n');
