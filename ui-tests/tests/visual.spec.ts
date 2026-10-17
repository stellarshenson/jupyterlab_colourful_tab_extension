import * as fs from 'fs';
import * as path from 'path';

import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

import { contrastRatio, relativeLuminance } from '../../src/contrast';

/**
 * How coloured dock tabs look as the selection and the theme move
 * (ACC-ACTIVE-14 to ACC-ACTIVE-20). The current tab shows its colour's
 * `-active` shade and every other coloured tab its base shade - darker on
 * selection in both themes, and more saturated as well in the light theme. An
 * uncoloured current tab keeps the theme's own background, a theme switch
 * re-resolves the shade under the current tab, and the label stays readable
 * on every shade.
 *
 * Asserted on computed colours against the palette the schema ships, so a rule
 * that stops matching or a variable that stops resolving shows as the wrong
 * colour on screen, not merely as a missing class.
 */

type Theme = 'light' | 'dark';

/**
 * The shipped palette: the schema default, which the settings registry hands
 * the plugin and which `dynamicStyle.spec.ts` pins to `style/base.css`.
 */
const PALETTE: Record<
  Theme,
  Record<string, { inactive: string; active: string }>
> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../schema/plugin.json'), 'utf8')
).properties.palette.default;

const COLOUR_IDS = Object.keys(PALETTE.light);

/** WCAG AA minimum contrast for normal-size text. */
const TEXT_CONTRAST_MIN = 4.5;

/** One tab as the browser renders it, colours as `#rrggbb`. */
interface ITabLook {
  current: boolean;
  colourClass: string | null;
  tabBg: string;
  labelBg: string;
  /** The label text colour blended over the label background. */
  labelFg: string;
}

/** `rgb(...)` / `rgba(...)` as numbers; alpha 1 when absent. */
function channels(css: string): number[] {
  const parts = (css.match(/[\d.]+/g) ?? []).map(Number);
  return parts.length === 3 ? [...parts, 1] : parts;
}

/** `#rrggbb` of `rgb` channels. */
function hex(rgb: number[]): string {
  return (
    '#' +
    rgb
      .slice(0, 3)
      .map(c => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** HSL saturation of a `#rrggbb` colour. */
function saturation(colour: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16));
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
}

async function look(
  page: IJupyterLabPageFixture,
  widgetId: string
): Promise<ITabLook> {
  const raw = await page.evaluate(id => {
    const tab = document.querySelector(
      `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(id)}"]`
    ) as Element;
    const label = tab.querySelector('.lm-TabBar-tabLabel') as Element;
    return {
      current: tab.classList.contains('lm-mod-current'),
      colourClass:
        Array.from(tab.classList)
          .find(c =>
            /^jp-colourful-tab-(rose|peach|lemon|mint|sky|lavender)$/.test(c)
          )
          ?.replace('jp-colourful-tab-', '') ?? null,
      tabBg: getComputedStyle(tab).backgroundColor,
      labelBg: getComputedStyle(label).backgroundColor,
      labelFg: getComputedStyle(label).color
    };
  }, widgetId);
  const bg = channels(raw.labelBg);
  const fg = channels(raw.labelFg);
  const alpha = fg[3];
  return {
    current: raw.current,
    colourClass: raw.colourClass,
    tabBg: hex(channels(raw.tabBg)),
    labelBg: hex(bg),
    labelFg: hex(fg.slice(0, 3).map((c, i) => alpha * c + (1 - alpha) * bg[i]))
  };
}

/** A colour variable resolved to `#rrggbb` in the current theme. */
async function resolveVar(
  page: IJupyterLabPageFixture,
  variable: string
): Promise<string> {
  const value = await page.evaluate(name => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${name})`;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return computed;
  }, variable);
  return hex(channels(value));
}

function tab(page: IJupyterLabPageFixture, widgetId: string) {
  return page.locator(
    `#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`
  );
}

/** Open a new text file and return its widget id. */
async function openFile(
  page: IJupyterLabPageFixture,
  filePath: string
): Promise<string> {
  await page.contents.uploadContent(filePath, 'text', filePath);
  const id = await page.evaluate(
    async p =>
      (
        await (window as any).jupyterapp.commands.execute('docmanager:open', {
          path: p
        })
      ).id as string,
    filePath
  );
  await tab(page, id).waitFor();
  return id;
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
      const widget = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ).find((w: any) => w.id === id);
      api.setColour(widget, colour);
    },
    [widgetId, colourId]
  );
}

