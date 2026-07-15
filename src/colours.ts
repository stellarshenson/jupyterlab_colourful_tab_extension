import { Widget } from '@lumino/widgets';

/**
 * Colour definitions - CSS classes are defined in style/base.css
 * CSS variables handle light/dark theme switching automatically
 */
export const COLOURS = [
  { name: 'Red', id: 'rose', cssClass: 'jp-colourful-tab-rose' },
  { name: 'Orange', id: 'peach', cssClass: 'jp-colourful-tab-peach' },
  { name: 'Yellow', id: 'lemon', cssClass: 'jp-colourful-tab-lemon' },
  { name: 'Green', id: 'mint', cssClass: 'jp-colourful-tab-mint' },
  { name: 'Blue', id: 'sky', cssClass: 'jp-colourful-tab-sky' },
  { name: 'Purple', id: 'lavender', cssClass: 'jp-colourful-tab-lavender' }
];

/**
 * Set (or clear) a widget's dock-tab colour via its Lumino title className.
 * `colourId` is one of the colour ids or null to clear. Applied through the
 * widget's Lumino title so it rides tab re-renders; independent of the
 * menu-driven, localStorage-backed per-tab colours. Backs the public
 * IColourfulTabs API.
 */
export function setWidgetTabColour(
  widget: Widget,
  colourId: string | null
): void {
  if (!widget || widget.isDisposed) {
    return;
  }
  const entry = colourId ? COLOURS.find(c => c.id === colourId) : undefined;
  // Preserve every other class on the Lumino title - the shell stores the
  // selected-tab accent as `jp-mod-current` (and `jp-mod-active`) on this same
  // property. Only swap our own colour token; overwriting title.className
  // wholesale destroys those sibling classes and makes the accent bar vanish
  // (DEF-1) whenever a consumer re-applies the colour.
  const colourClasses = new Set(COLOURS.map(c => c.cssClass));
  const tokens = (widget.title.className || '')
    .split(/\s+/)
    .filter(token => token && !colourClasses.has(token));
  if (entry) {
    tokens.push(entry.cssClass);
  }
  widget.title.className = tokens.join(' ');
}
