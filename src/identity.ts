// Tab identity for PERSISTED colours. Kept free of JupyterLab imports so it is
// directly executable under jest: a colour keyed on a recyclable slot re-painted
// brand-new tabs (DEF-6), and the suite green at the time never ran this logic.

const TERMINAL_PREFIX = 'terminal:';

/**
 * What a tab's colour is held as.
 *
 * The fingerprint is what makes a terminal entry verifiable: the name it is
 * keyed on is a slot the server reuses, so without an incarnation to compare
 * against there is no way to know whether the colour belongs to the terminal
 * now answering to that name.
 */
export interface IStoredColour {
  /** Index into the palette. */
  colour: number;
  /** Fingerprint of the terminal incarnation the colour was chosen on. Absent
   *  for a file path, which needs none, and for a terminal entry written before
   *  the fingerprint existed or while the route was unreachable. */
  fp?: string;
}

/**
 * One persisted value read back as a stored colour, or null when it is not one.
 *
 * localStorage is shared with every other script on the origin, is editable by
 * hand and outlives every version of this extension, so a value read out of it
 * is input rather than something this code is entitled to trust. An unchecked
 * value reaches `entry.colour` and `entry.fp` on every prune and every repaint,
 * where a null or a string throws and takes tab colouring down for that browser
 * until the key is cleared by hand. Anything that does not read back as a
 * colour is dropped silently: it is corrupt data, not a choice the user made.
 *
 * @param value - one entry exactly as `JSON.parse` returned it
 * @param paletteSize - how many colours the palette defines
 */
export function parseStoredColour(
  value: unknown,
  paletteSize: number
): IStoredColour | null {
  const inPalette = (colour: unknown): colour is number =>
    typeof colour === 'number' &&
    Number.isInteger(colour) &&
    colour >= 0 &&
    colour < paletteSize;
  // A bare number is the pre-fingerprint shape. It reads back with no
  // fingerprint, which is what a file path always looks like and what makes an
  // old terminal entry droppable on the first prune
  if (inPalette(value)) {
    return { colour: value };
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { colour, fp } = value as { colour?: unknown; fp?: unknown };
  if (!inPalette(colour)) {
    return null;
  }
  if (fp === undefined) {
    return { colour };
  }
  // A non-string fingerprint compares unequal to every fingerprint the server
  // reports, so the entry could only ever be dropped - it is corrupt, not an
  // entry waiting to match
  return typeof fp === 'string' ? { colour, fp } : null;
}

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
function terminalTabId(sessionName: string): string {
  return `${TERMINAL_PREFIX}${sessionName}`;
}

/** The session name behind a stored id, or null when the id is a file path. */
export function terminalSessionName(tabId: string): string | null {
  return tabId.startsWith(TERMINAL_PREFIX)
    ? tabId.slice(TERMINAL_PREFIX.length)
    : null;
}

/**
 * Stored ids whose terminal incarnation the server no longer vouches for.
 *
 * Terminal names are slots, not identities - terminado's
 * `_next_available_name` counts from 1 and returns the first name not in use -
 * so a closed terminal's name is handed to the next terminal created. A rule
 * built on the running list alone structurally cannot see that substitution:
 * the recycled name IS running, so the dead terminal's entry survives every
 * prune and its colour paints the new terminal (DEF-6, observed 2026-09-04 as a
 * fresh terminal rendering green). Only a per-incarnation fingerprint separates
 * the two.
 *
 * `fingerprints` null means the server could not be asked - an older server, or
 * the companion server extension disabled. There the running list is the only
 * evidence there is, so the pre-fingerprint rule stands unchanged; treating a
 * missing fingerprint as stale in that branch would wipe every stored terminal
 * colour on such a server.
 *
 * A file path is a real identity and is never returned by this.
 *
 * @param stored - every persisted entry, id to value
 * @param fingerprints - live session name to fingerprint, or null when unknown
 * @param liveNames - session names the server reports running
 */
export function staleTerminalIds(
  stored: Iterable<readonly [string, IStoredColour]>,
  fingerprints: Record<string, string> | null,
  liveNames: Iterable<string>
): string[] {
  const liveIds = new Set(Array.from(liveNames, terminalTabId));
  const stale: string[] = [];
  for (const [id, entry] of stored) {
    const name = terminalSessionName(id);
    if (name === null) {
      continue;
    }
    if (!fingerprints) {
      if (!liveIds.has(id)) {
        stale.push(id);
      }
    } else if (entry.fp === undefined || entry.fp !== fingerprints[name]) {
      // An entry with no fingerprint cannot be told apart from the stale entry
      // this prune exists to remove, so it goes. Adopting the live fingerprint
      // instead would have preserved exactly the wrong colour in the observed
      // defect. Entries written before the fingerprint existed lose their
      // colour once, on the first prune after the upgrade. An entry written
      // while the route was unreachable is unverifiable for the same reason and
      // loses it too, whenever that happens - the loss is not one-time.
      stale.push(id);
    }
  }
  return stale;
}
