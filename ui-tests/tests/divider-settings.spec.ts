import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The same-colour divider and the settings behind it. Two adjacent INACTIVE
 * tabs of one colour get a computed grey seam - darker than the tab in the
 * light theme, brighter in the dark theme - while any pair involving the
 * current tab keeps the theme's own seam (DEF-DIVIDE-7). `dynamicDivider`,
 * `dividerContrast` and `palette` take effect as soon as the setting registry
 * saves them, without a reload.
 *
 * The theme's own seam is measured with `dynamicDivider` off rather than
 * hardcoded, so the comparison holds under any theme. Settings are written
 * through the setting registry, the channel the Settings Editor saves through;
 * Galata keeps them in memory per test.
 */

const PLUGIN = 'jupyterlab_colourful_tab_extension:plugin';

/** The two borders that meet at the seam between two tabs, and the tab colour. */
interface ISeam {
  adjacent: boolean;
  left: string;
  right: string;
  tabBg: string;
}

async function seam(
  page: IJupyterLabPageFixture,
  leftId: string,
  rightId: string
): Promise<ISeam> {
  return page.evaluate(
    ([l, r]) => {
      const tab = (id: string): Element | null =>
        document.querySelector(
          `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
        );
      const left = tab(l);
      const right = tab(r);
      return {
        adjacent: !!left && left.nextElementSibling === right,
        left: left ? getComputedStyle(left).borderRightColor : 'missing',
        right: right ? getComputedStyle(right).borderLeftColor : 'missing',
        tabBg: left ? getComputedStyle(left).backgroundColor : 'missing'
      };
    },
    [leftId, rightId]
  );
}

/** `rgb(r, g, b)` as computed by the browser, to its three channels. */
function channels(rgb: string): number[] {
  const match = rgb.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray).slice(1).map(Number);
}

/** `#rrggbb` as the browser computes it, `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(o => parseInt(hex.slice(o, o + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** WCAG 2.x relative luminance of a computed `rgb(...)` colour. */
function luminance(rgb: string): number {
  const [r, g, b] = channels(rgb).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two computed `rgb(...)` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A neutral grey: all three channels equal. */
function isGrey(rgb: string): boolean {
  const [r, g, b] = channels(rgb);
  return r === g && g === b;
}

/** Write one setting the way the Settings Editor does, through the registry. */
async function setSetting(
  page: IJupyterLabPageFixture,
  key: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    async ([plugin, k, v]) => {
      const registry = await (window as any).galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      await registry.set(plugin, k, v);
    },
    [PLUGIN, key, value] as [string, string, unknown]
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

/** Open a new notebook through the contents API and return its widget id. */
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

/** Colour a tab the way a consumer extension does: `IColourfulTabs.setColour`. */
async function colourByApi(
  page: IJupyterLabPageFixture,
  widgetId: string,
  colourId: string
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

/**
 * Three notebooks in one tab bar, the first two rose and the third uncoloured
 * and current, so the first two form an INACTIVE same-coloured pair.
 */
async function rosePair(
  page: IJupyterLabPageFixture,
  tmpPath: string
): Promise<{ first: string; second: string; other: string }> {
  const first = await openNotebook(page, `${tmpPath}/first.ipynb`);
  const second = await openNotebook(page, `${tmpPath}/second.ipynb`);
  const other = await openNotebook(page, `${tmpPath}/other.ipynb`);
  await colourByApi(page, first, 'rose');
  await colourByApi(page, second, 'rose');
  await activate(page, other);
  expect((await seam(page, first, second)).adjacent).toBe(true);
  return { first, second, other };
}

/** The muted light palette (v1.1.21) and the dark palette, rose pair. */
const ROSE = {
  light: { inactive: '#e8bbc6', active: '#e39fb1' },
  dark: { inactive: '#4e3138', active: '#3a2328' }
};

for (const theme of ['light', 'dark'] as const) {
  // The grey sits on the far side of the tab colour from the theme background
  const towardTheme = (grey: string, tabBg: string): boolean =>
    theme === 'light'
      ? luminance(grey) < luminance(tabBg)
      : luminance(grey) > luminance(tabBg);

  test.describe(`same-colour divider, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      if (theme === 'dark') {
        await page.theme.setDarkTheme();
      } else {
        await page.theme.setLightTheme();
      }
    });

    // DEF-DIVIDE-7; criteria "Divider between inactive same-coloured tabs",
    // "Divider direction per theme" and "dynamicDivider toggle applies live"
    // (ACC-DIVIDE-46, ACC-DIVIDE-47, ACC-DIVIDE-48)
    test('grey seam only between two inactive same-coloured tabs', async ({
      page,
      tmpPath
    }) => {
      const { first, second, other } = await rosePair(page, tmpPath);

      // The theme's own seams, with the divider switched off live
      await setSetting(page, 'dynamicDivider', false);
      const plain = await seam(page, first, second);
      await activate(page, second);
      const plainSecondCurrent = await seam(page, first, second);
      await activate(page, first);
      const plainFirstCurrent = await seam(page, first, second);

      // Back on, live: the inactive pair's seam turns a contrastive grey on
      // both sides, at least the default medium 3:1 against the tab colour
      await setSetting(page, 'dynamicDivider', true);
      await activate(page, other);
      const divided = await seam(page, first, second);
      expect(divided.right).toEqual(divided.left);
      expect(divided.left).not.toEqual(plain.left);
      expect(isGrey(divided.left)).toBe(true);
      expect(contrast(divided.left, divided.tabBg)).toBeGreaterThanOrEqual(3);
      expect(towardTheme(divided.left, divided.tabBg)).toBe(true);

      // Either tab current: the active shade already sets it apart, so the
      // pair keeps the theme's seam (DEF-DIVIDE-7)
      await activate(page, second);
      await expect
        .poll(() => seam(page, first, second))
        .toEqual(plainSecondCurrent);
      await activate(page, first);
      await expect
        .poll(() => seam(page, first, second))
        .toEqual(plainFirstCurrent);
    });

    // Criteria "Divider contrast ladder", "Palette editor applies live" and
    // "Muted light palette" (ACC-DIVIDE-49, ACC-DIVIDE-50, ACC-DIVIDE-53)
    test('contrast and palette settings apply live', async ({
      page,
      tmpPath
    }) => {
      const { first, second, other } = await rosePair(page, tmpPath);

      // The shipped palette as rendered: inactive and active rose shades
      expect((await seam(page, first, second)).tabBg).toEqual(
        hexToRgb(ROSE[theme].inactive)
      );
      await activate(page, first);
      expect((await seam(page, first, second)).tabBg).toEqual(
        hexToRgb(ROSE[theme].active)
      );
      await activate(page, other);

      // low 2:1, medium 3:1, high 4:1 - each a strictly stronger grey
      const ratios: number[] = [];
      for (const [magnitude, target] of [
        ['low', 2],
        ['medium', 3],
        ['high', 4]
      ] as const) {
        await setSetting(page, 'dividerContrast', magnitude);
        const divided = await seam(page, first, second);
        const ratio = contrast(divided.left, divided.tabBg);
        expect(ratio).toBeGreaterThanOrEqual(target);
        expect(towardTheme(divided.left, divided.tabBg)).toBe(true);
        ratios.push(ratio);
      }
      expect(ratios[1]).toBeGreaterThan(ratios[0]);
      expect(ratios[2]).toBeGreaterThan(ratios[1]);

      // A palette edit repaints the tabs and recomputes the grey: the grey
      // computed for the default rose would fall under 3:1 on the new shade
      await setSetting(page, 'dividerContrast', 'medium');
      const before = await seam(page, first, second);
      const edited = theme === 'light' ? '#b4a0c8' : '#604050';
      await setSetting(page, 'palette', {
        [theme]: { rose: { inactive: edited } }
      });
      const after = await seam(page, first, second);
      expect(after.tabBg).toEqual(hexToRgb(edited));
      expect(contrast(before.left, after.tabBg)).toBeLessThan(3);
      expect(after.right).toEqual(after.left);
      expect(isGrey(after.left)).toBe(true);
      expect(contrast(after.left, after.tabBg)).toBeGreaterThanOrEqual(3);
      expect(towardTheme(after.left, after.tabBg)).toBe(true);
    });
  });
}
