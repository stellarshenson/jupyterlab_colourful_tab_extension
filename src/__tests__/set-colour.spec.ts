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
