// WCAG contrast maths for the divider between same-coloured adjacent tabs.
// Kept free of DOM and JupyterLab imports so it is directly executable under
// jest, and so the divider grey can be recomputed whenever the user edits the
// palette in settings - a hardcoded grey would drift from a custom palette.

/**
 * WCAG 2.x relative luminance of a `#rrggbb` hex colour.
 *
 * Each sRGB channel is linearised (c/12.92 below the 0.03928 knee, otherwise
 * ((c+0.055)/1.055)^2.4) and weighted 0.2126/0.7152/0.0722 for R/G/B.
 *
 * @param hex - colour as `#rrggbb`
 */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * WCAG contrast ratio between two `#rrggbb` colours: (Lmax+0.05)/(Lmin+0.05).
 * Symmetric in argument order; ranges from 1 (identical) to 21 (black/white).
 *
 * @param hexA - first colour as `#rrggbb`
 * @param hexB - second colour as `#rrggbb`
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

/**
 * The greyscale stroke for the 1px seam between two adjacent tabs of the same
 * colour - without it the tabs fuse into one block. The grey must reach the
 * target ratio against EVERY given background because either neighbour may be
 * the current tab, so both the inactive and active shades are passed in.
 *
 * Scans grey levels toward the extreme and returns the FIRST level that sits
 * on the required side of every background (lower luminance for 'darker',
 * higher for 'brighter') AND passes against all of them: for 'darker' (light
 * themes) the lightest passing dark grey, for 'brighter' (dark themes) the
 * dimmest passing bright grey - the subtlest line that still separates the
 * tabs. Falls back to `#000000` / `#ffffff` when no such level exists.
 *
 * @param backgrounds - `#rrggbb` shades the seam must contrast with
 * @param direction - 'darker' for light themes, 'brighter' for dark themes
 * @param target - required contrast ratio, default 4.0 (WCAG non-text is 3:1)
 */
export function dividerGrey(
  backgrounds: string[],
  direction: 'darker' | 'brighter',
  target: number = 4.0
): string {
  // contrast alone is not enough: a palette that contradicts the theme (dark
  // shades in the light theme) would pass the target from the wrong side, so
  // the direction is enforced against every background's luminance too
  const luminances = backgrounds.map(relativeLuminance);
  const start = direction === 'darker' ? 255 : 0;
  const end = direction === 'darker' ? 0 : 255;
  const step = direction === 'darker' ? -1 : 1;
  for (let g = start; g !== end + step; g += step) {
    const pair = g.toString(16).padStart(2, '0');
    const grey = `#${pair}${pair}${pair}`;
    const lum = relativeLuminance(grey);
    const onSide =
      direction === 'darker'
        ? luminances.every(l => lum < l)
        : luminances.every(l => lum > l);
    if (onSide && backgrounds.every(bg => contrastRatio(grey, bg) >= target)) {
      return grey;
    }
  }
  return direction === 'darker' ? '#000000' : '#ffffff';
}
