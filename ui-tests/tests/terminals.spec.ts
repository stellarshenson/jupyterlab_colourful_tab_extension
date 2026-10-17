import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * Which tab a stored colour comes back on (ACC-IDENT-27, ACC-IDENT-29,
 * ACC-IDENT-30, ACC-IDENT-31, ACC-IDENT-43, ACC-IDENT-44).
 *
 * A menu colour is stored in localStorage under the tab's stable id - the file
 * path, or `terminal:<session name>` - and painted back onto whichever tab
 * resolves to that id. Terminado hands a shut-down terminal's name to the next
 * terminal created, so a terminal entry also carries the fingerprint of the pty
 * it was chosen on, and an entry whose fingerprint the server no longer reports
 * is dropped.
 *
 * Asserted on the tab's colour class and on what is persisted, against a real
 * server: `terminals: null` turns off Galata's mock of the terminals API, under
 * which a terminal exists only in the browser and the fingerprint route, which
 * reads the server's own registry, would disagree with it by construction.
 */
test.use({ terminals: null });

const STORAGE_KEY = 'jupyterlab-colourful-tab-colours';
const TERMINALS = '/api/terminals';
const FINGERPRINTS = '/colourful-tab/terminals';

/**
 * How long a negative assertion waits before it looks. The restore path
 * repaints 50 ms after the tab bar changes; this leaves it ten times that.
 */
const SETTLE_MS = 500;

function tabSelector(widgetId: string): string {
  return `#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`;
}

