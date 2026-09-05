/**
 * Configuration for Playwright using default from @jupyterlab/galata
 *
 * `JLAB_TEST_PORT` overrides the test server port (default 8888) so the suite
 * runs on machines where 8888 is already taken by a live JupyterLab or
 * JupyterHub. The port is also the run's identity: `test-results/<port>` and
 * `playwright-report/<port>` are named after it, because two suites on one
 * machine must already hold different ports to both start
 * (`port_retries=0`), so a port-keyed path cannot alias.
 *
 * The server is never adopted. `terminal-fingerprints.spec.ts` creates and
 * deletes terminals to prove that terminado hands a closed terminal's name to
 * the next one created, which is server state, not page state - run against a
 * developer's live JupyterLab it would close their terminals. Galata's default
 * of reusing an existing server outside CI is therefore turned off here rather
 * than left to the environment.
 */
const path = require('path');
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

const port = process.env.JLAB_TEST_PORT || '8888';

// Galata's default reporter list writes the HTML report to
// `playwright-report`. Rewrite that one entry rather than restating the list,
// so a change on Galata's side still reaches us.
const reporter = baseConfig.reporter.map(entry =>
  Array.isArray(entry) && entry[0] === 'html'
    ? [
        'html',
        {
          ...entry[1],
          outputFolder: path.join(__dirname, 'playwright-report', port)
        }
      ]
    : entry
);

module.exports = {
  ...baseConfig,
  reporter,
  outputDir: path.join(__dirname, 'test-results', port),
  // One server, and the fingerprint spec asserts on the whole terminal
  // registry - a second worker creating terminals alongside it would change
  // the answer under the assertion.
  workers: 1,
  fullyParallel: false,
  use: {
    ...baseConfig.use,
    baseURL: `http://localhost:${port}`
  },
  webServer: {
    command:
      `jupyter lab --config jupyter_server_test_config.py ` +
      `--port ${port} --ServerApp.port_retries=0`,
    url: `http://localhost:${port}/lab`,
    timeout: 120 * 1000,
    reuseExistingServer: false
  }
};
