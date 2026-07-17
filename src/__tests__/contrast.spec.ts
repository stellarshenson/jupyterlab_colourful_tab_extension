import { contrastRatio, dividerGrey, relativeLuminance } from '../contrast';

/** The grey one step lighter/dimmer than a `#gggggg` grey. */
function stepBack(grey: string, direction: 'darker' | 'brighter'): string {
  const g = parseInt(grey.slice(1, 3), 16) + (direction === 'darker' ? 1 : -1);
  const pair = g.toString(16).padStart(2, '0');
  return `#${pair}${pair}${pair}`;
}

describe('relativeLuminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(relativeLuminance('#000000')).toBeCloseTo(0);
  });
});

describe('contrastRatio', () => {
  it('is 21 for white vs black', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21);
  });

  it('is symmetric in argument order', () => {
    expect(contrastRatio('#ffd6e0', '#4e3138')).toBeCloseTo(
      contrastRatio('#4e3138', '#ffd6e0')
    );
  });
});

describe('dividerGrey', () => {
  it('finds the lightest dark grey passing against both rose shades', () => {
    // both shades constrain the seam: either neighbour may be the active tab
    const shades = ['#ffd6e0', '#ff9db5'];
    const grey = dividerGrey(shades, 'darker');
    shades.forEach(bg => {
      expect(contrastRatio(grey, bg)).toBeGreaterThanOrEqual(4.0);
    });
    // one step lighter must fail somewhere - proves the scan stops at minimum
    const lighter = stepBack(grey, 'darker');
    expect(shades.some(bg => contrastRatio(lighter, bg) < 4.0)).toBe(true);
  });

  it('finds the dimmest bright grey passing against both lemon shades', () => {
    const shades = ['#4e4b32', '#3a3825'];
    const grey = dividerGrey(shades, 'brighter');
    shades.forEach(bg => {
      expect(contrastRatio(grey, bg)).toBeGreaterThanOrEqual(4.0);
    });
    const dimmer = stepBack(grey, 'brighter');
    expect(shades.some(bg => contrastRatio(dimmer, bg) < 4.0)).toBe(true);
  });

  it('stays on the required side for palettes that contradict the theme', () => {
    // dark shades under 'darker' must not flip to a bright grey (and vice
    // versa) just because the opposite side reaches the contrast target first
    const dark = dividerGrey(['#202020', '#101010'], 'darker');
    expect(relativeLuminance(dark)).toBeLessThan(relativeLuminance('#101010'));
    const bright = dividerGrey(['#e0e0e0'], 'brighter');
    expect(relativeLuminance(bright)).toBeGreaterThan(
      relativeLuminance('#e0e0e0')
    );
  });

  it('clamps to the extreme when the target is unreachable', () => {
    // mid grey can never reach 21:1 in either direction
    expect(dividerGrey(['#808080'], 'darker', 21)).toEqual('#000000');
    expect(dividerGrey(['#808080'], 'brighter', 21)).toEqual('#ffffff');
  });

  it('always returns a lowercase greyscale hex', () => {
    const grey = dividerGrey(['#c8f7c5', '#8ff08a'], 'darker');
    expect(grey).toMatch(/^#[0-9a-f]{6}$/);
    expect(grey.slice(1, 3)).toEqual(grey.slice(3, 5));
    expect(grey.slice(3, 5)).toEqual(grey.slice(5, 7));
  });
});
