/**
 * Unit tests for jupyterlab_colourful_tab_extension
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

// The fingerprint client is the plugin's entire server dependency. Stubbing it
// lets a test state exactly what the server said, including that it said
// nothing - the two answers drive different prune rules.
jest.mock('../fingerprints', () => ({
  fetchTerminalFingerprints: jest.fn()
}));

// jsdom ships no `CSS` object, and `releaseMenuColour` escapes the widget id
// with `CSS.escape` before putting it in a selector. The ids used here contain
// nothing that needs escaping, so an identity stand-in is enough to reach the
// code the browser reaches.
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

/** What is currently persisted, as the plugin wrote it. */
function readStore(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
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

/** Right-click a tab, which is how the plugin learns which tab a command acts on. */
function rightClick(tab: HTMLElement): void {
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
}

/** A widget stand-in; `claim` and `setColour` read the id and nothing else. */
function widget(id: string): Widget {
  return {
    id,
    isDisposed: false,
    title: { className: '' }
  } as unknown as Widget;
}

interface IHarness {
  api: IColourfulTabs;
  /** Run a registered command by id. The colour commands await the fingerprint
   *  of a terminal the cached map does not hold, so this settles the command. */
  execute: (commandId: string) => Promise<void>;
  /** Report the server's running terminals, as the manager's signal does. */
  emitRunning: (names: string[]) => void;
  /** Resolve `app.restored`, which is what triggers the first repaint. */
  finishRestore: () => void;
  /** The stubbed fingerprint client, to change the answer mid-test. */
  fingerprintClient: jest.Mock;
}

/**
 * Activate a fresh plugin instance.
 *
 * The plugin holds its colour map, its claims and its fingerprints at module
 * scope, so every test needs its own module instance rather than a shared one
 * carrying the previous test's state.
 */
function activatePlugin(options: {
  fingerprints: Record<string, string> | null;
  terminals?: Array<{ widgetId: string; sessionName: string }>;
}): IHarness {
  jest.resetModules();
  const fingerprintClient = require('../fingerprints')
    .fetchTerminalFingerprints as jest.Mock;
  fingerprintClient.mockResolvedValue(options.fingerprints);
  const plugin = require('../index').default;

  const commands = new Map<string, () => unknown>();
  let finishRestore = (): void => undefined;
  const restored = new Promise<void>(resolve => {
    finishRestore = resolve;
  });
  const runningChanged = new Signal<unknown, Array<{ name: string }>>({});
  const app = {
    serviceManager: { terminals: { runningChanged } },
    commands: {
      addCommand: (id: string, spec: { execute: () => unknown }) =>
        commands.set(id, spec.execute)
    },
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

  return {
    api: plugin.activate(app, tracker, null),
    execute: async id => {
      await (commands.get(id) as () => unknown)();
    },
    emitRunning: names => runningChanged.emit(names.map(name => ({ name }))),
    finishRestore,
    fingerprintClient
  };
}

// The plugin debounces its DOM refresh on a 50ms timer and a module instance
// outlives the test that activated it, so a late refresh would otherwise paint
// into the next test's DOM. Faking the clock keeps the timer from ever firing.
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

describe('terminal colour prune at activation', () => {
  it('drops a legacy bare-number terminal entry, keeping the file path', async () => {
    // The pre-fingerprint shape reads back with no fingerprint, which is
    // indistinguishable from the stale entry the prune exists to remove
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': 2, '/home/lab/x.ipynb': 4 })
    );
    activatePlugin({ fingerprints: { '3': 'pty-a' } });
    await flushPromises();
    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 4 });
  });

  it('keeps a terminal whose fingerprint still matches', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    activatePlugin({ fingerprints: { '3': 'pty-a' } });
    await flushPromises();
    expect(readStore()).toEqual({ 'terminal:3': { colour: 2, fp: 'pty-a' } });
  });

  it('drops the colour of a terminal whose name was handed to a new pty', async () => {
    // The reported defect: the name is still running, so nothing but the
    // fingerprint can tell that the terminal behind it is a different one
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 3, fp: 'dead-pty' } })
    );
    activatePlugin({ fingerprints: { '3': 'live-pty' } });
    await flushPromises();
    expect(readStore()).toEqual({});
  });

  it('prunes normally alongside a stored value of the wrong shape', async () => {
    // Every entry is read on every prune and every repaint. One value of
    // another shape reaching `entry.fp` throws out of the prune, so the stale
    // neighbour below keeps its colour and the feature stays down for that
    // browser until localStorage is cleared by hand
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'terminal:3': null,
        'terminal:4': { colour: 1, fp: 'dead-pty' },
        'terminal:5': { colour: 'mint' },
        '/home/lab/x.ipynb': 4
      })
    );
    activatePlugin({ fingerprints: { '4': 'live-pty' } });
    await flushPromises();
    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 4 });
  });

  it('keeps every stored colour when the route does not answer', async () => {
    // Without fingerprints the running list is the only evidence, and the
    // terminal manager has not necessarily fetched it yet - pruning here would
    // wipe every terminal colour (the 1.1.3 regression)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'terminal:3': 2 }));
    activatePlugin({ fingerprints: null });
    await flushPromises();
    expect(readStore()).toEqual({ 'terminal:3': 2 });
  });
});

