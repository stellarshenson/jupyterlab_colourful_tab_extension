/**
 * Unit tests for setWidgetTabColour - the function backing the public
 * IColourfulTabs.setColour API.
 */
import { Widget } from '@lumino/widgets';
import { setWidgetTabColour } from '../colours';

describe('setWidgetTabColour', () => {
  it('maps every colour id to its CSS class', () => {
    const cases: Record<string, string> = {
      rose: 'jp-colourful-tab-rose',
      peach: 'jp-colourful-tab-peach',
      lemon: 'jp-colourful-tab-lemon',
      mint: 'jp-colourful-tab-mint',
      sky: 'jp-colourful-tab-sky',
      lavender: 'jp-colourful-tab-lavender'
    };
    Object.entries(cases).forEach(([id, cssClass]) => {
      const widget = new Widget();
      setWidgetTabColour(widget, id);
      expect(widget.title.className).toBe(cssClass);
    });
  });

  it('clears the class when colourId is null', () => {
    const widget = new Widget();
    setWidgetTabColour(widget, 'mint');
    setWidgetTabColour(widget, null);
    expect(widget.title.className).toBe('');
  });

  it('clears the class for an unknown colour id', () => {
    const widget = new Widget();
    setWidgetTabColour(widget, 'sky');
    setWidgetTabColour(widget, 'not-a-colour');
    expect(widget.title.className).toBe('');
  });

  it('preserves other title classes (e.g. jp-mod-current accent) when tinting', () => {
    const widget = new Widget();
    widget.title.className = 'jp-mod-current';
    setWidgetTabColour(widget, 'sky');
    const tokens = widget.title.className.split(/\s+/).filter(Boolean);
    expect(tokens).toContain('jp-mod-current');
    expect(tokens).toContain('jp-colourful-tab-sky');
  });

  it('swaps the colour token without dropping other classes', () => {
    const widget = new Widget();
    widget.title.className = 'jp-mod-current jp-colourful-tab-sky';
    setWidgetTabColour(widget, 'rose');
    const tokens = widget.title.className.split(/\s+/).filter(Boolean);
    expect(tokens).toContain('jp-mod-current');
    expect(tokens).toContain('jp-colourful-tab-rose');
    expect(tokens).not.toContain('jp-colourful-tab-sky');
  });

  it('clearing removes only the colour token, keeping other classes', () => {
    const widget = new Widget();
    widget.title.className = 'jp-mod-current jp-colourful-tab-mint';
    setWidgetTabColour(widget, null);
    const tokens = widget.title.className.split(/\s+/).filter(Boolean);
    expect(tokens).toEqual(['jp-mod-current']);
  });

  it('leaves the className untouched on a disposed widget', () => {
    // Only isDisposed and title.className are read, so a minimal stand-in lets
    // us assert the guard directly without Lumino's dispose() clearing the title.
    const disposed = {
      isDisposed: true,
      title: { className: 'jp-colourful-tab-sky' }
    } as unknown as Widget;
    setWidgetTabColour(disposed, 'rose');
    expect(disposed.title.className).toBe('jp-colourful-tab-sky');
  });
});
