/**
 * Unit tests for the public IColourfulTabs API as the plugin hands it out -
 * the two paths that colour a tab (the context menu's stored map and
 * `setColour`) must not fight over it (DEF-COLOUR-5), and `setColour` must not
 * echo back through `colourChanged`.
 */
// the tsconfig only auto-includes jest types; pull in node's for `require`
/// <reference types="node" />
import { JupyterFrontEnd } from '@jupyterlab/application';
import { Token } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import { IColourChoice, IColourfulTabs } from '../tokens';

// The real @jupyterlab/terminal drags in xterm's untransformed ESM; the plugin
// only lists its ITerminalTracker token as optional, so a stand-in suffices.
jest.mock('@jupyterlab/terminal', () => ({
  ITerminalTracker: new Token('test:ITerminalTracker')
}));

// Likewise @jupyterlab/ui-components drags in @jupyter/react-components ESM;
// activation only constructs LabIcons and hands them to addCommand, so an
// inert stand-in class suffices.
jest.mock('@jupyterlab/ui-components', () => ({
  LabIcon: class {
    constructor(public options: unknown) {}
  }
}));

// The fingerprint client is the plugin's entire server dependency; stubbed so
// a test states exactly what the server said.
jest.mock('../fingerprints', () => ({
  fetchTerminalFingerprints: jest.fn()
}));

// jsdom ships no `CSS` object, and `releaseMenuColour` escapes the widget id
// with `CSS.escape`. The ids used here need no escaping.
if (typeof (globalThis as any).CSS === 'undefined') {
  (globalThis as any).CSS = { escape: (value: string) => value };
}

const STORAGE_KEY = 'jupyterlab-colourful-tab-colours';

/** Drain the microtask queue so promise handlers settle. */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

/** The dock panel and its tab bar, in the shape the plugin's selectors need. */
function makeDockPanel(): void {
  document.body.innerHTML =
    '<div id="jp-main-dock-panel">' +
    '<div class="lm-DockPanel-tabBar lm-TabBar"></div>' +
    '</div>';
}

/** A dock tab as the shell renders it - `data-id` is the widget id. */
function addTab(widgetId: string, titleAttr: string): HTMLElement {
  const tab = document.createElement('div');
  tab.className = 'lm-TabBar-tab';
  tab.dataset.id = widgetId;
  tab.setAttribute('title', titleAttr);
  (document.querySelector('.lm-DockPanel-tabBar') as HTMLElement).appendChild(
    tab
  );
  return tab;
}

/** A widget stand-in; `setColour` reads the id and the title and nothing else. */
function widget(id: string): Widget {
  return {
    id,
    isDisposed: false,
    title: { className: '' }
  } as unknown as Widget;
}

interface IHarness {
  api: IColourfulTabs;
  /** Resolve `app.restored`, which is what triggers the first repaint. */
  finishRestore: () => void;
}

/**
 * Activate a fresh plugin instance - the plugin holds its colour map, claims
 * and fingerprints at module scope, so each test needs its own module.
 */
function activatePlugin(options: {
  fingerprints: Record<string, string> | null;
  terminals?: Array<{ widgetId: string; sessionName: string }>;
}): IHarness {
  jest.resetModules();
  (
    require('../fingerprints').fetchTerminalFingerprints as jest.Mock
  ).mockResolvedValue(options.fingerprints);
  const plugin = require('../index').default;

  let finishRestore = (): void => undefined;
  const restored = new Promise<void>(resolve => {
    finishRestore = resolve;
  });
  const app = {
    serviceManager: {
      terminals: { runningChanged: new Signal<unknown, unknown>({}) }
    },
    commands: { addCommand: () => undefined },
    restored
  } as unknown as JupyterFrontEnd;
  const tracker = {
    forEach: (fn: (w: unknown) => void) =>
      (options.terminals ?? []).forEach(t =>
        fn({
          id: t.widgetId,
          content: { session: { model: { name: t.sessionName } } }
        })
      )
  };

  return { api: plugin.activate(app, tracker, null), finishRestore };
}

// The plugin debounces its DOM refresh on a 50ms timer and a module instance
// outlives the test that activated it; a fake clock keeps a late refresh out
// of the next test's DOM.
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('stored menu colour against an API colour', () => {
  const terminals = [{ widgetId: 'terminal-1', sessionName: '3' }];

  it('never repaints a stored colour over the colour an unclaimed tab shows', async () => {
    // ACC-ACTIVE-12, DEF-COLOUR-5. The entry survives `setColour` whenever the
    // user picks from the menu on an API-tinted tab, and Lumino then rewrites
    // the class attribute from `title.className` on the next re-render.
    // Repainting the stored colour over it is the brown -> blue -> brown fight
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const tab = addTab('terminal-1', '');
    // What Lumino renders onto the tab from `title.className` after setColour
    tab.classList.add('jp-colourful-tab-sky');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(true);
    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(false);
  });
});

describe('a claimed file tab', () => {
  it('repaints a stored file colour onto a claimed file tab the owner has left blank', async () => {
    // A path is a real identity, so its entry carries no terminal fingerprint.
    // Requiring one skipped the claimed tab, and the user's colour vanished on
    // reload even though the same file was still open at the same path
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '/home/lab/x.ipynb': 2 })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: {} });
    await flushPromises();
    h.api.claim(widget('file-1'));
    const tab = addTab('file-1', 'Name: x.ipynb\nPath: /home/lab/x.ipynb');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);
  });
});

describe('colourChanged against setColour', () => {
  it('announces nothing when a consumer sets or clears a colour', async () => {
    // ACC-API-35. The signal carries the user's menu choices only; a consumer
    // that answers a choice with `setColour` would otherwise hear its own call
    // back as a choice and loop
    makeDockPanel();
    addTab('terminal-1', '');
    const h = activatePlugin({
      fingerprints: { '3': 'pty-a' },
      terminals: [{ widgetId: 'terminal-1', sessionName: '3' }]
    });
    await flushPromises();
    const seen: IColourChoice[] = [];
    h.api.colourChanged.connect((_, choice) => seen.push(choice));
    const tinted = widget('terminal-1');

    h.api.setColour(tinted, 'sky');
    h.api.setColour(tinted, null);

    expect(seen).toEqual([]);
  });
});