/** Wait until the tab's selection, colour class and computed fill match. */
async function expectTab(
  page: IJupyterLabPageFixture,
  widgetId: string,
  expected: { current: boolean; colourClass: string | null; tabBg: string }
): Promise<void> {
  await expect
    .poll(async () => {
      const { current, colourClass, tabBg } = await look(page, widgetId);
      return { current, colourClass, tabBg };
    })
    .toEqual(expected);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`coloured tabs, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      if (theme === 'dark') {
        await page.theme.setDarkTheme();
      } else {
        await page.theme.setLightTheme();
      }
    });

    // ACC-ACTIVE-14, ACC-ACTIVE-15 (dark), ACC-ACTIVE-16 (light), ACC-ACTIVE-18
    test('the -active shade follows the selection between same-coloured tabs', async ({
      page,
      tmpPath
    }) => {
      const a = await openFile(page, `${tmpPath}/a.txt`);
      const b = await openFile(page, `${tmpPath}/b.txt`);
      for (const id of COLOUR_IDS) {
        const { inactive, active } = PALETTE[theme][id];
        await colourByApi(page, a, id);
        await colourByApi(page, b, id);

        await tab(page, a).click();
        await expectTab(page, a, {
          current: true,
          colourClass: id,
          tabBg: active
        });
        await expectTab(page, b, {
          current: false,
          colourClass: id,
          tabBg: inactive
        });
        // Hovering an inactive coloured tab does not swap in the theme's hover fill
        await tab(page, b).hover();
        await expectTab(page, b, {
          current: false,
          colourClass: id,
          tabBg: inactive
        });

        // The selected tab is darker than its sibling in both themes; in the
        // light theme it is also more saturated (muted palette, 1.1.21)
        const selected = (await look(page, a)).tabBg;
        const sibling = (await look(page, b)).tabBg;
        expect(relativeLuminance(selected)).toBeLessThan(
          relativeLuminance(sibling)
        );
        if (theme === 'light') {
          expect(saturation(selected)).toBeGreaterThan(saturation(sibling));
        }

        // Selecting the sibling moves the shade and restores the first tab
        await tab(page, b).click();
        await expectTab(page, b, {
          current: true,
          colourClass: id,
          tabBg: active
        });
        await expectTab(page, a, {
          current: false,
          colourClass: id,
          tabBg: inactive
        });
      }
    });

    // ACC-ACTIVE-17
    test('the label reaches WCAG AA contrast on every shade', async ({
      page,
      tmpPath
    }) => {
      const a = await openFile(page, `${tmpPath}/a.txt`);
      const b = await openFile(page, `${tmpPath}/b.txt`);
      await tab(page, a).click();
      for (const id of COLOUR_IDS) {
        const { inactive, active } = PALETTE[theme][id];
        await colourByApi(page, a, id);
        await colourByApi(page, b, id);
        await expectTab(page, a, {
          current: true,
          colourClass: id,
          tabBg: active
        });
        await expectTab(page, b, {
          current: false,
          colourClass: id,
          tabBg: inactive
        });
        for (const [widgetId, fill] of [
          [a, active],
          [b, inactive]
        ]) {
          const { labelBg, labelFg } = await look(page, widgetId);
          // The label sits on the shade itself, not on a transparent box
          expect(labelBg).toEqual(fill);
          expect(contrastRatio(labelFg, labelBg)).toBeGreaterThanOrEqual(
            TEXT_CONTRAST_MIN
          );
        }
      }
    });

    // ACC-ACTIVE-19
    test('an uncoloured selected tab keeps the theme background', async ({
      page,
      tmpPath
    }) => {
      const a = await openFile(page, `${tmpPath}/a.txt`);
      const b = await openFile(page, `${tmpPath}/b.txt`);
      // Coloured the way a user does: right-click, Tab Colour, Red
      await tab(page, a).click({ button: 'right' });
      await page
        .locator('.lm-Menu-itemLabel', { hasText: /^Tab Colour$/ })
        .click();
      await page.locator('.lm-Menu-itemLabel', { hasText: /^Red$/ }).click();
      await tab(page, a).click();
      await expectTab(page, a, {
        current: true,
        colourClass: 'rose',
        tabBg: PALETTE[theme].rose.active
      });

      // JupyterLab fills the current dock tab with --jp-layout-color1
      const themeBg = await resolveVar(page, '--jp-layout-color1');
      await tab(page, b).click();
      await expectTab(page, b, {
        current: true,
        colourClass: null,
        tabBg: themeBg
      });
      await expectTab(page, a, {
        current: false,
        colourClass: 'rose',
        tabBg: PALETTE[theme].rose.inactive
      });
    });
  });
}

// ACC-ACTIVE-20
test('the selected tab follows a theme switch', async ({ page, tmpPath }) => {
  await page.theme.setLightTheme();
  const a = await openFile(page, `${tmpPath}/a.txt`);
  const b = await openFile(page, `${tmpPath}/b.txt`);
  await tab(page, a).click();
  // Each colour is switched once, alternating direction, so both directions
  // are crossed and every colour is seen under both themes
  let theme: Theme = 'light';
  for (const id of COLOUR_IDS) {
    await colourByApi(page, a, id);
    await colourByApi(page, b, id);
    await expectTab(page, a, {
      current: true,
      colourClass: id,
      tabBg: PALETTE[theme][id].active
    });
    theme = theme === 'light' ? 'dark' : 'light';
    if (theme === 'dark') {
      await page.theme.setDarkTheme();
    } else {
      await page.theme.setLightTheme();
    }
    await expectTab(page, a, {
      current: true,
      colourClass: id,
      tabBg: PALETTE[theme][id].active
    });
    await expectTab(page, b, {
      current: false,
      colourClass: id,
      tabBg: PALETTE[theme][id].inactive
    });
  }
});
