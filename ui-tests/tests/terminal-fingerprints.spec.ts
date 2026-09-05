import { expect, test } from '@jupyterlab/galata';

/**
 * The server half: `GET colourful-tab/terminals` reports each terminal's pty
 * incarnation.
 *
 * The route exists because a browser cannot tell one terminal incarnation from
 * another. Terminado's `_next_available_name` hands a closed terminal's name to
 * the next terminal created, and the model behind `GET /api/terminals` carries
 * `name` and `last_activity` only - `last_activity` moves forward for a reused
 * name exactly as it does for a busy one. A colour stored under `terminal:<n>`
 * therefore paints whichever terminal inherits that name.
 *
 * The recycling test below is the defect itself, executed against a real
 * server: the same name is asserted to carry a different fingerprint after the
 * substitution, which is what makes the stale colour droppable.
 */

/**
 * `terminals: null` turns OFF Galata's mock of the terminals API. The mock
 * answers `GET /api/terminals` from a map it fills from the POSTs it saw, so
 * under it the terminals this spec creates exist only in the browser. The
 * fingerprint route reads the server's own registry and is not mocked at all,
 * so the two halves would disagree by construction and every assertion here
 * would be measuring the mock.
 */
test.use({ terminals: null });

const FINGERPRINTS = '/colourful-tab/terminals';
const TERMINALS = '/api/terminals';

/** `<pid>:<starttime>` on Linux, a bare pid where `/proc` cannot answer. */
const FINGERPRINT = /^\d+(:\d+)?$/;

/** The whole name-to-fingerprint map the route answers. */
async function fingerprints(page: any): Promise<Record<string, string>> {
  const response = await page.request.get(FINGERPRINTS);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as any).terminals;
}

/** Start a terminal and return the name the server assigned it. */
async function createTerminal(page: any): Promise<string> {
  const response = await page.request.post(TERMINALS);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as any).name as string;
}

async function deleteTerminal(page: any, name: string): Promise<void> {
  const response = await page.request.delete(`${TERMINALS}/${name}`);
  expect(response.ok()).toBe(true);
}

test('a running terminal reports a fingerprint', async ({ page }) => {
  const name = await createTerminal(page);
  try {
    const map = await fingerprints(page);
    expect(map).toHaveProperty(name);
    expect(map[name]).toMatch(FINGERPRINT);
  } finally {
    await deleteTerminal(page, name);
  }
});

test('a closed terminal leaves no fingerprint behind', async ({ page }) => {
  const name = await createTerminal(page);
  await deleteTerminal(page, name);

  expect(await fingerprints(page)).not.toHaveProperty(name);
});

test('a recycled terminal name carries a different fingerprint', async ({
  page
}) => {
  // The defect, reproduced: the name is handed on, the incarnation is not.
  const first = await createTerminal(page);
  const before = (await fingerprints(page))[first];
  expect(before).toMatch(FINGERPRINT);

  await deleteTerminal(page, first);
  const second = await createTerminal(page);
  try {
    // Terminado hands out the lowest unused name, so the closed terminal's name
    // is the one the new terminal gets. Asserted rather than assumed: if a
    // future terminado stopped recycling, the prune this route feeds would be
    // solving a problem that no longer exists and this test is where that shows.
    expect(second).toEqual(first);

    const after = (await fingerprints(page))[second];
    expect(after).toMatch(FINGERPRINT);
    expect(after).not.toEqual(before);
  } finally {
    await deleteTerminal(page, second);
  }
});
