import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The public `IColourfulTabs` API against the context menu's stored colours
 * (DEF-COLOUR-5, ACC-ACTIVE-12, ACC-ACTIVE-13): a tab tinted through
 * `setColour` keeps one colour through every re-render, and a menu colour
 * stored for the same terminal neither repaints over it nor resurfaces once
 * the API colour is cleared.
 *
 * Lumino rewrites a tab's class attribute only when the class string it
 * renders changes, so a label-only title change never reaches the fight. Each
 * update below also toggles a status token on `title.className`, as a
 * consumer showing a busy state does, and the class attribute is recorded on
 * every change the browser could paint.
 */

/**
 * Real terminals: the menu stores a terminal colour with the fingerprint the
 * server extension reports, and under Galata's terminals mock the session
 * exists only in the browser, so no fingerprint is ever reported for it.
 */
test.use({ terminals: null });

const STORAGE_KEY = 'jupyterlab-colourful-tab-colours';

/** Title updates per test, as the criterion's test hint asks. */
const UPDATES = 10;

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

/** Colour a tab the way a user does: right-click it, Tab Colour, a colour. */
async function colourByMenu(
  page: IJupyterLabPageFixture,
  widgetId: string,
  label: string
): Promise<void> {
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`)
    .click({ button: 'right' });
  await page.locator('.lm-Menu-itemLabel', { hasText: /^Tab Colour$/ }).click();
  await page.locator('.lm-Menu-itemLabel', { hasText: label }).click();
}

/**
 * Call the plugin's `IColourfulTabs` the way a consumer extension does. With
 * `claim`, the claim is taken first and kept on `window` for the page's life.
 */
async function colourByApi(
  page: IJupyterLabPageFixture,
  widgetId: string,
  colourId: string | null,
  claim = false
): Promise<void> {
  await page.evaluate(
    async ([id, colour, owned]) => {
      const api = await (window as any).galata.getPlugin(
        'jupyterlab_colourful_tab_extension:plugin'
      );
      const widget = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ).find((w: any) => w.id === id);
      if (owned) {
        (window as any).colourfulTabsClaim = api.claim(widget);
      }
      api.setColour(widget, colour);
    },
    [widgetId, colourId, claim] as const
  );
}

/** The colours the menu has persisted, as the plugin wrote them. */
async function readStore(
  page: IJupyterLabPageFixture
): Promise<Record<string, unknown>> {
  return page.evaluate(
    key => JSON.parse(localStorage.getItem(key) ?? '{}'),
    STORAGE_KEY
  );
}

/** The colour classes on a tab, now. */
async function tabColours(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<string[]> {
  return page.evaluate(
    id =>
      Array.from(
        document.querySelector(
          `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
        )?.classList ?? []
      ).filter(c =>
        /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
      ),
    widgetId
  );
}

/**
 * Update the tab's title `count` times, 150 ms apart - three times the
 * plugin's 50 ms refresh debounce, so every repaint the update provokes has
 * run before the next one - and return the tab's colour classes as they stood
 * after each change to its class attribute.
 */
