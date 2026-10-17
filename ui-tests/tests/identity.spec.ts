import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * What a menu colour is persisted under (ACC-IDENT-22 to ACC-IDENT-26,
 * DEF-COLOUR-6): a file tab's path, or a terminal's session name bound to the
 * fingerprint of its pty. Nothing is stored under a slot that is handed out
 * again - a JupyterLab widget id (`launcher-0`) restarts from 0 on every page
 * load, and terminado gives a closed terminal's name to the next terminal
 * created - because a colour stored under either paints a brand-new tab.
 *
 * Asserted on the tab's colour class and on the stored map across real page
 * loads, because both recycling paths only show after a reload or a reused
 * terminal name.
 */

/**
 * `terminals: null` turns OFF Galata's terminals mock. Under it a terminal
 * exists only in the browser, so the server can neither shut it down nor hand
 * its name to the next one.
 */
test.use({ terminals: null });

const STORAGE_KEY = 'jupyterlab-colourful-tab-colours';

const NOTEBOOK = JSON.stringify({
  cells: [],
  metadata: {
    kernelspec: {
      name: 'python3',
      display_name: 'Python 3',
      language: 'python'
    }
  },
  nbformat: 4,
  nbformat_minor: 5
});

/** The persisted colour map, as the extension wrote it. */
async function storedColours(
  page: IJupyterLabPageFixture
): Promise<Record<string, unknown>> {
  return page.evaluate(
    key => JSON.parse(localStorage.getItem(key) ?? '{}'),
    STORAGE_KEY
  );
}

