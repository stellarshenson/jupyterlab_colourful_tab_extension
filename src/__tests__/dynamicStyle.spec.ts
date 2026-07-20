// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

import Ajv from 'ajv';

import { contrastRatio, relativeLuminance } from '../contrast';
import {
  applyDynamicStyle,
  asDividerContrast,
  buildDynamicCss,
  CONTRAST_TARGETS,
  DEFAULT_PALETTE,
  DividerContrast,
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
  const tab = `\\.lm-TabBar-tab\\.jp-colourful-tab-${id}:not\\(\\.lm-mod-current\\)`;
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

  it('emits both seam rules per colour in both themes, inactive tabs only', () => {
    // between two inactive tabs the previous tab's border-right renders the
    // seam, but both sides get the grey so the outcome does not hinge on
    // paint order; the active tab is excluded on both sides (DEF-7) - its
    // distinct -active shade already sets it apart
    const tab = '.lm-TabBar-tab.jp-colourful-tab-rose:not(.lm-mod-current)';
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

  it('never recolours a seam that touches the active tab (DEF-7)', () => {
    // every divider selector must guard BOTH neighbours - a border rule whose
    // selector lacks the :not(.lm-mod-current) guard on either side would put
    // the grey against the active tab
    const borderRules = css
      .split('\n')
      .filter(line => line.includes('border-'));
    expect(borderRules.length).toBeGreaterThan(0);
    for (const rule of borderRules) {
      const selector = rule.slice(0, rule.indexOf('{'));
      const tabs = selector.match(/\.lm-TabBar-tab/g) ?? [];
      const guards = selector.match(/:not\(\.lm-mod-current\)/g) ?? [];
      expect(guards.length).toEqual(tabs.length);
      expect(tabs.length).toEqual(2);
    }
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

describe('divider contrast magnitudes', () => {
  const magnitudes = Object.keys(CONTRAST_TARGETS) as DividerContrast[];

  it('pins the target values - the deliberately subtle post-1.1.14 ladder', () => {
    // the magnitude tests below read CONTRAST_TARGETS themselves, so without
    // this pin a retuned value would pass the whole suite while shifting
    // every user's default visuals. The ladder was retuned one notch subtler
    // by user decision after live use: high carries the original 4.0
    expect(CONTRAST_TARGETS).toEqual({ low: 2.0, medium: 3.0, high: 4.0 });
  });

  it('defaults to medium', () => {
    expect(buildDynamicCss(DEFAULT_PALETTE, true)).toEqual(
      buildDynamicCss(DEFAULT_PALETTE, true, 'medium')
    );
  });

  it('meets each magnitude target against the inactive shade in both themes', () => {
    // the inactive shade is the only one a divider can touch: pairs
    // involving the active tab keep the theme's default seam (DEF-7)
    for (const magnitude of magnitudes) {
      const css = buildDynamicCss(DEFAULT_PALETTE, true, magnitude);
      const target = CONTRAST_TARGETS[magnitude];
      for (const id of COLOUR_IDS) {
        for (const dark of [false, true]) {
          const grey = dividerGreyFor(css, id, dark);
          const entry = DEFAULT_PALETTE[dark ? 'dark' : 'light'][id];
          expect(contrastRatio(grey, entry.inactive)).toBeGreaterThanOrEqual(
            target
          );
        }
      }
    }
  });

  it('steps the grey strictly further from the tabs as the magnitude rises', () => {
    // strict on every ADJACENT pair for every colour: an equal grey would
    // make a magnitude option a visible no-op in the settings UI. Iterating
    // pairs (not hardcoded indexes) keeps a future magnitude covered too
    for (const id of COLOUR_IDS) {
      const greys = magnitudes.map(magnitude => {
        const css = buildDynamicCss(DEFAULT_PALETTE, true, magnitude);
        return {
          light: relativeLuminance(dividerGreyFor(css, id, false)),
          dark: relativeLuminance(dividerGreyFor(css, id, true))
        };
      });
      for (let i = 1; i < greys.length; i++) {
        // light theme goes darker with magnitude, dark theme brighter
        expect(greys[i].light).toBeLessThan(greys[i - 1].light);
        expect(greys[i].dark).toBeGreaterThan(greys[i - 1].dark);
      }
    }
  });

  it('clamps to the direction extreme when a user palette makes high unreachable', () => {
    // documented degrade in BOTH directions: a bright dark-theme shade makes
    // 6:1 impossible brighter-ward (clamp #ffffff), a near-black light-theme
    // shade makes it impossible darker-ward (clamp #000000) - the divider
    // rides the clamp rather than silently dropping the rule
    const palette = mergePalette({
      light: { rose: { inactive: '#303030', active: '#282828' } },
      dark: { rose: { inactive: '#c8c8c8', active: '#d0d0d0' } }
    });
    const css = buildDynamicCss(palette, true, 'high');
    expect(dividerGreyFor(css, 'rose', false)).toEqual('#000000');
    expect(dividerGreyFor(css, 'rose', true)).toEqual('#ffffff');
  });

  it('asDividerContrast guards raw settings values', () => {
    expect(asDividerContrast('low')).toEqual('low');
    expect(asDividerContrast('medium')).toEqual('medium');
    expect(asDividerContrast('high')).toEqual('high');
    expect(asDividerContrast(undefined)).toEqual('medium');
    expect(asDividerContrast('HIGH')).toEqual('medium');
    expect(asDividerContrast(42)).toEqual('medium');
    // membership is derived from CONTRAST_TARGETS - prototype-chain keys of
    // the object must not slip through the `in`-style check
    expect(asDividerContrast('toString')).toEqual('medium');
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
    expect(composite.dividerContrast).toEqual('medium');
  });

  it('schema dividerContrast enum and default match CONTRAST_TARGETS', () => {
    expect(schema.properties.dividerContrast.enum).toEqual(
      Object.keys(CONTRAST_TARGETS)
    );
    expect(schema.properties.dividerContrast.default).toEqual('medium');
    // the guard's junk fallback must be the same value as the schema default,
    // so malformed settings degrade to the product default, not a third value
    expect(asDividerContrast(undefined)).toEqual(
      schema.properties.dividerContrast.default
    );
  });

  it('schema dividerContrast description ratios match CONTRAST_TARGETS', () => {
    // the description states the ratios in prose ("low targets 3:1 ...") -
    // a retuned target with a stale description would be legacy fiction on
    // the settings UI, so each magnitude's number is pinned to the constant
    const description: string = schema.properties.dividerContrast.description;
    for (const [magnitude, target] of Object.entries(CONTRAST_TARGETS)) {
      // escape the dot so a future fractional target stays an exact match
      const ratio = String(target).replace('.', '\\.');
      expect(description).toMatch(new RegExp(`${magnitude}\\D*${ratio}:1`));
    }
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
