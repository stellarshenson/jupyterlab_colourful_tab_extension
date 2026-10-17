import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The selected-tab accent bar through the public `setColour` API
 * (DEF-ACTIVE-1, ACC-ACTIVE-8). The shell marks the current main-area widget by
 * appending `jp-mod-current` to its `title.className`, and `tabs.css` draws the
 * accent as that tab's `::before`. The API tints through the same property, so
 * a tint, a burst of consumer re-tints and a clear must each leave the accent
 * drawn on the current tab - and only there once another tab is selected.
 *
 * Asserted on the computed `::before`, not on the class alone, because the bar
 * is what the user loses: the defect was reported as the bar vanishing.
 */

/** The accent state of one tab, as the browser computes it. */
interface IAccent {
  /** The shell's accent token is on the widget's title. */
  titleCurrent: boolean;
  /** The rendered tab carries the accent class. */
  tabCurrent: boolean;
  /** The colour class on the rendered tab, or null. */
  colourClass: string | null;
  /** Computed `::before` content - `none` when no bar is generated. */
  barContent: string;
  barBg: string;
}

async function accent(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<IAccent> {
  return page.evaluate(id => {
    const widget: any = Array.from(
      (window as any).jupyterapp.shell.widgets('main')
    ).find((w: any) => w.id === id);
    const tab = document.querySelector(
      `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
    ) as Element;
    const bar = getComputedStyle(tab, '::before');
    return {
      titleCurrent: (widget.title.className as string)
        .split(/\s+/)
        .includes('jp-mod-current'),
      tabCurrent: tab.classList.contains('jp-mod-current'),
      colourClass:
        Array.from(tab.classList).find(c =>
          /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
        ) ?? null,
      barContent: bar.content,
      barBg: bar.backgroundColor
    };
  }, widgetId);
}

/** How many main-area tabs draw the accent bar. */
async function accentCount(page: IJupyterLabPageFixture): Promise<number> {
  return page.evaluate(
    () =>
      Array.from(
        document.querySelectorAll('#jp-main-dock-panel .lm-TabBar-tab')
      ).filter(tab => getComputedStyle(tab, '::before').content !== 'none')
        .length
  );
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

/** Open a new notebook through `docmanager:open` and return its widget id. */
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

async function activate(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<void> {
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`)
    .click();
}

/**
 * Call `IColourfulTabs.setColour` the way a consumer extension does, `times`
 * times in a row - a consumer re-tints on every title or status update.
 */
async function colourByApi(
  page: IJupyterLabPageFixture,
  widgetId: string,
  colourId: string | null,
  times = 1
): Promise<void> {
  await page.evaluate(
    async ([id, colour, n]) => {
      const api = await (window as any).galata.getPlugin(
        'jupyterlab_colourful_tab_extension:plugin'
      );
      const widget = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ).find((w: any) => w.id === id);
      for (let i = 0; i < (n as number); i++) {
        api.setColour(widget, colour);
      }
    },
    [widgetId, colourId, times] as const
  );
}

test('accent bar survives setColour tint, re-tints and clear', async ({
  page,
  tmpPath
}) => {
  // DEF-ACTIVE-1, ACC-ACTIVE-8
  const first = await openNotebook(page, `${tmpPath}/first.ipynb`);
  const second = await openNotebook(page, `${tmpPath}/second.ipynb`);
  const brand = await shade(page, '--jp-brand-color1');
  const drawn = (colourClass: string | null): IAccent => ({
    titleCurrent: true,
    tabCurrent: true,
    colourClass,
    barContent: '""',
    barBg: brand
  });

  await activate(page, first);
  await expect.poll(() => accent(page, first)).toEqual(drawn(null));

  await colourByApi(page, first, 'sky');
  await expect
    .poll(() => accent(page, first))
    .toEqual(drawn('jp-colourful-tab-sky'));

  await colourByApi(page, first, 'rose', 10);
  await expect
    .poll(() => accent(page, first))
    .toEqual(drawn('jp-colourful-tab-rose'));

  await colourByApi(page, first, null);
  await expect.poll(() => accent(page, first)).toEqual(drawn(null));

  // The accent moves with the selection after re-tints: the tinted tab gives
  // it up when another is selected, so the dock draws exactly one bar
  await colourByApi(page, first, 'mint', 5);
  await activate(page, second);
  await expect.poll(() => accent(page, second)).toEqual(drawn(null));
  await expect
    .poll(() => accent(page, first))
    .toEqual({
      titleCurrent: false,
      tabCurrent: false,
      colourClass: 'jp-colourful-tab-mint',
      barContent: 'none',
      barBg: 'rgba(0, 0, 0, 0)'
    });
  expect(await accentCount(page)).toBe(1);

  await activate(page, first);
  await expect
    .poll(() => accent(page, first))
    .toEqual(drawn('jp-colourful-tab-mint'));
  expect(await accentCount(page)).toBe(1);
});