/** The colour class on a widget's dock tab, or null when it has none. */
async function tabColour(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<string | null> {
  return page.evaluate(id => {
    const tab = document.querySelector(
      `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
    );
    if (!tab) {
      throw new Error(`no tab for ${id}`);
    }
    return (
      Array.from(tab.classList).find(c =>
        /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
      ) ?? null
    );
  }, widgetId);
}

async function currentWidgetId(page: IJupyterLabPageFixture): Promise<string> {
  return page.evaluate(
    () => (window as any).jupyterapp.shell.currentWidget.id as string
  );
}

/** Open a file through `docmanager:open` and return its widget id. */
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
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${id}"]`)
    .waitFor();
  return id;
}

/** Open a new terminal and return its widget id and server session name. */
async function openTerminal(
  page: IJupyterLabPageFixture
): Promise<{ id: string; name: string }> {
  const id = await page.evaluate(
    async () =>
      (await (window as any).jupyterapp.commands.execute('terminal:create-new'))
        .id as string
  );
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${id}"]`)
    .waitFor();
  const name = await page.evaluate(
    widgetId =>
      Array.from((window as any).jupyterapp.shell.widgets('main')).find(
        (w: any) => w.id === widgetId
      ).content.session.name as string,
    id
  );
  return { id, name };
}

/** Open a launcher and return its widget id. */
async function openLauncher(page: IJupyterLabPageFixture): Promise<string> {
  const id = await page.evaluate(
    async () =>
      (await (window as any).jupyterapp.commands.execute('launcher:create'))
        .id as string
  );
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${id}"]`)
    .waitFor();
  return id;
}

/**
 * Close a widget's tab; a terminal's session keeps running. Disposed rather
 * than closed, because the kernel's `language_info` marks a freshly opened
 * notebook dirty and `close()` would stop at the save dialog.
 */
async function closeTab(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<void> {
  await page.evaluate(id => {
    Array.from((window as any).jupyterapp.shell.widgets('main'))
      .find((w: any) => w.id === id)
      .dispose();
  }, widgetId);
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`)
    .waitFor({ state: 'detached' });
}

/** The widget id now showing a file, which a reload or a reopen replaces. */
async function fileWidgetId(
  page: IJupyterLabPageFixture,
  path: string
): Promise<string | undefined> {
  return page.evaluate(
    p =>
      (
        Array.from((window as any).jupyterapp.shell.widgets('main')).find(
          (w: any) => w.context?.path === p
        ) as any
      )?.id,
    path
  );
}

/** The widget id now showing a terminal session. */
async function terminalWidgetId(
  page: IJupyterLabPageFixture,
  name: string
): Promise<string | undefined> {
  return page.evaluate(
    n =>
      (
        Array.from((window as any).jupyterapp.shell.widgets('main')).find(
          (w: any) => w.content?.session?.name === n
        ) as any
      )?.id,
    name
  );
}

/** The fingerprint the server reports for a terminal session. */
async function fingerprint(
  page: IJupyterLabPageFixture,
  name: string
): Promise<string> {
  const response = await page.request.get('/colourful-tab/terminals');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as any).terminals[name];
}

/** Colour a tab the way a user does: right-click it, Tab Colour, a colour. */
async function colourByMenu(
  page: IJupyterLabPageFixture,
  widgetId: string,
  label: string | RegExp
): Promise<void> {
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`)
    .click({ button: 'right' });
  await page.locator('.lm-Menu-itemLabel', { hasText: /^Tab Colour$/ }).click();
  await page.locator('.lm-Menu-itemLabel', { hasText: label }).click();
}

/**
 * Select a tab by clicking it, and wait until Lumino has rendered it as the
 * current tab. That render rewrites the class attribute of each tab that
 * became or stopped being current from its widget title, so a colour class
 * read afterwards has been through it.
 */
async function activate(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<void> {
  const tab = page.locator(
    `#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`
  );
  await tab.click();
  await expect(tab).toHaveClass(/\blm-mod-current\b/);
}

/**
 * Wait for one full repaint pass over the stored colours.
 *
 * Takes the class off a tab whose colour is stored, as Lumino does when it
 * rebuilds a tab's class attribute, and waits for the extension to put it
 * back. That pass visits every stored entry against every tab in the dock, so
 * a tab it leaves clear is clear by decision rather than because the debounced
 * repaint has not run yet.
 */
async function repaintPass(
  page: IJupyterLabPageFixture,
  anchorId: string,
  colourClass: string
): Promise<void> {
  await page.evaluate(
    ([id, cls]) =>
      document
        .querySelector(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${id}"]`)
        ?.classList.remove(cls),
    [anchorId, colourClass]
  );
  await expect.poll(() => tabColour(page, anchorId)).toEqual(colourClass);
}

/**
 * Wait until the saved workspace holds every given restorer key. JupyterLab
 * saves the workspace on a debounce, and a reload that lands first restores an
 * older layout without the tab under test.
 */
async function layoutSaved(
  page: IJupyterLabPageFixture,
  keys: string[]
): Promise<void> {
  await expect
    .poll(async () => {
      const data = await page.evaluate(
        async () =>
          (
            await (window as any).jupyterapp.serviceManager.workspaces.fetch(
              'default'
            )
          ).data
      );
      return keys.filter(key => !(key in data));
    })
    .toEqual([]);
}

/**
 * Reload, then wait for the restored layout. Galata's own ready check waits
 * for an active Launcher, which a restored layout does not have.
 */
async function reload(page: IJupyterLabPageFixture): Promise<void> {
  await page.reload({ waitForIsReady: false });
  await page.evaluate(() => (window as any).jupyterapp.restored);
}

/**
 * Leave the lab for another page of the same origin and come back by URL,
 * which is what the browser does on a JupyterHub control-panel round trip: the
 * lab document is discarded and loaded cold, with the same localStorage.
 */
async function leaveAndReturn(page: IJupyterLabPageFixture): Promise<void> {
  const lab = page.url();
  await page.evaluate(() => {
    window.location.href = '/api/status';
  });
  await page.waitForURL('**/api/status');
  await page.evaluate(url => {
    window.location.href = url;
  }, lab);
  await page.waitForURL(lab);
  await page.waitForFunction(
    () => typeof (window as any).jupyterapp === 'object'
  );
  await page.evaluate(() => (window as any).jupyterapp.restored);
}

test('a launcher colour is never stored, so the next launcher-0 opens clear', async ({
  page,
  tmpPath
}) => {
  // ACC-IDENT-25, ACC-IDENT-22, DEF-COLOUR-6 - the reported repro: colour the
  // first launcher of the session, reload, open a launcher
  const launcher = await currentWidgetId(page);
  const path = `${tmpPath}/anchor.ipynb`;
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
  const anchor = await openFile(page, path);
  await colourByMenu(page, anchor, 'Blue');
  await colourByMenu(page, launcher, 'Orange');

  // Coloured for this session, stored nowhere
  await expect
    .poll(() => tabColour(page, launcher))
    .toEqual('jp-colourful-tab-peach');
  expect(await storedColours(page)).toEqual({ [path]: 4 });

  await reload(page);
  const fresh = await openLauncher(page);
  // Restored or opened again, the anchor shows its stored colour
  const reopened = await openFile(page, path);
  await repaintPass(page, reopened, 'jp-colourful-tab-sky');
  // The widget id counter restarts with the page, so a launcher of this
  // session holds the coloured launcher's id again - this one, or the one
  // JupyterLab opens by itself on an empty main area. `tabColour` throws when
  // no tab holds that id, so the recycled slot is asserted, not assumed
  for (const id of new Set([launcher, fresh])) {
    expect(await tabColour(page, id)).toBeNull();
  }
});

test('a launcher colour lasts while the current tab changes, and so does its clear', async ({
  page,
  tmpPath
}) => {
  // DEF-IDENT-11, ACC-IDENT-25 - a tab with no stable identity has no stored
  // colour to repaint it, so the colour must survive Lumino's re-render alone
  const launcher = await currentWidgetId(page);
  const path = `${tmpPath}/anchor.ipynb`;
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
  const anchor = await openFile(page, path);
  await colourByMenu(page, anchor, 'Blue');
  await colourByMenu(page, launcher, 'Orange');

  for (const id of [anchor, launcher]) {
    await activate(page, id);
    expect(await tabColour(page, launcher)).toEqual('jp-colourful-tab-peach');
  }
  expect(await storedColours(page)).toEqual({ [path]: 4 });

  await colourByMenu(page, launcher, /^Clear$/);
  for (const id of [anchor, launcher]) {
    await activate(page, id);
    expect(await tabColour(page, launcher)).toBeNull();
  }
});

test('a terminal shut down on the server drops its colour, and the next terminal to take its name opens clear', async ({
  page,
  tmpPath
}) => {
  // ACC-IDENT-24, ACC-IDENT-22, DEF-COLOUR-6
  const path = `${tmpPath}/anchor.ipynb`;
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
  const anchor = await openFile(page, path);
  await colourByMenu(page, anchor, 'Blue');

  const first = await openTerminal(page);
  let second: { id: string; name: string } | null = null;
  try {
    await colourByMenu(page, first.id, 'Orange');
    await expect
      .poll(() => storedColours(page))
      .toEqual({
        [path]: 4,
        [`terminal:${first.name}`]: {
          colour: 1,
          fp: await fingerprint(page, first.name)
        }
      });

    // What the Running panel's shut-down does: the server ends the session
    // and the terminal manager reports the new running set
    await page.evaluate(
      name =>
        (window as any).jupyterapp.serviceManager.terminals.shutdown(name),
      first.name
    );
    await expect.poll(() => storedColours(page)).toEqual({ [path]: 4 });

    second = await openTerminal(page);
    // terminado hands out the lowest free name
    expect(second.name).toEqual(first.name);
    await repaintPass(page, anchor, 'jp-colourful-tab-sky');
    expect(await tabColour(page, second.id)).toBeNull();
  } finally {
    for (const t of [first, second]) {
      if (t) {
        await page.request.delete(`/api/terminals/${t.name}`);
      }
    }
  }
});

test('a terminal name recycled behind the page opens clear', async ({
  page,
  tmpPath
}) => {
  // DEF-COLOUR-6 - the death is never reported to this page, so only the
  // fingerprint can tell the new terminal from the coloured one
  const path = `${tmpPath}/anchor.ipynb`;
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
  const anchor = await openFile(page, path);
  await colourByMenu(page, anchor, 'Blue');

  const first = await openTerminal(page);
  let second: { id: string; name: string } | null = null;
  try {
    await colourByMenu(page, first.id, 'Orange');
    const stored = {
      [path]: 4,
      [`terminal:${first.name}`]: {
        colour: 1,
        fp: await fingerprint(page, first.name)
      }
    };
    await expect.poll(() => storedColours(page)).toEqual(stored);

    // Closing the tab leaves the session running, and its colour with it
    await closeTab(page, first.id);
    expect(await storedColours(page)).toEqual(stored);

    // Ended from outside the page, which keeps listing the name until its
    // next poll; the new terminal is then handed the same name at once
    await page.request.delete(`/api/terminals/${first.name}`);
    second = await openTerminal(page);
    expect(second.name).toEqual(first.name);

    await expect.poll(() => storedColours(page)).toEqual({ [path]: 4 });
    await repaintPass(page, anchor, 'jp-colourful-tab-sky');
    expect(await tabColour(page, second.id)).toBeNull();
  } finally {
    if (second) {
      await page.request.delete(`/api/terminals/${second.name}`);
    }
  }
});

test('a file colour follows the path across close and reopen', async ({
  page,
  tmpPath
}) => {
  // ACC-IDENT-23 - the reload half is the file persistence test below
  const path = `${tmpPath}/followed.ipynb`;
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
  const notebook = await openFile(page, path);
  await colourByMenu(page, notebook, 'Purple');
  expect(await storedColours(page)).toEqual({ [path]: 5 });

  await closeTab(page, notebook);
  const reopened = await openFile(page, path);
  expect(reopened).not.toEqual(notebook);
  await expect
    .poll(() => tabColour(page, reopened))
    .toEqual('jp-colourful-tab-lavender');
});

test('a running terminal keeps its colour across a reload and a navigation away and back', async ({
  page
}) => {
  // ACC-IDENT-26 - the 1.1.3 regression deleted stored colours on a cold load,
  // before the restored tabs had resolved their identities
  const terminal = await openTerminal(page);
  try {
    await colourByMenu(page, terminal.id, 'Orange');
    const stored = {
      [`terminal:${terminal.name}`]: {
        colour: 1,
        fp: await fingerprint(page, terminal.name)
      }
    };
    await expect.poll(() => storedColours(page)).toEqual(stored);
    await layoutSaved(page, [`terminal:${terminal.name}`]);

    for (const load of [reload, leaveAndReturn]) {
      await load(page);
      await expect
        .poll(async () => {
          const id = await terminalWidgetId(page, terminal.name);
          return id ? await tabColour(page, id) : 'not restored';
        })
        .toEqual('jp-colourful-tab-peach');
      expect(await storedColours(page)).toEqual(stored);
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal.name}`);
  }
});

// At `app.restored` a restored document tab still has an empty `title`
// attribute; its path arrives later as a `title` change. Behind a terminal that
// change is the only tab mutation, so the MutationObserver in `src/index.ts`
// must watch `title` as well as `class`: with `class` alone this test failed
// 5 of 5 runs.
test('a background notebook keeps its colour across a reload and a navigation away and back', async ({
  page,
  tmpPath
}) => {
  // ACC-IDENT-26, ACC-IDENT-23
  const path = `${tmpPath}/persisted.ipynb`;
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
  const notebook = await openFile(page, path);
  await colourByMenu(page, notebook, 'Blue');
  expect(await storedColours(page)).toEqual({ [path]: 4 });
  const terminal = await openTerminal(page);
  try {
    await layoutSaved(page, [`notebook:${path}`, `terminal:${terminal.name}`]);

    for (const load of [reload, leaveAndReturn]) {
      await load(page);
      await expect
        .poll(async () => {
          const id = await fileWidgetId(page, path);
          return id ? await tabColour(page, id) : 'not restored';
        })
        .toEqual('jp-colourful-tab-sky');
      expect(await storedColours(page)).toEqual({ [path]: 4 });
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal.name}`);
  }
});
