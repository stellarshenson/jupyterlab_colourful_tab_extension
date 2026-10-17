// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

import { relativeLuminance } from '../contrast';

const COLOUR_IDS = ['rose', 'peach', 'lemon', 'mint', 'sky', 'lavender'];

/** HSL saturation of a `#rrggbb` colour. */
function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
}

describe('light active shades in style/base.css', () => {
  const baseCss = fs.readFileSync(
    path.resolve(__dirname, '../../style/base.css'),
    'utf8'
  );
  const root = (baseCss.match(/:root\s*\{([^}]*)\}/) ?? [])[1] ?? '';

  /** The hex a `:root` declaration assigns to the variable, or undefined. */
  function rootValue(variable: string): string | undefined {
    return root.match(new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6});`))?.[1];
  }

  // ACC-ACTIVE-1: the muted light palette (1.1.21, a user decision) selects a
  // tab with a DARKER and more saturated shade of its colour - not a brighter
  // one - so the -active variable must sit below its base in luminance and
  // above it in saturation, for every colour
  it(':root defines a darker, more saturated -active shade for all six colours', () => {
    for (const id of COLOUR_IDS) {
      const base = rootValue(`--jp-colourful-tab-${id}`);
      const active = rootValue(`--jp-colourful-tab-${id}-active`);
      expect({ id, base, active }).toEqual({
        id,
        base: expect.stringMatching(/^#/),
        active: expect.stringMatching(/^#/)
      });
      expect(relativeLuminance(active as string)).toBeLessThan(
        relativeLuminance(base as string)
      );
      expect(saturation(active as string)).toBeGreaterThan(
        saturation(base as string)
      );
    }
  });
});
