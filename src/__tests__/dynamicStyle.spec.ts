// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

import Ajv from 'ajv';

import { relativeLuminance } from '../contrast';
import {
  applyDynamicStyle,
  buildDynamicCss,
  DEFAULT_PALETTE,
  IPalette,
  mergePalette
} from '../dynamicStyle';

const COLOUR_IDS = ['rose', 'peach', 'lemon', 'mint', 'sky', 'lavender'];
const DARK_SELECTOR = "[data-jp-theme-light='false']";

/** The declarations inside a variable block, matched by its selector. */
function variableBlock(css: string, selector: string): string {
  // require ' {' right after the selector so divider-rule prefixes don't match
  const match = css.match(
    new RegExp(selector.replace(/[[\]']/g, '\\$&') + ' \\{([\\s\\S]*?)\\}')
  );
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[1];
}

/** The divider grey for a colour from its border-right rule, per theme. */
function dividerGreyFor(css: string, id: string, dark: boolean): string {
  const tab = `\\.lm-TabBar-tab\\.jp-colourful-tab-${id}`;
  const prefix = dark ? DARK_SELECTOR.replace(/[[\]']/g, '\\$&') + ' ' : '';
  const match = css.match(
    new RegExp(
      `^${prefix}${tab}:has\\(\\+ ${tab}\\) \\{ border-right-color: (#[0-9a-fA-F]{6})`,
      'm'
    )
  );
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[1];
}

describe('buildDynamicCss', () => {
  const css = buildDynamicCss(DEFAULT_PALETTE, true);

  it('redefines all 12 variables per theme, dark scoped to the theme attribute', () => {
    const light = variableBlock(css, ':root');
    const dark = variableBlock(css, DARK_SELECTOR);
    expect(light.match(/--jp-colourful-tab-/g)).toHaveLength(12);
    expect(dark.match(/--jp-colourful-tab-/g)).toHaveLength(12);
    for (const id of COLOUR_IDS) {
      const entry = DEFAULT_PALETTE.light[id];
      expect(light).toContain(`--jp-colourful-tab-${id}: ${entry.inactive};`);
      expect(light).toContain(
        `--jp-colourful-tab-${id}-active: ${entry.active};`
      );
      const darkEntry = DEFAULT_PALETTE.dark[id];
      expect(dark).toContain(
        `--jp-colourful-tab-${id}: ${darkEntry.inactive};`
      );
      expect(dark).toContain(
        `--jp-colourful-tab-${id}-active: ${darkEntry.active};`
      );
    }
  });

  it('emits both seam rules per colour in both themes', () => {
    // both sides: the previous tab's border-right normally renders the seam,
    // but a current next tab's border-left wins - each rule covers one case
    const tab = '.lm-TabBar-tab.jp-colourful-tab-rose';
    const grey = dividerGreyFor(css, 'rose', false);
    const darkGrey = dividerGreyFor(css, 'rose', true);
    expect(css).toContain(
      `${tab}:has(+ ${tab}) { border-right-color: ${grey} !important; }`
    );
    expect(css).toContain(
      `\n${tab} + ${tab} { border-left-color: ${grey} !important; }`
    );
    expect(css).toContain(
      `${DARK_SELECTOR} ${tab}:has(+ ${tab}) { border-right-color: ${darkGrey} !important; }`
    );
    expect(css).toContain(
      `${DARK_SELECTOR} ${tab} + ${tab} { border-left-color: ${darkGrey} !important; }`
    );
  });

  it('omits divider rules when dynamicDivider is off, keeping the variables', () => {
    const plain = buildDynamicCss(DEFAULT_PALETTE, false);
    expect(plain).not.toContain('border-right-color');
    expect(plain).not.toContain('border-left-color');
    expect(plain.match(/--jp-colourful-tab-/g)).toHaveLength(24);
  });

  it('greys the seam darker than the tab in light theme, brighter in dark', () => {
    for (const id of COLOUR_IDS) {
      const lightGrey = dividerGreyFor(css, id, false);
      const darkGrey = dividerGreyFor(css, id, true);
      expect(relativeLuminance(lightGrey)).toBeLessThan(
        relativeLuminance(DEFAULT_PALETTE.light[id].inactive)
      );
      expect(relativeLuminance(darkGrey)).toBeGreaterThan(
        relativeLuminance(DEFAULT_PALETTE.dark[id].inactive)
      );
    }
  });
});

describe('mergePalette', () => {
  it('returns the defaults for undefined input', () => {
    expect(mergePalette(undefined)).toEqual(DEFAULT_PALETTE);
  });

  it('applies a partial valid override to exactly that field', () => {
    const merged = mergePalette({ light: { rose: { inactive: '#123456' } } });
    expect(merged.light.rose.inactive).toEqual('#123456');
    expect(merged.light.rose.active).toEqual(DEFAULT_PALETTE.light.rose.active);
    const untouched: IPalette = {
      light: { ...merged.light, rose: DEFAULT_PALETTE.light.rose },
      dark: merged.dark
    };
    expect(untouched).toEqual(DEFAULT_PALETTE);
  });

  it('rejects invalid values field-wise and ignores unknown colour keys', () => {
    const merged = mergePalette({
      light: {
        rose: { inactive: 'red', active: '#12345' },
        peach: { inactive: 42, active: null },
        crimson: { inactive: '#123456', active: '#123456' }
      }
    });
    expect(merged).toEqual(DEFAULT_PALETTE);
  });

  it('never throws on malformed input', () => {
    expect(mergePalette(null)).toEqual(DEFAULT_PALETTE);
    expect(mergePalette([])).toEqual(DEFAULT_PALETTE);
    expect(mergePalette('x')).toEqual(DEFAULT_PALETTE);
    expect(mergePalette(42)).toEqual(DEFAULT_PALETTE);
    expect(mergePalette({ light: 7, dark: [] })).toEqual(DEFAULT_PALETTE);
  });
});

describe('applyDynamicStyle', () => {
  it('upserts a single style element appended to head', () => {
    applyDynamicStyle(':root { --a: 1; }');
    const style = document.getElementById('jp-colourful-tab-dynamic-style');
    expect(style).not.toBeNull();
    expect(style?.parentElement).toBe(document.head);
    expect(style?.textContent).toEqual(':root { --a: 1; }');
    applyDynamicStyle(':root { --a: 2; }');
    expect(
      document.querySelectorAll('#jp-colourful-tab-dynamic-style')
    ).toHaveLength(1);
    expect(style?.textContent).toEqual(':root { --a: 2; }');
  });
});

// Anti-drift: the canonical palette lives in three places - the schema
// defaults, DEFAULT_PALETTE, and the style/base.css fallback variables -
// and the colour ids are enumerated a fourth time in the schema's own
// definitions (themePalette, additionalProperties: false). These tests pin
// all copies together.
describe('default palette copies', () => {
  const schema = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../schema/plugin.json'), 'utf8')
  );

  it('schema/plugin.json palette default equals DEFAULT_PALETTE', () => {
    expect(schema.properties.palette.default).toEqual(DEFAULT_PALETTE);
  });

  it('schema defaults compose cleanly under the registry validator', () => {
    // mirror the setting registry's composer (ajv with useDefaults, strict
    // off): composing even empty user settings fills in the schema defaults
    // and validates them against the schema's own definitions. A colour id
    // drifting in definitions.themePalette alone would fail here with an
    // additionalProperties error - the same failure that would otherwise
    // reject settingRegistry.load() and silently disable the whole feature.
    const composer = new Ajv({ useDefaults: true, strict: false });
    const validate = composer.compile(schema);
    const composite: Record<string, unknown> = {};
    expect(validate(composite)).toBe(true);
    expect(validate.errors).toBeNull();
    expect(composite.palette).toEqual(DEFAULT_PALETTE);
    expect(composite.dynamicDivider).toBe(true);
  });

  it('tolerates unknown top-level user keys but rejects malformed palettes', () => {
    // the registry validates raw user data against this schema before
    // composing - a root additionalProperties: false would reject the whole
    // file (discarding a valid palette) over any stray key, e.g. one written
    // by a newer extension version before a downgrade
    const composer = new Ajv({ useDefaults: true, strict: false });
    const validate = composer.compile(schema);
    expect(
      validate({
        futureSetting: true,
        palette: { light: { rose: { inactive: '#123456' } } }
      })
    ).toBe(true);
    expect(
      validate({ palette: { light: { crimson: { inactive: '#123456' } } } })
    ).toBe(false);
  });

  it('style/base.css variables equal DEFAULT_PALETTE', () => {
    const baseCss = fs.readFileSync(
      path.resolve(__dirname, '../../style/base.css'),
      'utf8'
    );
    const sections = baseCss.split(DARK_SELECTOR);
    expect(sections).toHaveLength(2);
    const themes: Array<['light' | 'dark', string]> = [
      ['light', sections[0]],
      ['dark', sections[1]]
    ];
    for (const [theme, section] of themes) {
      const pattern =
        /--jp-colourful-tab-([a-z]+)(-active)?:\s*(#[0-9a-fA-F]{6})/g;
      const declarations: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(section)) !== null) {
        declarations.push(match);
      }
      expect(declarations).toHaveLength(12);
      for (const [, id, active, hex] of declarations) {
        const field = active ? 'active' : 'inactive';
        expect(`${theme}.${id}.${field}: ${hex.toLowerCase()}`).toEqual(
          `${theme}.${id}.${field}: ${DEFAULT_PALETTE[theme][id][field]}`
        );
      }
    }
  });
});
