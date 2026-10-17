import { DEFAULT_PALETTE } from '../dynamicStyle';

/**
 * CIELAB lightness L* and chroma C* of a `#rrggbb` colour (sRGB, D65 white).
 *
 * @param hex - colour as `#rrggbb`
 */
function lightnessChroma(hex: string): { l: number; c: number } {
  const [r, g, b] = [1, 3, 5].map(offset => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const f = (t: number): number =>
    t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116;
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return {
    l: 116 * fy - 16,
    c: Math.hypot(500 * (fx - fy), 200 * (fy - fz))
  };
}

// Criterion "Muted light palette" (ACC-DIVIDE-53). The v1.1.21 light
// palette was derived in CIELAB so it holds on grey tab bars as well as white:
// every inactive shade at L* 80 C* 18, every active shade at L* 72.5 C* 28,
// lemon and mint active at C* 38. The anti-drift tests pin the three palette
// copies to each other; this pins the design itself, so the old bright
// pastels (#ff9db5 L* 75 C* 40, #fff176 L* 94 C* 61) cannot return in all
// three copies at once.
describe('muted light palette (v1.1.21)', () => {
  const ids = Object.keys(DEFAULT_PALETTE.light);

  it('covers all six colours', () => {
    expect(ids).toEqual(['rose', 'peach', 'lemon', 'mint', 'sky', 'lavender']);
  });

  it('holds every inactive shade at L* 80, C* 18', () => {
    for (const id of ids) {
      const { l, c } = lightnessChroma(DEFAULT_PALETTE.light[id].inactive);
      expect([id, Math.abs(l - 80) <= 0.5]).toEqual([id, true]);
      expect([id, Math.abs(c - 18) <= 0.5]).toEqual([id, true]);
    }
  });

  it('holds every active shade at L* 72.5, C* 28 - lemon and mint at C* 38', () => {
    for (const id of ids) {
      const { l, c } = lightnessChroma(DEFAULT_PALETTE.light[id].active);
      const chroma = id === 'lemon' || id === 'mint' ? 38 : 28;
      expect([id, Math.abs(l - 72.5) <= 0.5]).toEqual([id, true]);
      expect([id, Math.abs(c - chroma) <= 0.5]).toEqual([id, true]);
    }
  });
});
