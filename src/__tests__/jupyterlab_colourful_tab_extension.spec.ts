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
  /** The main-area widgets, where a pick or a clear holds its colour. */
  widgets?: Widget[];
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
    shell: { widgets: () => options.widgets ?? [] },
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

  it('lets a consumer that answers the signal take ownership of an unclaimed tab', async () => {
    // A consumer that answers `colourChanged` with `setColour` runs
    // `releaseMenuColour` synchronously, which drops the menu entry the
    // announcement is about (ACC-ACTIVE-12). Writing the entry after the signal
    // puts it back, and the colour the consumer cleared repaints on the next
    // pass
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const w = widget('terminal-1');
    h.api.colourChanged.connect(() => {
      h.api.setColour(w, 'sky');
    });

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');

    expect(readStore()).toEqual({});

    h.api.setColour(w, null);
    tab.className = 'lm-TabBar-tab';
    await flushPromises();
    jest.advanceTimersByTime(50);

    expect(
      Array.from(tab.classList).filter(c => c.startsWith('jp-colourful-tab-'))
    ).toEqual([]);
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

  it('keeps the entry a pick on a claimed tab replaces', async () => {
    // The entry is the file's colour, shared by every view of it in every
    // window, so a pick on one claimed view leaves it for the others. The
    // acted view is not repainted from it again this session - otherwise the
    // older entry would repaint over the pick as soon as Lumino rebuilds the
    // tab's class attribute from the widget title
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
    expect(readStore()).toEqual({
      'terminal:3': { colour: 2, fp: 'pty-a' }
    });

    tab.className = 'lm-TabBar-tab';
    h.finishRestore();
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-lemon')).toBe(false);
  });

  it('keeps the entry a clear on a claimed tab replaces', async () => {
    // Same rule as a pick: the entry stays for the file's other views, and
    // the acted claimed view is not repainted from it again this session, so
    // the Clear the user just made is not silently undone
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    h.api.claim(widget('terminal-1'));
    // The observer is what repaints after Lumino rewrites a tab's class;
    // bring it live before the Clear so a repaint would reach the assertion
    h.finishRestore();
    await flushPromises();

    rightClick(tab);
    await h.execute('colourful-tab:clear');

    expect(readStore()).toEqual({
      'terminal:3': { colour: 2, fp: 'pty-a' }
    });
    await flushPromises();
    expect(
      Array.from(tab.classList).filter(c => c.startsWith('jp-colourful-tab-'))
    ).toEqual([]);
  });

  it('keeps a Clear on a claimed view cleared after the claim is released', async () => {
    // The mark records the user's choice on this view, not the owner's hold on
    // it: the owner disposes its claim when its widget goes away, and the
    // stored entry must not repaint the view after that either
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const claim = h.api.claim(widget('terminal-1'));
    h.finishRestore();
    await flushPromises();

    rightClick(tab);
    await h.execute('colourful-tab:clear');
    claim.dispose();

    tab.className = 'lm-TabBar-tab';
    await flushPromises();
    jest.advanceTimersByTime(50);

    expect(
      Array.from(tab.classList).filter(c => c.startsWith('jp-colourful-tab-'))
    ).toEqual([]);
    expect(readStore()).toEqual({ 'terminal:3': { colour: 2, fp: 'pty-a' } });
  });

  it('lets a later unclaimed pick release the mark it supersedes', async () => {
    // The mark stops the OLD entry repainting over the claimed-time choice.
    // Once the claim is released and an unclaimed pick rewrites the entry, that
    // predicate no longer holds: the stored colour is the user's newer choice
    // and must show after an API clear
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'terminal:3': { colour: 2, fp: 'pty-a' } })
    );
    makeDockPanel();
    const tab = addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    const claim = h.api.claim(widget('terminal-1'));
    h.finishRestore();
    await flushPromises();

    rightClick(tab);
    await h.execute('colourful-tab:clear');
    claim.dispose();

    rightClick(tab);
    await h.execute('colourful-tab:set-mint');
    expect(readStore()).toEqual({ 'terminal:3': { colour: 3, fp: 'pty-a' } });

    h.api.setColour(widget('terminal-1'), null);
    tab.className = 'lm-TabBar-tab';
    await flushPromises();
    jest.advanceTimersByTime(50);

    expect(tab.classList.contains('jp-colourful-tab-mint')).toBe(true);
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

describe('a restored file tab', () => {
  it('shows its stored colour once its path arrives in the title', async () => {
    // ACC-IDENT-23, ACC-IDENT-26 - a restored document tab has an empty
    // `title` attribute at `app.restored`, so the first repaint cannot resolve
    // its path. The path then arrives as a `title` change and nothing else; a
    // background tab gets no class or child change that would repaint it
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '/home/lab/x.ipynb': 4 })
    );
    makeDockPanel();
    const tab = addTab('notebook-1', '');
    const h = activatePlugin({ fingerprints: {} });
    await flushPromises();
    h.finishRestore();
    await flushPromises();
    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(false);

    tab.setAttribute('title', 'Name: x.ipynb\nPath: /home/lab/x.ipynb');
    await flushPromises();
    jest.advanceTimersByTime(50);

    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(true);
    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 4 });
  });

  it('shows its stored colour on every view of the same file', async () => {
    // One path open in two views gives two tabs under one stable id. Keyed
    // one tab per id, only the last tab in DOM order was ever repainted
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '/home/lab/x.ipynb': 4 })
    );
    makeDockPanel();
    const first = addTab(
      'notebook-1',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const second = addTab(
      'notebook-2',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const h = activatePlugin({ fingerprints: {} });
    await flushPromises();
    h.finishRestore();
    await flushPromises();

    expect(first.classList.contains('jp-colourful-tab-sky')).toBe(true);
    expect(second.classList.contains('jp-colourful-tab-sky')).toBe(true);
  });

  it('a pick on one view repaints the other view and its title hold', async () => {
    // One stable id, two tabs. The pick painted and titled only the
    // right-clicked tab, so Lumino's next re-render of the other view restored
    // the colour of the earlier pick there - one file shown in two colours
    makeDockPanel();
    const first = addTab(
      'notebook-1',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const second = addTab(
      'notebook-2',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const firstWidget = widget('notebook-1');
    const secondWidget = widget('notebook-2');
    const h = activatePlugin({
      fingerprints: {},
      widgets: [firstWidget, secondWidget]
    });
    await flushPromises();

    rightClick(first);
    await h.execute('colourful-tab:set-rose');
    rightClick(second);
    await h.execute('colourful-tab:set-sky');

    // What Lumino renders onto view A from its widget title
    first.className = 'lm-TabBar-tab ' + firstWidget.title.className;

    expect(first.classList.contains('jp-colourful-tab-sky')).toBe(true);
    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(false);
    expect(second.classList.contains('jp-colourful-tab-sky')).toBe(true);
  });

  it('Clear on one view clears the other view and its title hold', async () => {
    // The clear painted and titled only the right-clicked tab, so the other
    // view kept the colour its title was given by the earlier pick
    makeDockPanel();
    const first = addTab(
      'notebook-1',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const second = addTab(
      'notebook-2',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const firstWidget = widget('notebook-1');
    const secondWidget = widget('notebook-2');
    const h = activatePlugin({
      fingerprints: {},
      widgets: [firstWidget, secondWidget]
    });
    await flushPromises();

    rightClick(first);
    await h.execute('colourful-tab:set-rose');
    rightClick(second);
    await h.execute('colourful-tab:clear');

    // What Lumino renders onto view A from its widget title
    first.className = 'lm-TabBar-tab ' + firstWidget.title.className;

    expect(
      Array.from(first.classList).filter(c => c.startsWith('jp-colourful-tab-'))
    ).toEqual([]);
    expect(
      Array.from(second.classList).filter(c =>
        c.startsWith('jp-colourful-tab-')
      )
    ).toEqual([]);
  });

  it("a pick and a Clear on one view leave a claimed sibling's owner colour alone", async () => {
    // The fan-out paints every tab under one stable id without asking whether
    // the other view is claimed. On a claimed view the painter is the owner, so
    // repainting it replaces the owner's colour while `colourChanged` names
    // only the acted widget; the claimed branch stores nothing, so the
    // sibling's colour would also vanish on reload
    makeDockPanel();
    const first = addTab(
      'notebook-1',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const second = addTab(
      'notebook-2',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const firstWidget = widget('notebook-1');
    const secondWidget = widget('notebook-2');
    const h = activatePlugin({
      fingerprints: {},
      widgets: [firstWidget, secondWidget]
    });
    await flushPromises();
    h.api.claim(secondWidget);
    h.api.setColour(secondWidget, 'mint');
    // What Lumino renders onto the claimed view from its widget title
    second.classList.add('jp-colourful-tab-mint');
    const seen: IColourChoice[] = [];
    h.api.colourChanged.connect((_, choice) => seen.push(choice));

    rightClick(first);
    await h.execute('colourful-tab:set-rose');

    expect(second.classList.contains('jp-colourful-tab-mint')).toBe(true);
    expect(second.classList.contains('jp-colourful-tab-rose')).toBe(false);
    expect(secondWidget.title.className).toBe('jp-colourful-tab-mint');
    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(true);
    expect(seen).toEqual([{ widgetId: 'notebook-1', colourId: 'rose' }]);
    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 0 });

    // A pick on the claimed view itself paints only that view
    rightClick(second);
    await h.execute('colourful-tab:set-sky');

    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(true);
    expect(first.classList.contains('jp-colourful-tab-sky')).toBe(false);
    expect(second.classList.contains('jp-colourful-tab-sky')).toBe(true);
    // The pick is view-local, so the file's entry - the unclaimed view's
    // colour - is kept
    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 0 });

    // The owner paints its colour again; a Clear on the unclaimed view must
    // leave that colour where it is
    h.api.setColour(secondWidget, 'mint');
    second.classList.remove('jp-colourful-tab-sky');
    second.classList.add('jp-colourful-tab-mint');

    rightClick(first);
    await h.execute('colourful-tab:clear');

    expect(second.classList.contains('jp-colourful-tab-mint')).toBe(true);
    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(false);
  });

  it('keeps a shared entry when a pick on a claimed view replaces it', async () => {
    // One file in two views stores one entry for the file. A pick on the
    // claimed view paints only that view, so deleting the shared entry would
    // take the unclaimed view's colour with it on the next reload
    makeDockPanel();
    const first = addTab(
      'notebook-1',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const second = addTab(
      'notebook-2',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const firstWidget = widget('notebook-1');
    const secondWidget = widget('notebook-2');
    const h = activatePlugin({
      fingerprints: {},
      widgets: [firstWidget, secondWidget]
    });
    await flushPromises();

    rightClick(first);
    await h.execute('colourful-tab:set-rose');
    h.api.claim(secondWidget);
    h.api.setColour(secondWidget, 'mint');
    second.classList.add('jp-colourful-tab-mint');

    rightClick(second);
    await h.execute('colourful-tab:set-sky');

    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 0 });
    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(true);

    // A reload: the classes Lumino rendered are gone, so only the stored
    // entry can repaint the unclaimed view
    first.className = 'lm-TabBar-tab';
    second.className = 'lm-TabBar-tab';
    const reloaded = activatePlugin({ fingerprints: {} });
    await flushPromises();
    reloaded.finishRestore();
    await flushPromises();

    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(true);
  });

  it('keeps a shared entry when a Clear on a claimed view replaces it', async () => {
    // Same shared entry, replaced by a Clear this time. The Clear is
    // view-local, so the unclaimed view keeps the colour the entry records
    makeDockPanel();
    const first = addTab(
      'notebook-1',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const second = addTab(
      'notebook-2',
      'Name: x.ipynb\nPath: /home/lab/x.ipynb'
    );
    const firstWidget = widget('notebook-1');
    const secondWidget = widget('notebook-2');
    const h = activatePlugin({
      fingerprints: {},
      widgets: [firstWidget, secondWidget]
    });
    await flushPromises();

    rightClick(first);
    await h.execute('colourful-tab:set-rose');
    h.api.claim(secondWidget);
    h.api.setColour(secondWidget, 'mint');
    second.classList.add('jp-colourful-tab-mint');
    // The observer is what repaints after Lumino rewrites a tab's class;
    // bring it live before the Clear so a repaint would reach the assertion
    h.finishRestore();
    await flushPromises();

    rightClick(second);
    await h.execute('colourful-tab:clear');

    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 0 });
    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(true);
    expect(second.classList.contains('jp-colourful-tab-mint')).toBe(false);
    await flushPromises();
    expect(second.classList.contains('jp-colourful-tab-rose')).toBe(false);

    first.className = 'lm-TabBar-tab';
    second.className = 'lm-TabBar-tab';
    const reloaded = activatePlugin({ fingerprints: {} });
    await flushPromises();
    reloaded.finishRestore();
    await flushPromises();

    expect(first.classList.contains('jp-colourful-tab-rose')).toBe(true);
  });

  it('reads a legacy path: key as the file whose path it was', async () => {
    // A pre-1.1.23 store kept a file's path verbatim. `path:terminal:3` was
    // the file of that name and must not be read as the escaped form of file
    // `terminal:3` - that painted the wrong file and orphaned the rightful one
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'path:terminal:3': 4 }));
    makeDockPanel();
    const terminalNamedFile = addTab(
      'notebook-1',
      'Name: terminal:3\nPath: terminal:3'
    );
    const pathNamedFile = addTab(
      'notebook-2',
      'Name: path:terminal:3\nPath: path:terminal:3'
    );
    const pathThreeFile = addTab('notebook-3', 'Name: path:3\nPath: path:3');
    const h = activatePlugin({ fingerprints: {} });
    await flushPromises();
    h.finishRestore();
    await flushPromises();

    expect(pathNamedFile.classList.contains('jp-colourful-tab-sky')).toBe(true);
    expect(terminalNamedFile.classList.contains('jp-colourful-tab-sky')).toBe(
      false
    );

    // A second legacy key, read on the next load
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'path:3': 5 }));
    terminalNamedFile.className = 'lm-TabBar-tab';
    pathNamedFile.className = 'lm-TabBar-tab';
    pathThreeFile.className = 'lm-TabBar-tab';
    const reloaded = activatePlugin({ fingerprints: {} });
    await flushPromises();
    reloaded.finishRestore();
    await flushPromises();

    expect(pathThreeFile.classList.contains('jp-colourful-tab-lavender')).toBe(
      true
    );
    expect(
      terminalNamedFile.classList.contains('jp-colourful-tab-lavender')
    ).toBe(false);
  });

  it('is repainted before the browser can show the class Lumino rewrote', async () => {
    // Lumino rewrites the class attribute whenever the tab becomes or stops
    // being current. The fake clock holds the 50 ms debounced refresh, so only
    // a repaint inside the observer callback - a microtask, run before the
    // next frame is painted - puts the colour back here
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '/home/lab/x.ipynb': 4 })
    );
    makeDockPanel();
    const tab = addTab('notebook-1', 'Name: x.ipynb\nPath: /home/lab/x.ipynb');
    const h = activatePlugin({ fingerprints: {} });
    await flushPromises();
    h.finishRestore();
    await flushPromises();
    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(true);

    tab.className = 'lm-TabBar-tab';
    await flushPromises();

    expect(tab.classList.contains('jp-colourful-tab-sky')).toBe(true);
  });
});

