/**
 * The selected-tab accent through the public `setColour` API (DEF-ACTIVE-1,
 * ACC-ACTIVE-8). The shell keeps the accent as `jp-mod-current` on the widget's
 * `title.className`, the same property the API tints through, and Lumino builds
 * the tab's class attribute from that property on every render. A tint must
 * therefore swap only the colour token: the rendered tab keeps the accent
 * class and every other title token across tints, re-tints and a clear.
 */
import { JupyterFrontEnd } from '@jupyterlab/application';
import { Token } from '@lumino/coreutils';
import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { TabBar, Widget } from '@lumino/widgets';
import plugin from '../index';
import { IColourfulTabs } from '../tokens';

// Same stand-ins as the plugin spec: the real modules drag in untransformed
// ESM, and activation only needs their tokens and an inert icon class
jest.mock('@jupyterlab/terminal', () => ({
  ITerminalTracker: new Token('test:ITerminalTracker')
}));
jest.mock('@jupyterlab/ui-components', () => ({
  LabIcon: class {
    constructor(public options: unknown) {}
  }
}));
jest.mock('../fingerprints', () => ({
  fetchTerminalFingerprints: jest.fn().mockResolvedValue(null)
}));

// jsdom ships no `CSS`; `releaseMenuColour` escapes the widget id with it
if (typeof (globalThis as any).CSS === 'undefined') {
  (globalThis as any).CSS = { escape: (value: string) => value };
}

/** Activate the plugin against a stand-in app and return the public API. */
function activate(): IColourfulTabs {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const app = {
    serviceManager: {
      terminals: { runningChanged: new Signal<unknown, unknown>({}) }
    },
    commands: { addCommand: () => undefined },
    // Never resolves: the DOM observer is not under test here
    restored: new Promise<void>(() => undefined)
  } as unknown as JupyterFrontEnd;
  return plugin.activate(app, null, null) as IColourfulTabs;
}

/**
 * A widget as the shell holds it in the main dock: its tab rendered by a real
 * Lumino tab bar under `#jp-main-dock-panel`, `data-id` set to the widget id,
 * and `jp-mod-current` appended to the title the way the shell's
 * `_onCurrentChanged` appends it. `jp-mod-dirty` is the document registry's
 * unsaved-changes token, appended the same way.
 */
function currentDockWidget(id: string): { widget: Widget; tab: () => Element } {
  document.body.innerHTML = '<div id="jp-main-dock-panel"></div>';
  const widget = new Widget();
  widget.id = id;
  widget.title.label = id;
  widget.title.dataset = { id };
  const bar = new TabBar<Widget>();
  bar.addTab(widget.title);
  Widget.attach(bar, document.getElementById('jp-main-dock-panel')!);
  widget.title.className += ' jp-mod-current';
  widget.title.className += ' jp-mod-dirty';
  MessageLoop.flush();
  return {
    widget,
    tab: () => bar.contentNode.querySelector(`[data-id="${id}"]`)!
  };
}

/** The colour classes on a rendered tab. */
function colourClasses(tab: Element): string[] {
  return Array.from(tab.classList).filter(c =>
    c.startsWith('jp-colourful-tab-')
  );
}

/** How many times a token occurs in the title's className string. */
function occurrences(widget: Widget, token: string): number {
  return widget.title.className.split(/\s+/).filter(t => t === token).length;
}

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('selected-tab accent through setColour', () => {
  // DEF-ACTIVE-1, ACC-ACTIVE-8. Both API branches: an unclaimed tab, where the
  // API also drops the stored menu colour, and a claimed tab, where it does not
  it.each([false, true])(
    'keeps jp-mod-current and other title tokens across tint, re-tints and clear (claimed: %s)',
    claimed => {
      const api = activate();
      const { widget, tab } = currentDockWidget(`accent-${claimed}`);
      if (claimed) {
        api.claim(widget);
      }

      api.setColour(widget, 'sky');
      MessageLoop.flush();
      expect(tab().classList).toContain('jp-mod-current');
      expect(tab().classList).toContain('jp-mod-dirty');
      expect(colourClasses(tab())).toEqual(['jp-colourful-tab-sky']);

      // A consumer re-tints on every title or status update of its widget
      for (let i = 0; i < 5; i++) {
        api.setColour(widget, 'rose');
        MessageLoop.flush();
      }
      expect(tab().classList).toContain('jp-mod-current');
      expect(tab().classList).toContain('jp-mod-dirty');
      expect(colourClasses(tab())).toEqual(['jp-colourful-tab-rose']);
      // One accent token, not one per re-tint: the shell deselects with a
      // single `String.replace`, so a duplicate would keep the accent bar on
      // a tab that is no longer current
      expect(occurrences(widget, 'jp-mod-current')).toBe(1);

      api.setColour(widget, null);
      MessageLoop.flush();
      expect(tab().classList).toContain('jp-mod-current');
      expect(tab().classList).toContain('jp-mod-dirty');
      expect(colourClasses(tab())).toEqual([]);
    }
  );
});
