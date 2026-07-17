// Tab identity for PERSISTED colours. Kept free of JupyterLab imports so it is
// directly executable under jest: a colour keyed on a recyclable slot re-painted
// brand-new tabs (DEF-6), and the suite green at the time never ran this logic.

const TERMINAL_PREFIX = 'terminal:';

/**
 * The key a tab's colour is persisted under, or null when the tab has no stable
 * identity.
 *
 * A file tab resolves to its path (the only true identity JupyterLab hands us),
 * a terminal to its session name. Everything else - launcher, settings - is
 * null: their widget ids (`launcher-0`) are a per-browser-session counter, so
 * the first launcher of every session is always `launcher-0` and a colour
 * stored under it paints every future first launcher (DEF-6). Callers still
 * colour such tabs in the DOM; the colour just does not outlive the session.
 *
 * @param titleAttr - the tab's `title` attribute; files carry `Path: <path>`
 * @param terminalSessionName - the terminal's session name, or null if not a terminal
 */
export function stableTabId(
  titleAttr: string | null,
  terminalSessionName: string | null
): string | null {
  if (titleAttr && titleAttr.includes('Path:')) {
    const pathMatch = titleAttr.match(/Path:\s*(.+?)(?:\n|$)/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1].trim();
    }
  }
  return terminalSessionName
    ? `${TERMINAL_PREFIX}${terminalSessionName}`
    : null;
}

/** The terminal key for a session name, as stored. */
export function terminalTabId(sessionName: string): string {
  return `${TERMINAL_PREFIX}${sessionName}`;
}

/**
 * Stored ids whose terminal session the server no longer lists.
 *
 * Terminal names are recycled - terminado's `_next_available_name` counts from
 * 1 and returns the first name not in use - so a colour left under `terminal:3`
 * would paint the next terminal handed the name 3. Only `terminal:` keys are
 * considered: a file path is a real identity and must never be pruned by this.
 *
 * @param storedIds - every key currently persisted
 * @param liveNames - session names the server reports running
 */
export function deadTerminalIds(
  storedIds: Iterable<string>,
  liveNames: Iterable<string>
): string[] {
  const live = new Set(Array.from(liveNames, terminalTabId));
  return Array.from(storedIds).filter(
    id => id.startsWith(TERMINAL_PREFIX) && !live.has(id)
  );
}
