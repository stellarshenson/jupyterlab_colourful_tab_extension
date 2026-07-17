// Dynamic style generation for the user-editable palette. Kept free of
// JupyterLab imports so it is directly executable under jest. style/base.css
// stays untouched as the no-settings fallback; the CSS built here redefines
// the same variables from an injected <style> appended to <head>, which wins
// the cascade at equal specificity.

import { COLOURS } from './colours';
import { dividerGrey } from './contrast';

/** Inactive and active hex shades of one colour in one theme. */
export interface IPaletteEntry {
  inactive: string;
  active: string;
}

/** Shades per colour id for a single theme. */
export type ThemePalette = { [colourId: string]: IPaletteEntry };

/** The full palette: shades for both themes. */
export interface IPalette {
  light: ThemePalette;
  dark: ThemePalette;
}

/**
 * Colour ids in menu order; the CSS class per colour is jp-colourful-tab-<id>.
 * Derived from COLOURS (the source of the classes actually applied to tabs)
 * so a colour added or renamed there cannot drift out of the dynamic CSS.
 */
const COLOUR_IDS = COLOURS.map(c => c.id);

/** A user-supplied colour is accepted only as a 6-digit hex string. */
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** The id of the injected <style> element. */
const STYLE_ID = 'jp-colourful-tab-dynamic-style';

/**
 * The canonical palette. Must stay identical to the variable values in
 * style/base.css and the settings schema defaults - the anti-drift test in
 * src/__tests__/dynamicStyle.spec.ts pins all three copies together.
 */
export const DEFAULT_PALETTE: IPalette = {
  light: {
    rose: { inactive: '#ffd6e0', active: '#ff9db5' },
    peach: { inactive: '#ffe5cc', active: '#ffbe80' },
    lemon: { inactive: '#fff9c4', active: '#fff176' },
    mint: { inactive: '#c8f7c5', active: '#8ff08a' },
    sky: { inactive: '#a8d4f0', active: '#6ec1f5' },
    lavender: { inactive: '#e5d6f7', active: '#c39bf5' }
  },
  dark: {
    rose: { inactive: '#4e3138', active: '#3a2328' },
    peach: { inactive: '#4e4032', active: '#3a3126' },
    lemon: { inactive: '#4e4b32', active: '#3a3825' },
    mint: { inactive: '#324e37', active: '#253b2a' },
    sky: { inactive: '#28394d', active: '#1d2a38' },
    lavender: { inactive: '#40324e', active: '#30253a' }
  }
};

/** The value as a plain object, or null if it is not one. */
function asRecord(value: unknown): { [key: string]: unknown } | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { [key: string]: unknown })
    : null;
}

/** The value if it is a valid hex colour string, otherwise the fallback. */
function hexOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_PATTERN.test(value)
    ? value
    : fallback;
}

/**
 * Deep-merge user settings data over DEFAULT_PALETTE, field by field.
 *
 * A user value replaces the default only when it is a 6-digit hex string;
 * anything else (missing, malformed, wrong type) leaves that field's default
 * in place. Unknown colour keys are ignored. Never throws, whatever shape the
 * settings hand over.
 *
 * @param user - the raw palette value from the setting registry
 */
export function mergePalette(user: unknown): IPalette {
  const userPalette = asRecord(user);
  const merged: IPalette = { light: {}, dark: {} };
  for (const theme of ['light', 'dark'] as const) {
    const userTheme = asRecord(userPalette ? userPalette[theme] : null);
    for (const id of COLOUR_IDS) {
      const fallback = DEFAULT_PALETTE[theme][id];
      const entry = asRecord(userTheme ? userTheme[id] : null);
      merged[theme][id] = {
        inactive: hexOr(entry ? entry.inactive : null, fallback.inactive),
        active: hexOr(entry ? entry.active : null, fallback.active)
      };
    }
  }
  return merged;
}

/** The 12 variable declarations for one theme's palette. */
function variableBlock(selector: string, palette: ThemePalette): string {
  const lines = [`${selector} {`];
  for (const id of COLOUR_IDS) {
    lines.push(`  --jp-colourful-tab-${id}: ${palette[id].inactive};`);
    lines.push(`  --jp-colourful-tab-${id}-active: ${palette[id].active};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * The two divider rules for one colour's same-colour adjacency.
 *
 * The seam between adjacent tabs is normally the previous tab's border-right,
 * but when the next tab is .lm-mod-current its border-left wins - so both
 * sides get the grey to cover every adjacency case. Only the colour is
 * overridden; the theme keeps the border width and style.
 */
function dividerRules(id: string, grey: string, prefix: string): string {
  const tab = `.lm-TabBar-tab.jp-colourful-tab-${id}`;
  return [
    `${prefix}${tab}:has(+ ${tab}) { border-right-color: ${grey} !important; }`,
    `${prefix}${tab} + ${tab} { border-left-color: ${grey} !important; }`
  ].join('\n');
}

/**
 * The CSS for the injected style element: variable redefinitions for both
 * themes and, when enabled, the same-colour divider rules.
 *
 * The divider grey is computed from the palette at runtime (never hardcoded)
 * so user palette edits keep their contrast: darker than the tab colour in the
 * light theme, brighter in the dark theme, targeting 4.0:1 against both the
 * inactive and active shades since either neighbour can be the current tab.
 *
 * @param palette - the merged palette to emit
 * @param dynamicDivider - whether to emit the divider rules
 */
export function buildDynamicCss(
  palette: IPalette,
  dynamicDivider: boolean
): string {
  const darkSelector = "[data-jp-theme-light='false']";
  const blocks = [
    variableBlock(':root', palette.light),
    variableBlock(darkSelector, palette.dark)
  ];
  if (dynamicDivider) {
    for (const id of COLOUR_IDS) {
      const light = palette.light[id];
      const dark = palette.dark[id];
      blocks.push(
        dividerRules(
          id,
          dividerGrey([light.inactive, light.active], 'darker'),
          ''
        ),
        dividerRules(
          id,
          dividerGrey([dark.inactive, dark.active], 'brighter'),
          `${darkSelector} `
        )
      );
    }
  }
  return blocks.join('\n') + '\n';
}

/**
 * Upsert the injected <style id="jp-colourful-tab-dynamic-style"> element in
 * <head> and set its content. No-op outside a browser (node-env jest).
 *
 * @param css - the stylesheet content, as built by buildDynamicCss
 */
export function applyDynamicStyle(css: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}