describe('terminal colour prune on runningChanged', () => {
  it('falls back to the running list when the route does not answer', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': 2, 'terminal:4': 5 })
    );
    const h = activatePlugin({ fingerprints: null });
    await flushPromises();
    h.emitRunning(['3']);
    await flushPromises();
    expect(readStore()).toEqual({ 'terminal:3': 2 });
  });

  it('re-reads the fingerprints, so a name recycled later still loses its colour', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' } });
    await flushPromises();
    expect(readStore()).toEqual({ 'terminal:3': { colour: 2, fp: 'pty-a' } });

    h.fingerprintClient.mockResolvedValue({ '3': 'pty-b' });
    h.emitRunning(['3']);
    await flushPromises();
    expect(readStore()).toEqual({});
  });
});

describe('what the prune leaves on screen', () => {
  const terminals = [{ widgetId: 'terminal-1', sessionName: '3' }];

  it('clears the colour it just dropped off the tab showing it', async () => {
    // Dropping the entry alone leaves the dead terminal's colour painted on the
    // recycled name for the rest of the session - the exact symptom the prune
    // exists to remove
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.finishRestore();
    await flushPromises();
    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);

    h.fingerprintClient.mockResolvedValue({ '3': 'pty-b' });
    h.emitRunning(['3']);
    await flushPromises();

    expect(readStore()).toEqual({});
    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(false);
  });

  it('leaves a colour the dropped entry did not paint', async () => {
    // The tab is showing the setColour API's colour. The stale menu entry is a
    // different one, and dropping it must not take the visible colour with it
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    tab.classList.add('jp-colourful-tab-sky');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();

    h.fingerprintClient.mockResolvedValue({ '3': 'pty-b' });
    h.emitRunning(['3']);
    await flushPromises();

    expect(readStore()).toEqual({});
    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(true);
  });

  it('leaves the colour on a claimed tab, where the owner is the painter', async () => {
    // On a claimed tab the class was painted by the owner, not by this entry.
    // An upgrader's legacy entry and the colour the owner painted are routinely
    // the same palette index, so stripping it here removes the owner's colour
    // and nothing repaints it until the owner's next pass
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    tab.classList.add('jp-colourful-tab-lemon');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));

    h.fingerprintClient.mockResolvedValue({ '3': 'pty-b' });
    h.emitRunning(['3']);
    await flushPromises();

    expect(readStore()).toEqual({});
    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);
  });
});

describe('colourChanged', () => {
  const terminals = [{ widgetId: 'terminal-1', sessionName: '3' }];

  it('carries the colour id and the widget id on a pick', async () => {
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const seen: IColourChoice[] = [];
    h.api.colourChanged.connect((_, choice) => seen.push(choice));

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');

    expect(seen).toEqual([{ widgetId: 'terminal-1', colourId: 'mint' }]);
  });

  it('carries a null colour id on a clear', async () => {
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const seen: IColourChoice[] = [];
    h.api.colourChanged.connect((_, choice) => seen.push(choice));

    rightClick(tab);
    await h.execute('colourful-tab:clear');

    expect(seen).toEqual([{ widgetId: 'terminal-1', colourId: null }]);
  });

  it('stores the cached fingerprint alongside a terminal colour, asking again for nothing', async () => {
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const asked = h.fingerprintClient.mock.calls.length;

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');

    expect(readStore()).toEqual({ 'terminal:3': { colour: 3, fp: 'pty-a' } });
    expect(h.fingerprintClient).toHaveBeenCalledTimes(asked);
  });

  it('stores without a fingerprint when the route will not answer either', async () => {
    // Unverifiable and stored as such - the next prune that has fingerprints
    // drops it, and no timer or retry is added to chase the route
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: null, terminals });
    await flushPromises();

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');

    expect(readStore()).toEqual({ 'terminal:3': 3 });
  });

  it('stores a file path as the bare number - a path needs no fingerprint', async () => {
    makeDockPanel();
    const tab = addTab('notebook-1', 'Name: x.ipynb\nPath: /home/lab/x.ipynb');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' } });
    await flushPromises();
    const asked = h.fingerprintClient.mock.calls.length;

    rightClick(tab);
    await h.execute('colourful-tab:set-sky');

    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 4 });
    expect(h.fingerprintClient).toHaveBeenCalledTimes(asked);
  });
});

