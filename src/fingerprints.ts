// The one place this extension talks to its server half. Terminal names are
// slots the server hands out again, so the browser cannot tell one incarnation
// from another on its own: `GET /api/terminals` carries `name` and
// `last_activity` only, and `last_activity` moves forward for a reused name
// exactly as it does for a busy one.

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

/** Terminal session name to the fingerprint of the pty currently behind it. */
export type TerminalFingerprints = Record<string, string>;

/** The companion server extension's route. */
const FINGERPRINT_ROUTE = 'colourful-tab/terminals';

/**
 * The live fingerprint of every terminal the server runs, or null when the
 * route did not answer.
 *
 * null and `{}` are different answers and the prune branches on the difference.
 * null is "cannot tell" - an older server, or the server extension disabled -
 * and leaves stored colours to the running-list rule. `{}` is the server
 * stating it runs no terminals, under which every stored terminal colour is
 * stale. Conflating the two either drops every colour on a server without the
 * route, or keeps a recycled name's colour for good.
 *
 * @param serverSettings - connection settings; the default reads the page's
 */
export async function fetchTerminalFingerprints(
  serverSettings: ServerConnection.ISettings = ServerConnection.makeSettings()
): Promise<TerminalFingerprints | null> {
  const url = URLExt.join(serverSettings.baseUrl, FINGERPRINT_ROUTE);
  let data: any;
  try {
    const response = await ServerConnection.makeRequest(
      url,
      {},
      serverSettings
    );
    if (!response.ok) {
      return null;
    }
    data = await response.json();
  } catch (e) {
    // Unreachable, refused, or a body that is not JSON - one answer covers all
    // three, because none of them establishes an incarnation
    return null;
  }
  // A body without the documented key is not an empty answer, it is an answer
  // this client cannot read, so it must not be taken for "no terminals"
  const terminals = data ? data.terminals : undefined;
  if (!terminals || typeof terminals !== 'object') {
    return null;
  }
  const fingerprints: TerminalFingerprints = {};
  Object.entries(terminals).forEach(([name, fingerprint]) => {
    if (typeof fingerprint === 'string') {
      fingerprints[name] = fingerprint;
    }
  });
  return fingerprints;
}
