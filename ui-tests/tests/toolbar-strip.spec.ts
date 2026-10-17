import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The strip below a coloured tab (DEF-TOOL-2, DEF-TOOL-3, DEF-TOOL-4,
 * DEF-TOOL-8): the first `jp-toolbar` of the CURRENT tab's own widget takes the
 * tab's colour class, and its shadow `::part(positioning-region)`, which paints
 * the visible band, shows the tab's `-active` shade. A hidden widget's toolbar
 * carries no colour class, and an inactive coloured tab keeps its base shade.
 *
 * Asserted on computed colours, not on classes alone, because the strip has
 * regressed while its class logic was intact: the class is only half of it.
 */

/** Everything the strip below one tab is made of, as the browser computes it. */
interface IStrip {
  current: boolean;
  tabClass: string | null;
  toolbarClass: string | null;
  tabBg: string;
  toolbarBg: string;
  regionBg: string;
}

async function strip(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<IStrip> {
  return page.evaluate(id => {
    const colourClass = (el: Element | null | undefined): string | null =>
      el
        ? (Array.from(el.classList).find(c =>
            /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
          ) ?? null)
        : null;
    const tab = document.querySelector(
      `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
    );
    const toolbar = document.getElementById(id)?.querySelector('jp-toolbar');
    const region = toolbar?.shadowRoot?.querySelector(
      '[part~="positioning-region"]'
    );
    const bg = (el: Element | null | undefined): string =>
      el ? getComputedStyle(el).backgroundColor : 'missing';
    return {
      current: !!tab?.classList.contains('lm-mod-current'),
      tabClass: colourClass(tab),
      toolbarClass: colourClass(toolbar),
      tabBg: bg(tab),
      toolbarBg: bg(toolbar),
      regionBg: bg(region)
    };
  }, widgetId);
}

/** A colour variable resolved to `rgb(...)` in the current theme. */
async function shade(
  page: IJupyterLabPageFixture,
  variable: string
): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, variable);
}

async function currentWidgetId(page: IJupyterLabPageFixture): Promise<string> {
  return page.evaluate(
    () => (window as any).jupyterapp.shell.currentWidget.id as string
  );
}

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

/**
 * Open a new notebook and return its widget id. Through the contents API and
 * `docmanager:open` rather than the launcher, which a lab may replace with its
 * own start page.
 */
async function openNotebook(
  page: IJupyterLabPageFixture,
  path: string
): Promise<string> {
  await page.contents.uploadContent(NOTEBOOK, 'text', path);
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

/**
 * Move a main-area widget into a new panel to the right of `ref`. Each panel
 * then has its own tab bar and its own current tab, so both tabs are current.
 */
async function splitRight(
  page: IJupyterLabPageFixture,
  widgetId: string,
  ref: string
): Promise<void> {
  await page.evaluate(
    ([id, refId]) => {
      const app = (window as any).jupyterapp;
      const widget = Array.from(app.shell.widgets('main')).find(
        (w: any) => w.id === id
      );
      app.shell.add(widget, 'main', { mode: 'split-right', ref: refId });
    },
    [widgetId, ref]
  );
  await expect
    .poll(async () => [
      (await strip(page, ref)).current,
      (await strip(page, widgetId)).current
    ])
    .toEqual([true, true]);
}

/**
 * Add a plain Lumino widget, which has no `jp-toolbar`, to a new panel to the
 * right of `ref`, the way a consumer extension can, and return its id. The
 * page exposes no Lumino module, so `Widget` is reached through the shell,
 * which extends it.
 */
async function openPlainWidget(
  page: IJupyterLabPageFixture,
  ref: string
): Promise<string> {
  const id = await page.evaluate(refId => {
    const app = (window as any).jupyterapp;
    const Widget = Object.getPrototypeOf(app.shell.constructor);
    const widget = new Widget();
    widget.id = 'toolbar-strip-plain';
    widget.title.label = 'Plain';
    widget.title.closable = true;
    app.shell.add(widget, 'main', { mode: 'split-right', ref: refId });
    return widget.id as string;
  }, ref);
  await expect
    .poll(async () => [
      (await strip(page, ref)).current,
      (await strip(page, id)).current
    ])
    .toEqual([true, true]);
  return id;
}

async function activate(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<void> {
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`)
    .click();
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

/** Colour a tab the way a consumer extension does: `IColourfulTabs.setColour`. */
async function colourByApi(
  page: IJupyterLabPageFixture,
  widgetId: string,
  colourId: string | null
): Promise<void> {
  await page.evaluate(
    async ([id, colour]) => {
      const api = await (window as any).galata.getPlugin(
        'jupyterlab_colourful_tab_extension:plugin'
      );
      const app = (window as any).jupyterapp;
      const widget = Array.from(app.shell.widgets('main')).find(
        (w: any) => w.id === id
      );
      api.setColour(widget, colour);
    },
    [widgetId, colourId]
  );
}

/** The strip below the current tab is the tab's own `-active` shade. */
async function expectStripColoured(
  page: IJupyterLabPageFixture,
  widgetId: string,
  colourId: string
): Promise<void> {
  const active = await shade(page, `--jp-colourful-tab-${colourId}-active`);
  await expect
    .poll(() => strip(page, widgetId))
    .toEqual({
      current: true,
      tabClass: `jp-colourful-tab-${colourId}`,
      toolbarClass: `jp-colourful-tab-${colourId}`,
      tabBg: active,
      toolbarBg: active,
      regionBg: active
    });
}

/** An inactive coloured tab keeps its base shade, its hidden toolbar no class. */
async function expectInactive(
  page: IJupyterLabPageFixture,
  widgetId: string,
  colourId: string
): Promise<void> {
  const base = await shade(page, `--jp-colourful-tab-${colourId}`);
  await expect
    .poll(async () => {
      const { current, tabClass, toolbarClass, tabBg } = await strip(
        page,
        widgetId
      );
      return { current, tabClass, toolbarClass, tabBg };
    })
    .toEqual({
      current: false,
      tabClass: `jp-colourful-tab-${colourId}`,
      toolbarClass: null,
      tabBg: base
    });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`strip below the current tab, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      if (theme === 'dark') {
        await page.theme.setDarkTheme();
      } else {
        await page.theme.setLightTheme();
      }
    });

    test('menu colour follows the current tab across switches', async ({
      page,
      tmpPath
    }) => {
      const first = await openNotebook(page, `${tmpPath}/first.ipynb`);
      const second = await openNotebook(page, `${tmpPath}/second.ipynb`);

      await activate(page, first);
      await colourByMenu(page, first, 'Red');
      await expectStripColoured(page, first, 'rose');

      // An uncoloured current tab leaves its strip uncoloured
      await activate(page, second);
      await expect
        .poll(async () => (await strip(page, second)).toolbarClass)
        .toBeNull();
      await expectInactive(page, first, 'rose');

      // And the strip comes back when the coloured tab is current again
      await activate(page, first);
      await expectStripColoured(page, first, 'rose');
      await expect
        .poll(async () => (await strip(page, second)).toolbarClass)
        .toBeNull();
    });

    // ACC-ACTIVE-32: clearing the tab colour, from the menu or the API, puts
    // the strip back to what it was before the tab was coloured
    test('clearing the tab colour clears its strip', async ({
      page,
      tmpPath
    }) => {
      const notebook = await openNotebook(page, `${tmpPath}/clear.ipynb`);
      const before = await strip(page, notebook);

      await colourByMenu(page, notebook, 'Green');
      await expectStripColoured(page, notebook, 'mint');
      await colourByMenu(page, notebook, /^Clear$/);
      await expect.poll(() => strip(page, notebook)).toEqual(before);

      await colourByApi(page, notebook, 'peach');
      await expectStripColoured(page, notebook, 'peach');
      await colourByApi(page, notebook, null);
      await expect.poll(() => strip(page, notebook)).toEqual(before);
    });

    // DEF-TOOL-10: the strip paints the toolbar's own band and not the buttons
    // on it, so a button keeps its own fill at rest and its hover fill
    test('a button on a coloured strip keeps its hover fill', async ({
      page,
      tmpPath
    }) => {
      const notebook = await openNotebook(page, `${tmpPath}/hover.ipynb`);
      await colourByMenu(page, notebook, 'Blue');
      await expectStripColoured(page, notebook, 'sky');

      // Save, the first button of the notebook's own toolbar
      const button = page
        .locator(`[id="${notebook}"] jp-toolbar`)
        .first()
        .locator('jp-button')
        .first();
      const bg = () =>
        button.evaluate(el => getComputedStyle(el).backgroundColor);

      // The menu click can leave the pointer over the toolbar
      await page.mouse.move(1, 1);
      const rest = await bg();
      expect(rest).not.toEqual(
        await shade(page, '--jp-colourful-tab-sky-active')
      );
      await button.hover();
      await expect.poll(bg).not.toEqual(rest);
    });

    // ACC-ACTIVE-11, DEF-TOOL-4: a coloured tab whose widget has no toolbar of
    // its own paints no strip at all - in particular not the toolbar of the
    // widget in the other panel, which is the only toolbar on screen
    test('split: a tab without a toolbar paints no other panel', async ({
      page,
      tmpPath
    }) => {
      const notebook = await openNotebook(page, `${tmpPath}/plain.ipynb`);
      const plain = await openPlainWidget(page, notebook);

      await colourByApi(page, plain, 'lavender');
      const brief = async (id: string) => {
        const { current, tabClass, toolbarClass } = await strip(page, id);
        return { current, tabClass, toolbarClass };
      };
      await expect
        .poll(() => brief(plain))
        .toEqual({
          current: true,
          tabClass: 'jp-colourful-tab-lavender',
          toolbarClass: null
        });
      await expect
        .poll(() => brief(notebook))
        .toEqual({
          current: true,
          tabClass: null,
          toolbarClass: null
        });

      // The notebook's own colour still reaches its own strip
      await colourByApi(page, notebook, 'mint');
      await expectStripColoured(page, notebook, 'mint');
      await expect
        .poll(() => brief(plain))
        .toEqual({
          current: true,
          tabClass: 'jp-colourful-tab-lavender',
          toolbarClass: null
        });
    });

    test.describe(() => {
      // A real terminal: under Galata's terminals mock the session exists only
      // in the browser and its websocket has no server end
      test.use({ terminals: null });

      test('API colour reaches the strip, terminal included', async ({
        page,
        tmpPath
      }) => {
        const notebook = await openNotebook(page, `${tmpPath}/api.ipynb`);
        await colourByApi(page, notebook, 'mint');
        await expectStripColoured(page, notebook, 'mint');

        // A terminal's toolbar is the 8 px micro strip; coloured the same
        const terminal = await openTerminal(page);
        try {
          await expect.poll(() => currentWidgetId(page)).toEqual(terminal.id);
          await colourByApi(page, terminal.id, 'sky');
          await expectStripColoured(page, terminal.id, 'sky');
          await expectInactive(page, notebook, 'mint');

          await activate(page, notebook);
          await expectStripColoured(page, notebook, 'mint');
          await expectInactive(page, terminal.id, 'sky');
        } finally {
          await page.request.delete(`/api/terminals/${terminal.name}`);
        }
      });

      // ACC-ACTIVE-11, DEF-TOOL-4: notebook and terminal side by side, each
      // panel's strip takes the colour of that panel's own current tab
      test('split: each panel strip takes its own tab colour', async ({
        page,
        tmpPath
      }) => {
        const notebook = await openNotebook(page, `${tmpPath}/split.ipynb`);
        const terminal = await openTerminal(page);
        try {
          await splitRight(page, terminal.id, notebook);

          // The DEF-TOOL-4 repro: the API tints the terminal, and the
          // notebook's strip in the other panel stays uncoloured
          await colourByApi(page, terminal.id, 'sky');
          await expectStripColoured(page, terminal.id, 'sky');
          await expect
            .poll(async () => (await strip(page, notebook)).toolbarClass)
            .toBeNull();

          // Both coloured, by the two colour paths: neither strip takes the
          // other panel's colour
          await colourByMenu(page, notebook, 'Red');
          await expectStripColoured(page, notebook, 'rose');
          await expectStripColoured(page, terminal.id, 'sky');
        } finally {
          await page.request.delete(`/api/terminals/${terminal.name}`);
        }
      });
    });
  });
}