describe('a colour another window stored', () => {
  // Every browser window open on the same lab writes the one localStorage
  // key. A window that writes back the map it read at activation erases
  // every entry another window stored after that read
  const terminals = [{ widgetId: 'terminal-1', sessionName: '3' }];
  const tab = (widgetId: string): HTMLElement =>
    document.querySelector(`[data-id="${widgetId}"]`) as HTMLElement;
  const terminal = { colour: 2, fp: 'pty-a' };

  it.each([
    {
      operation: 'a pick on a file tab',
      run: async (h: IHarness): Promise<void> => {
        rightClick(tab('notebook-1'));
        await h.execute('colourful-tab:set-sky');
      },
      left: {
        '/home/lab/x.ipynb': 4,
        '/home/lab/y.ipynb': 1,
        'terminal:3': terminal
      }
    },
    {
      operation: 'Clear on a second file tab',
      run: async (h: IHarness): Promise<void> => {
        rightClick(tab('notebook-2'));
        await h.execute('colourful-tab:clear');
      },
      left: { 'terminal:3': terminal }
    },
    {
      operation: 'setColour on an unclaimed tab with a stored entry',
      run: async (h: IHarness): Promise<void> => {
        h.api.setColour(widget('notebook-2'), 'sky');
      },
      left: { 'terminal:3': terminal }
    },
    {
      operation: 'a runningChanged prune',
      run: async (h: IHarness): Promise<void> => {
        h.fingerprintClient.mockResolvedValue({ '3': 'pty-b' });
        h.emitRunning(['3']);
        await flushPromises();
      },
      left: { '/home/lab/y.ipynb': 1 }
    }
  ])('survives $operation', async ({ run, left }) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '/home/lab/y.ipynb': 1, 'terminal:3': terminal })
    );
    makeDockPanel();
    addTab('notebook-1', 'Name: x.ipynb\nPath: /home/lab/x.ipynb');
    addTab('notebook-2', 'Name: y.ipynb\nPath: /home/lab/y.ipynb');
    addTab('terminal-1', '');
    const h = activatePlugin({ fingerprints: { '3': 'pty-a' }, terminals });
    await flushPromises();
    // The other window's write, made after this window read the key
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readStore(), '/home/lab/other.ipynb': 2 })
    );

    await run(h);

    expect(readStore()).toEqual({ ...left, '/home/lab/other.ipynb': 2 });
  });
});

describe('the colour held on the widget title', () => {
  it('a pick made before the path arrives gives way to later picks and Clear', async () => {
    // A document's tab has no path until its model loads, so the first pick
    // is held on the widget title. A later pick or Clear that leaves the title
    // alone is undone the next time Lumino renders the tab from that title
    makeDockPanel();
    const tab = addTab('notebook-1', '');
    const w = widget('notebook-1');
    const h = activatePlugin({ fingerprints: {}, widgets: [w] });
    await flushPromises();

    rightClick(tab);
    await h.execute('colourful-tab:set-rose');
    expect(w.title.className).toBe('jp-colourful-tab-rose');

    tab.setAttribute('title', 'Name: x.ipynb\nPath: /home/lab/x.ipynb');
    rightClick(tab);
    await h.execute('colourful-tab:set-sky');
    expect(w.title.className).toBe('jp-colourful-tab-sky');
    expect(readStore()).toEqual({ '/home/lab/x.ipynb': 4 });

    await h.execute('colourful-tab:clear');
    expect(w.title.className).toBe('');
    expect(readStore()).toEqual({});
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