async function updateTitle(
  page: IJupyterLabPageFixture,
  widgetId: string,
  count: number
): Promise<string[][]> {
  return page.evaluate(
    async ([id, steps]) => {
      const widget = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ).find((w: any) => w.id === id) as any;
      const tab = document.querySelector(
        `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
      ) as HTMLElement;
      const colours = (): string[] =>
        Array.from(tab.classList).filter(c =>
          /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
        );
      const seen: string[][] = [];
      const observer = new MutationObserver(() => seen.push(colours()));
      observer.observe(tab, { attributes: true, attributeFilter: ['class'] });
      for (let i = 0; i < steps; i++) {
        widget.title.label = `Terminal status ${i}`;
        const tokens = widget.title.className
          .split(/\s+/)
          .filter((t: string) => t && t !== 'test-status-busy');
        if (i % 2 === 0) {
          tokens.push('test-status-busy');
        }
        widget.title.className = tokens.join(' ');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      observer.disconnect();
      return seen;
    },
    [widgetId, count] as const
  );
}

test('API colour on an unclaimed terminal purges the menu colour and holds', async ({
  page
}) => {
  // ACC-ACTIVE-12, ACC-ACTIVE-13, DEF-COLOUR-5
  const terminal = await openTerminal(page);
  const key = `terminal:${terminal.name}`;
  try {
    await colourByMenu(page, terminal.id, 'Orange');
    await expect
      .poll(async () => Object.keys(await readStore(page)))
      .toEqual([key]);

    // The API takes the tab over and the stored menu colour goes with it
    await colourByApi(page, terminal.id, 'sky');
    await expect.poll(() => readStore(page)).toEqual({});

    const held = await updateTitle(page, terminal.id, UPDATES);
    // One record per update at least, so the fight was given every chance
    expect(held.length).toBeGreaterThanOrEqual(UPDATES);
    expect(held.filter(c => c.join() !== 'jp-colourful-tab-sky')).toEqual([]);

    // Cleared by the API, the tab stays clear: the old menu colour is gone
    await colourByApi(page, terminal.id, null);
    const cleared = await updateTitle(page, terminal.id, 2);
    expect(cleared.length).toBeGreaterThanOrEqual(2);
    expect(cleared.filter(c => c.length > 0)).toEqual([]);
  } finally {
    await page.request.delete(`/api/terminals/${terminal.name}`);
  }
});

test("a claimed terminal keeps the owner's colour over its verified menu colour", async ({
  page
}) => {
  // ACC-ACTIVE-12, ACC-API-37, DEF-COLOUR-5. On a claimed tab `setColour` keeps
  // the stored entry, so the only thing between it and the owner's colour is
  // the refresh's no-colour-class guard
  const terminal = await openTerminal(page);
  const key = `terminal:${terminal.name}`;
  try {
    await colourByMenu(page, terminal.id, 'Orange');
    // Stored with the fingerprint the server reports for this terminal - a
    // verified entry, the one kind a claimed tab may be repainted from
    const fp = (
      (await (await page.request.get('/colourful-tab/terminals')).json()) as any
    ).terminals[terminal.name];
    expect(fp).toBeTruthy();
    await expect
      .poll(async () => (await readStore(page))[key])
      .toEqual({ colour: 1, fp });

    await colourByApi(page, terminal.id, 'sky', true);
    expect((await readStore(page))[key]).toEqual({ colour: 1, fp });

    const held = await updateTitle(page, terminal.id, UPDATES);
    expect(held.length).toBeGreaterThanOrEqual(UPDATES);
    expect(held.filter(c => c.join() !== 'jp-colourful-tab-sky')).toEqual([]);

    // The owner clears its colour: the user's verified earlier choice shows
    await colourByApi(page, terminal.id, null);
    await expect
      .poll(() => tabColours(page, terminal.id))
      .toEqual(['jp-colourful-tab-peach']);
  } finally {
    await page.request.delete(`/api/terminals/${terminal.name}`);
  }
});

test('a menu colour on a terminal the API never touched returns after reload', async ({
  page
}) => {
  // ACC-ACTIVE-13: persistence intact for a colourless, non-API terminal
  const terminal = await openTerminal(page);
  try {
    await colourByMenu(page, terminal.id, 'Orange');
    await expect
      .poll(async () => Object.keys(await readStore(page)))
      .toEqual([`terminal:${terminal.name}`]);

    await page.reload();

    // Reopened by session name: the restorer may already have brought the tab
    // back, in which case `terminal:open` activates it instead
    const id = await page.evaluate(
      async name =>
        (
          await (window as any).jupyterapp.commands.execute('terminal:open', {
            name
          })
        ).id as string,
      terminal.name
    );
    await expect
      .poll(() => tabColours(page, id))
      .toEqual(['jp-colourful-tab-peach']);
  } finally {
    await page.request.delete(`/api/terminals/${terminal.name}`);
  }
});