describe('claim', () => {
  const terminals = [{ widgetId: 'terminal-1', sessionName: '3' }];

  it('leaves the stored menu colour where it is', async () => {
    // The colour the user set on this terminal before the owner started running
    // in it, carrying the fingerprint of THIS terminal. Deleting it discards a
    // deliberate choice, and that choice is what the tab shows whenever the
    // owner holds no colour for what runs there
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();

    h.api.claim(widget('terminal-1'));

    expect(readStore()).toEqual({ 'terminal:3': { colour: 2, fp: 'pty-a' } });
  });

  it('announces nothing of its own - a claim is not a choice', async () => {
    // Emitting the stored colour here let a colour the user has since replaced
    // re-assert itself over the new one: a claim episode ends and restarts as
    // ordinary business - a reload, a failed probe, a restart - and each restart
    // re-filed the older colour against the owner's durable identity
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const seen: IColourChoice[] = [];
    h.api.colourChanged.connect((_, choice) => seen.push(choice));

    h.api.claim(widget('terminal-1'));

    expect(seen).toEqual([]);
  });

  it('keeps the stored entry when the owner paints through setColour', async () => {
    // An owner claims the tab and then paints it, so `setColour` runs on every
    // claimed tab. Releasing the menu colour there deletes the user's earlier
    // choice on the owner's first paint, in the only sequence a real consumer
    // performs
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const owned = widget('terminal-1');

    h.api.claim(owned);
    h.api.setColour(owned, 'sky');

    expect(readStore()).toEqual({ 'terminal:3': { colour: 2, fp: 'pty-a' } });
  });

  it('still drops the stored colour when setColour paints an unclaimed tab', async () => {
    // The DEF-5 rule the exemption above must not widen: with no claim the two
    // paths do compete for the tab, and the stored entry resurfaces whenever
    // the API colour is cleared
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();

    h.api.setColour(widget('terminal-1'), 'sky');

    expect(readStore()).toEqual({});
  });

  it("prunes a claimed tab's entry with its terminal, like any other", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));

    h.fingerprintClient.mockResolvedValue({});
    h.emitRunning([]);
    await flushPromises();

    expect(readStore()).toEqual({});
  });

  it('repaints the stored colour once the claim is released', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const claim = h.api.claim(widget('terminal-1'));
    const tab = addTab('terminal-1', '');
    claim.dispose();

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);
  });

  it('paints and emits a pick on a claimed tab, but persists nothing', async () => {
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const seen: IColourChoice[] = [];
    h.api.colourChanged.connect((_, choice) => seen.push(choice));
    h.api.claim(widget('terminal-1'));

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');

    expect(tab.classList.contains('jp-colourful-tab-mint')).toBe(true);
    expect(seen).toEqual([{ widgetId: 'terminal-1', colourId: 'mint' }]);
    expect(readStore()).toEqual({});
  });

  it('deletes the entry a pick on a claimed tab replaces', async () => {
    // Nothing fails anywhere in this sequence. The owner has not filed the new
    // colour yet - it holds the choice pending while the conversation is
    // unreadable - and Lumino rebuilds the tab's class attribute from the
    // widget title on the next tab switch, which is what the strip below is.
    // The older entry left standing repaints over the pick the user just made
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');
    expect(readStore()).toEqual({});

    tab.className = 'lm-TabBar-tab';
    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(false);
  });

  it('deletes the entry a clear on a claimed tab replaces', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));

    rightClick(tab);
    await h.execute('colourful-tab:clear');

    expect(readStore()).toEqual({});
  });

  it('leaves a claimed tab blank when the stored entry is unverified', async () => {
    // With the route unavailable the prune falls back to the running list,
    // which structurally cannot see a recycled name, so a dead terminal's entry
    // survives - and painting it onto the assistant's tab is the original
    // defect returning by its visual half
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'dead-pty' } })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: null, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));
    const tab = addTab('terminal-1', '');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(false);
    // Not dropped either - the entry is the unclaimed path's to paint, and the
    // running-list rule has no evidence against a name that is running
    expect(readStore()).toEqual({
      'terminal:3': { colour: 2, fp: 'dead-pty' }
    });
  });

  it('still repaints an unverified entry onto an UNCLAIMED tab', async () => {
    // Pre-existing behaviour and deliberately untouched: narrowing the
    // unclaimed path to verified entries would drop every colour set before the
    // fingerprint existed, and every colour at all on a server without the route
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'terminal:3': 2 }));
    makeDockPanel();
    const h = activatePlugin({ fingerprints: null, terminals });
    await flushPromises();
    const tab = addTab('terminal-1', '');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);
  });

  it('repaints a stored colour onto a claimed tab the owner has left blank', async () => {
    // An owner that holds no colour for what runs in the terminal - the
    // ordinary case for an assistant whose colour source is 'none' - paints
    // nothing, and the tab then carries no colour class. Skipping it here is
    // what made the user's earlier colour vanish with nothing in its place
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));
    const tab = addTab('terminal-1', '');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);
    // Painted from the entry where it stands - the claim moves no colour and
    // makes no second copy of one
    expect(readStore()).toEqual({ 'terminal:3': { colour: 2, fp: 'pty-a' } });
  });

  it("leaves the owner's own colour on a claimed tab", async () => {
    // The owner does hold a colour for this conversation and has painted it.
    // The stored entry must not paint over it: that is the two paths fighting
    // over one tab (DEF-5), which the no-colour-class guard alone prevents
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));
    const tab = addTab('terminal-1', '');
    // What Lumino renders onto the tab from `title.className` after setColour
    tab.classList.add('jp-colourful-tab-sky');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(true);
    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(false);
  });

  it('repaints a stored colour onto the same tab once it is not claimed', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const tab = addTab('terminal-1', '');

    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(true);
  });

  it('restores persistence when the claim is disposed', async () => {
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const claim = h.api.claim(widget('terminal-1'));

    claim.dispose();
    rightClick(tab);
    await h.execute('colourful-tab:set-mint');

    expect(readStore()).toEqual({ 'terminal:3': { colour: 3, fp: 'pty-a' } });
  });

  it('stays owned until every holder has released', async () => {
    // Two holders over one tab - a panel rebuilt over a still-running terminal
    // overlaps its predecessor - and the first to dispose must not hand the tab
    // back while the second still owns it
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const first = h.api.claim(widget('terminal-1'));
    const second = h.api.claim(widget('terminal-1'));

    first.dispose();
    rightClick(tab);
    await h.execute('colourful-tab:set-mint');
    expect(readStore()).toEqual({});

    second.dispose();
    rightClick(tab);
    await h.execute('colourful-tab:set-mint');
    expect(readStore()).toEqual({ 'terminal:3': { colour: 3, fp: 'pty-a' } });
  });

  it('disposing one holder twice releases one claim', async () => {
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const first = h.api.claim(widget('terminal-1'));
    const second = h.api.claim(widget('terminal-1'));

    first.dispose();
    first.dispose();

    expect(first.isDisposed).toBe(true);
    rightClick(tab);
    await h.execute('colourful-tab:set-mint');
    expect(readStore()).toEqual({});

    second.dispose();
    rightClick(tab);
    await h.execute('colourful-tab:set-mint');
    expect(readStore()).toEqual({ 'terminal:3': { colour: 3, fp: 'pty-a' } });
  });
});

// Pre-existing and inert: both assert the length of an array the test itself
// declares, so neither reaches any code in src/. Left in place rather than
// removed, since removing them is not part of this change.
describe('jupyterlab_colourful_tab_extension', () => {
  it('should define light theme colours', () => {
    const lightColours = [
      { name: 'Rose', colour: '#ffd6e0' },
      { name: 'Peach', colour: '#ffe5cc' },
      { name: 'Lemon', colour: '#fff9c4' },
      { name: 'Mint', colour: '#c8f7c5' },
      { name: 'Sky', colour: '#c5e8f7' },
      { name: 'Lavender', colour: '#e5d6f7' }
    ];
    expect(lightColours.length).toEqual(6);
  });

  it('should define dark theme colours', () => {
    const darkColours = [
      { name: 'Rose', colour: '#5c3a42' },
      { name: 'Peach', colour: '#5c4a3a' },
      { name: 'Lemon', colour: '#5c5a3a' },
      { name: 'Mint', colour: '#3a5c3f' },
      { name: 'Sky', colour: '#3a4a5c' },
      { name: 'Lavender', colour: '#4a3a5c' }
    ];
    expect(darkColours.length).toEqual(6);
  });
});