/** The colour class on a tab, null for none, `missing` when there is no tab. */
async function tabColour(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<string | null> {
  return page.evaluate(id => {
    const tab = document.querySelector(
      `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
    );
    if (!tab) {
      return 'missing';
    }
    return (
      Array.from(tab.classList).find(c =>
        /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
      ) ?? null
    );
  }, widgetId);
}

/** The widget ids of every dock tab carrying a colour class. */
async function colouredTabs(page: IJupyterLabPageFixture): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '#jp-main-dock-panel .lm-TabBar-tab'
      )
    )
      .filter(tab =>
        Array.from(tab.classList).some(c =>
          /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
        )
      )
      .map(tab => tab.dataset.id as string)
  );
}

/** Every persisted colour, as the extension wrote it. */
async function stored(
  page: IJupyterLabPageFixture
): Promise<Record<string, unknown>> {
  return page.evaluate(
    key => JSON.parse(localStorage.getItem(key) ?? '{}'),
    STORAGE_KEY
  );
}

/** The fingerprint route's whole answer. */
async function fingerprints(
  page: IJupyterLabPageFixture
): Promise<Record<string, string>> {
  const response = await page.request.get(FINGERPRINTS);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as any).terminals;
}

/** True when a request is the extension asking its fingerprint route. */
function isFingerprintRequest(url: URL): boolean {
  return url.pathname.endsWith(FINGERPRINTS);
}

/**
 * Reload and wait for the layout to be restored. Galata's own wait insists on
 * the Launcher being the current tab, which a restored layout need not keep.
 */
async function reload(page: IJupyterLabPageFixture): Promise<void> {
  await page.reload({ waitForIsReady: false });
  await page.evaluate(() => (window as any).jupyterapp.restored);
}

async function createFile(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await page.contents.uploadContent('text\n', 'text', path);
}

/** Open a file, or reveal the tab already showing it, and return its widget id. */
async function openFile(
  page: IJupyterLabPageFixture,
  path: string
): Promise<string> {
  const id = await page.evaluate(
    async p =>
      (
        await (window as any).jupyterapp.commands.execute('docmanager:open', {
          path: p
        })
      ).id as string,
    path
  );
  await page.locator(tabSelector(id)).waitFor();
  return id;
}

/**
 * Open a terminal tab and return its widget id and server session name. With a
 * name, the tab attaches to that running session - `terminal:open` reveals a
 * tab already showing it instead of opening a second one.
 */
async function openTerminal(
  page: IJupyterLabPageFixture,
  name?: string
): Promise<{ id: string; name: string }> {
  const opened = await page.evaluate(async n => {
    const app = (window as any).jupyterapp;
    if (n === null) {
      const widget = await app.commands.execute('terminal:create-new');
      return { id: widget.id as string, name: widget.content.session.name };
    }
    await app.commands.execute('terminal:open', { name: n });
    const widget: any = Array.from(app.shell.widgets('main')).find(
      (w: any) => w.content?.session?.name === n
    );
    return { id: widget.id as string, name: n };
  }, name ?? null);
  await page.locator(tabSelector(opened.id)).waitFor();
  return opened;
}

/** Close a tab the way its close button does; a terminal session keeps running. */
async function closeTab(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<void> {
  await page.evaluate(id => {
    const app = (window as any).jupyterapp;
    const widget: any = Array.from(app.shell.widgets('main')).find(
      (w: any) => w.id === id
    );
    widget.close();
  }, widgetId);
  await page.locator(tabSelector(widgetId)).waitFor({ state: 'detached' });
}

/** Shut a terminal down from this page, so the page sees it die. */
async function shutdownTerminal(
  page: IJupyterLabPageFixture,
  name: string
): Promise<void> {
  await page.evaluate(
    n => (window as any).jupyterapp.serviceManager.terminals.shutdown(n),
    name
  );
}

/** Start a terminal on the server alone and return the name it was given. */
async function createServerTerminal(
  page: IJupyterLabPageFixture
): Promise<string> {
  const response = await page.request.post(TERMINALS);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as any).name as string;
}

/** Remove a terminal on the server alone; already gone is not an error here. */
async function deleteServerTerminal(
  page: IJupyterLabPageFixture,
  name: string
): Promise<void> {
  await page.request.delete(`${TERMINALS}/${name}`);
}

/** Colour a tab the way a user does: right-click it, Tab Colour, a colour. */
async function colourByMenu(
  page: IJupyterLabPageFixture,
  widgetId: string,
  label: string
): Promise<void> {
  await page.locator(tabSelector(widgetId)).click({ button: 'right' });
  await page.locator('.lm-Menu-itemLabel', { hasText: /^Tab Colour$/ }).click();
  await page.locator('.lm-Menu-itemLabel', { hasText: label }).click();
}

test.describe('terminal name recycled', () => {
  test('a terminal given a shut-down terminal’s name opens clear', async ({
    page
  }) => {
    // ACC-IDENT-27: the page sees the first terminal die, then the server hands
    // its name to the next terminal created
    const first = await openTerminal(page);
    await colourByMenu(page, first.id, 'Green');
    await expect
      .poll(() => tabColour(page, first.id))
      .toEqual('jp-colourful-tab-mint');

    await shutdownTerminal(page, first.name);
    const second = await openTerminal(page);
    try {
      expect(second.name).toEqual(first.name);
      await page.waitForTimeout(SETTLE_MS);
      expect(await tabColour(page, second.id)).toBeNull();
      expect(await stored(page)).not.toHaveProperty(`terminal:${first.name}`);
    } finally {
      await deleteServerTerminal(page, second.name);
    }
  });

  test('a terminal recycled while no page was open opens clear', async ({
    page
  }) => {
    // ACC-IDENT-44, which overrides ACC-IDENT-28: nothing in the browser
    // sees the death, and the reused name is running when the page comes back,
    // so only the fingerprint can tell the new terminal from the old one
    const first = await openTerminal(page);
    const key = `terminal:${first.name}`;
    const fp = (await fingerprints(page))[first.name];
    await colourByMenu(page, first.id, 'Green');
    await expect
      .poll(async () => (await stored(page))[key])
      .toEqual({ colour: 3, fp });

    const lab = page.url();
    await page.mainFrame().goto('about:blank');
    await deleteServerTerminal(page, first.name);
    const second = await createServerTerminal(page);
    try {
      expect(second).toEqual(first.name);
      const answered = page.waitForResponse(response =>
        isFingerprintRequest(new URL(response.url()))
      );
      await page.mainFrame().goto(lab);
      await answered;
      await page.waitForFunction(() => !!(window as any).jupyterapp);
      await page.evaluate(() => (window as any).jupyterapp.restored);

      const reopened = await openTerminal(page, second);
      await page.waitForTimeout(SETTLE_MS);
      expect(await tabColour(page, reopened.id)).toBeNull();
      expect(await stored(page)).not.toHaveProperty(key);
    } finally {
      await deleteServerTerminal(page, second);
    }
  });
});

test('closing a terminal tab keeps the colour of its running session', async ({
  page
}) => {
  // ACC-IDENT-29: closing the tab is not the session dying
  const term = await openTerminal(page);
  const key = `terminal:${term.name}`;
  try {
    await colourByMenu(page, term.id, 'Blue');
    await expect
      .poll(() => tabColour(page, term.id))
      .toEqual('jp-colourful-tab-sky');

    await closeTab(page, term.id);
    const running = (await (await page.request.get(TERMINALS)).json()) as any[];
    expect(running.map(model => model.name)).toContain(term.name);
    await page.waitForTimeout(SETTLE_MS);
    expect(await stored(page)).toHaveProperty(key);

    const reopened = await openTerminal(page, term.name);
    expect(reopened.id).not.toEqual(term.id);
    await expect
      .poll(() => tabColour(page, reopened.id))
      .toEqual('jp-colourful-tab-sky');
  } finally {
    await deleteServerTerminal(page, term.name);
  }
});

test('a reload paints only the tab that has a stored colour', async ({
  page,
  tmpPath
}) => {
  // ACC-IDENT-30: a file, another file and a terminal are open; one is coloured
  const colouredPath = `${tmpPath}/coloured.txt`;
  const plainPath = `${tmpPath}/plain.txt`;
  await createFile(page, colouredPath);
  await createFile(page, plainPath);
  const coloured = await openFile(page, colouredPath);
  await openFile(page, plainPath);
  const term = await openTerminal(page);
  try {
    await colourByMenu(page, coloured, 'Red');
    await expect.poll(() => colouredTabs(page)).toEqual([coloured]);

    await reload(page);
    // Widget ids are per page load, so the restored tabs are found by what
    // they show
    const colouredAgain = await openFile(page, colouredPath);
    const plainAgain = await openFile(page, plainPath);
    const termAgain = await openTerminal(page, term.name);
    await expect
      .poll(() => tabColour(page, colouredAgain))
      .toEqual('jp-colourful-tab-rose');
    await page.waitForTimeout(SETTLE_MS);
    expect(await tabColour(page, plainAgain)).toBeNull();
    expect(await tabColour(page, termAgain.id)).toBeNull();
    expect(await colouredTabs(page)).toEqual([colouredAgain]);
  } finally {
    await deleteServerTerminal(page, term.name);
  }
});

test('a renamed file loses its colour and the old path keeps it', async ({
  page,
  tmpPath
}) => {
  // ACC-IDENT-31: the path is the identity, so the colour stays with the path
  const before = `${tmpPath}/before.txt`;
  const after = `${tmpPath}/after.txt`;
  await createFile(page, before);
  const id = await openFile(page, before);
  await colourByMenu(page, id, 'Purple');
  await expect
    .poll(() => tabColour(page, id))
    .toEqual('jp-colourful-tab-lavender');

  await page.evaluate(
    ([from, to]) =>
      (window as any).jupyterapp.serviceManager.contents.rename(from, to),
    [before, after]
  );
  await expect
    .poll(() => page.locator(tabSelector(id)).getAttribute('title'))
    .toContain(`Path: ${after}`);

  // The tab keeps the class it was painted with until Lumino next rewrites its
  // class attribute - a tab switch or a reload; a reload always comes
  await reload(page);
  const renamed = await openFile(page, after);
  await page.waitForTimeout(SETTLE_MS);
  expect(await tabColour(page, renamed)).toBeNull();
  expect(await stored(page)).toEqual({ [before]: 5 });

  // A file recreated at the coloured path takes the colour back
  await createFile(page, before);
  const recreated = await openFile(page, before);
  await expect
    .poll(() => tabColour(page, recreated))
    .toEqual('jp-colourful-tab-lavender');
});

test('without the fingerprint route terminal colours follow the running list', async ({
  page
}) => {
  // ACC-IDENT-43: a server without the route - an older release, or the
  // server extension disabled - answers 404, and the extension falls back to
  // the running list rather than reading the failure as "no terminals"
  await page.route(isFingerprintRequest, route =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not Found' })
    })
  );
  await reload(page);

  const term = await openTerminal(page);
  const key = `terminal:${term.name}`;
  try {
    await colourByMenu(page, term.id, 'Orange');
    // No fingerprint to pair it with, so the bare palette index is stored
    await expect.poll(async () => (await stored(page))[key]).toEqual(1);

    // Still listed as running after a reload, so the colour stays
    await reload(page);
    const restored = await openTerminal(page, term.name);
    await expect
      .poll(() => tabColour(page, restored.id))
      .toEqual('jp-colourful-tab-peach');
    expect((await stored(page))[key]).toEqual(1);

    // No longer listed, so the colour goes
    await shutdownTerminal(page, term.name);
    await expect.poll(async () => (await stored(page))[key]).toBeUndefined();
  } finally {
    await deleteServerTerminal(page, term.name);
  }
});
