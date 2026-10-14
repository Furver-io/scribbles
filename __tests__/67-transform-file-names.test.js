/**
 * @file Scenarios: the file name a rewritten log call reports
 *
 * Domain context
 * --------------
 * Tooling that rewrites sources with `scribbles/transform` (a bundler plugin, a test
 * runner) decides what file name each log line shows by passing the app root as the third
 * argument. A file inside the root shows its relative path, so lines read the same on every
 * machine; a file outside the root shows its absolute path.
 *
 * Technical context
 * -----------------
 * Reaches the transform through the public `scribbles/transform` module and reads the
 * `file:"..."` text out of the rewritten source. The default root (the entry file's folder)
 * is covered by `46-loader-transform.test.js`.
 */

const { transformSource } = require('../src/parsing/transform');

/**
 * @param {string} filename - source file the call is "in"
 * @param {string} [root] - app root handed to the transform
 * @returns {string} the file name the rewritten call carries
 */
function reportedFile(filename, root) {
  const rewritten = transformSource("scribbles.log('hi', name);", filename, root);
  return /file:"([^"]*)"/.exec(rewritten)[1];
}

describe('Scenario: the file name a rewritten log call reports', () => {
  it('is the path relative to the root for a file inside it', () => {
    expect(reportedFile('/work/app/lib/worker.js', '/work/app')).toBe('lib/worker.js');
  });

  it('is the absolute path for a file in a folder that merely starts like the root', () => {
    expect(reportedFile('/work/app-shared/tool.js', '/work/app')).toBe('/work/app-shared/tool.js');
  });

  it('is the absolute path for a file in a different tree', () => {
    expect(reportedFile('/srv/other/tool.js', '/work/app')).toBe('/srv/other/tool.js');
  });

  it('is relative for an app whose root is the filesystem root', () => {
    expect(reportedFile('/entry.js', '/')).toBe('entry.js');
  });
});
