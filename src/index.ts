import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { LabIcon } from '@jupyterlab/ui-components';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { ISignal, Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import { COLOURS, setWidgetTabColour } from './colours';
import {
  applyDynamicStyle,
  asDividerContrast,
  buildDynamicCss,
  mergePalette
} from './dynamicStyle';
import {
  fetchTerminalFingerprints,
  TerminalFingerprints
} from './fingerprints';
import {
  IStoredColour,
  parseStoredColour,
  stableTabId,
  staleTerminalIds,
  terminalSessionName
} from './identity';
import { IColourChoice, IColourfulTabs } from './tokens';

export { IColourChoice, IColourfulTabs } from './tokens';

/**
 * Create a LabIcon with a coloured square SVG
 * Uses CSS classes for theme-aware colours via CSS variables
 */
function createColourIcon(id: string): LabIcon {
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jp-colourful-tab-icon-${id}">
    <rect x="2" y="2" width="12" height="12" rx="2" class="jp-colourful-tab-icon-rect" stroke="#888" stroke-width="1"/>
  </svg>`;
  return new LabIcon({
    name: `colourful-tab:icon-${id}`,
    svgstr: svgStr
  });
}

/**
 * LocalStorage key for persisting tab colours
 */
const STORAGE_KEY = 'jupyterlab-colourful-tab-colours';

/**
 * Storage for tab colours (persists across refreshes via localStorage)
 * Maps a stable tab id to its stored colour
 */
const tabColours: Map<string, IStoredColour> = new Map();

/**
 * Widget ids whose tab colour another extension owns, counted per widget (see
 * `IColourfulTabs`'s `claim`). A claimed tab is never persisted here, because
 * its owner persists the choice against a durable identity instead, and a pick
 * or a clear on one deletes whatever was stored for it before. It is still
 * repainted from a stored colour, but only from a fingerprint-verified entry.
 *
 * Counted rather than a set because two holders can own the same tab at once -
 * a panel rebuilt over a still-running terminal overlaps its predecessor - and
 * the first to dispose must not release the second's claim. `IColourfulTabs` is
 * public API, so the second holder is not hypothetical either: without the
 * count, one extension's dispose silently hands another extension's tab back to
 * this store, and neither side can see why.
 */
const tabClaims: Map<string, number> = new Map();

/**
 * Live terminal fingerprints, or null while the server has not answered - "no
 * terminals" and "cannot tell" are different states and the prune needs both.
 */
let terminalFingerprints: TerminalFingerprints | null = null;

/**
 * Load tab colours from localStorage
 */
function loadTabColours(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as Record<string, unknown>;
      Object.entries(data).forEach(([tabId, value]) => {
        // Validated rather than cast: everything downstream reads `colour` and
        // `fp` off the entry, so one value of another shape throws on every
        // prune and every repaint (see `parseStoredColour`)
        const entry = parseStoredColour(value, COLOURS.length);
        if (entry) {
          tabColours.set(tabId, entry);
        }
      });
    }
  } catch (e) {
    console.warn('Colourful Tab: Failed to load colours from storage', e);
  }
}

/**
 * Save tab colours to localStorage
 */
function saveTabColours(): void {
  try {
    const data: Record<string, number | IStoredColour> = {};
    tabColours.forEach((entry, tabId) => {
      // Only a fingerprinted entry needs the object shape. A file path is a
      // real identity and carries none, so those entries stay the bare number
      // the format has always used
      data[tabId] = entry.fp ? entry : entry.colour;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Colourful Tab: Failed to save colours to storage', e);
  }
}

/**
 * Currently right-clicked tab element (set by contextmenu event)
 */
let currentTabElement: HTMLElement | null = null;

/**
 * Reference to terminal tracker for getting session names
 */
let terminalTracker: ITerminalTracker | null = null;

/**
 * Build a map from widget ID to terminal session name
 */
function getTerminalSessionMap(): Map<string, string> {
  const widgetToSession = new Map<string, string>();
  if (terminalTracker) {
    terminalTracker.forEach(widget => {
      const session = widget.content?.session;
      if (session?.model?.name) {
        widgetToSession.set(widget.id, session.model.name);
      }
    });
  }
  return widgetToSession;
}

/**
 * Apply colour class to a tab element
 */
function applyTabColour(tabElement: HTMLElement, colourIndex: number): void {
  // Remove all existing colour classes
  COLOURS.forEach(c => tabElement.classList.remove(c.cssClass));

  // Apply new colour class
  if (colourIndex >= 0 && colourIndex < COLOURS.length) {
    tabElement.classList.add(COLOURS[colourIndex].cssClass);
  }
}

/**
 * Clear colour from a tab element
 */
function clearTabColour(tabElement: HTMLElement): void {
  COLOURS.forEach(c => tabElement.classList.remove(c.cssClass));
}

/**
 * Get the identifier a tab's colour is PERSISTED under, or null when the tab
 * has no stable identity (see `stableTabId` for why a widget id is not one).
 */
function getStableTabId(tabElement: HTMLElement): string | null {
  const widgetId = tabElement.dataset.id;
  const sessionName = widgetId
    ? (getTerminalSessionMap().get(widgetId) ?? null)
    : null;
  return stableTabId(tabElement.getAttribute('title'), sessionName);
}

/**
 * True when another extension owns this tab's colour (see `claim`).
 */
function isClaimedTab(tabElement: HTMLElement): boolean {
  const widgetId = tabElement.dataset.id;
  return !!widgetId && tabClaims.has(widgetId);
}

/**
 * Drop stored colours whose terminal incarnation is gone, so a recycled
 * terminal name starts clear (DEF-6). Closing a terminal's TAB while its
 * session keeps running leaves the fingerprint unchanged, so that colour
 * correctly survives.
 */
function pruneStaleTerminalColours(liveNames: string[]): void {
  const stale = staleTerminalIds(tabColours, terminalFingerprints, liveNames);
  if (stale.length === 0) {
    return;
  }
  const currentTabs = getAllTabsByStableId();
  stale.forEach(id => {
    // Deleting the entry does not unpaint the tab. The class was applied when
    // the colour was set and nothing else removes it, so the dead terminal's
    // colour would keep showing on the recycled name for the rest of the
    // session - the visible symptom the prune exists to remove. Only the
    // colour THIS entry painted is cleared: a tab showing another colour is
    // showing it for another reason (the `setColour` API). A CLAIMED tab is
    // exempt, because there the painter is the owner and not this entry: the
    // legacy entry an upgrader carries and the colour the owner painted are
    // routinely the same palette index, so stripping the class here removes the
    // owner's colour and nothing repaints it until the owner's next pass.
    const entry = tabColours.get(id);
    const cssClass = entry ? COLOURS[entry.colour]?.cssClass : undefined;
    const tabElement = currentTabs.get(id);
    if (
      cssClass &&
      tabElement &&
      !isClaimedTab(tabElement) &&
      tabElement.classList.contains(cssClass)
    ) {
      clearTabColour(tabElement);
    }
    tabColours.delete(id);
  });
  saveTabColours();
}

/**
 * Find all current tabs with their stable identifiers
 */
function getAllTabsByStableId(): Map<string, HTMLElement> {
  const idToTab = new Map<string, HTMLElement>();
  const tabs = document.querySelectorAll('#jp-main-dock-panel .lm-TabBar-tab');
  tabs.forEach(tab => {
    const tabElement = tab as HTMLElement;
    const stableId = getStableTabId(tabElement);
    if (stableId) {
      idToTab.set(stableId, tabElement);
    }
  });
  return idToTab;
}

/**
 * True when the stored entry can be tied to the terminal incarnation currently
 * answering to its name.
 *
 * Only a fingerprint match establishes that. With the route unavailable the
 * prune falls back to the running list, which structurally cannot see a
 * recycled name - the name IS running - so a dead terminal's entry survives
 * every prune, and an entry with no fingerprint or a fingerprint that no longer
 * matches is exactly what that leaves behind.
 *
 * A file path is not verifiable this way and does not need to be, so it answers
 * false here and is repainted on the unclaimed path alone.
 */
function isVerifiedEntry(storedId: string, entry: IStoredColour): boolean {
  const name = terminalSessionName(storedId);
  return (
    name !== null &&
    entry.fp !== undefined &&
    entry.fp === terminalFingerprints?.[name]
  );
}

/**
 * Refresh all tab colours (useful after DOM changes).
 *
 * Only paints a stored menu colour onto a tab that currently has NO colour
 * class at all. A tab already showing a colour may be rendering the public
 * `setColour` API's colour (carried in `title.className`), and overwriting it
 * here starts an endless fight: this map repaints on every mutation while
 * Lumino re-renders the title colour on every tab update - the tab visibly
 * flickers between the two colours (DEF-5). Stale map entries (terminal
 * session names are reused by the server) made this hit tabs the user never
 * coloured.
 *
 * A claimed tab carrying no colour class is a tab whose owner has painted
 * nothing - the ordinary case for an owner that holds no colour for what runs
 * there - so the user's stored colour still shows there, but only from a
 * FINGERPRINT-VERIFIED entry. An unverified entry is what a recycled name
 * leaves behind, and painting one onto an assistant's tab is DEF-6 returning by
 * its visual half. The unclaimed path keeps the one guard it has always had:
 * narrowing it there would drop colours set before the fingerprint existed, and
 * every colour at all on a server without the route.
 */
function refreshAllTabColours(): void {
  const currentTabs = getAllTabsByStableId();

  tabColours.forEach((entry, storedId) => {
    const tabElement = currentTabs.get(storedId);
    if (
      !tabElement ||
      COLOURS.some(c => tabElement.classList.contains(c.cssClass))
    ) {
      return;
    }
    if (isClaimedTab(tabElement) && !isVerifiedEntry(storedId, entry)) {
      return;
    }
    applyTabColour(tabElement, entry.colour);
  });
}

/**
 * Drop the stored menu colour for a widget's tab when the public API takes
 * ownership of it. Without this, a stale localStorage entry under the same
 * stable id (terminal session names are reused) keeps fighting the API colour
 * and resurfaces whenever the API colour is cleared (DEF-5). `claim` does NOT
 * drop the entry: it suppresses persistence alone, and the entry is what the
 * tab shows while its owner holds no colour for it and its fingerprint still
 * matches. Returns silently when the tab is not in the DOM, since there is then
 * nothing to resolve a stable id from.
 */
function releaseMenuColour(widgetId: string): void {
  // The shell sets a tab's `data-id` to the widget id
  const tabElement = document.querySelector(
    `#jp-main-dock-panel .lm-TabBar-tab[data-id="${CSS.escape(widgetId)}"]`
  ) as HTMLElement | null;
  if (!tabElement) {
    return;
  }
  const stableId = getStableTabId(tabElement);
  if (stableId && tabColours.has(stableId)) {
    tabColours.delete(stableId);
    saveTabColours();
  }
}

/**
 * Debounce timer for refresh
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced refresh to avoid excessive DOM operations
 */
function debouncedRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshAllTabColours();
    applyToolbarColour();
    refreshTimer = null;
  }, 50);
}

/**
 * Apply colour to each panel's toolbar based on that panel's current tab.
 *
 * Reads the colour from the tab's live class list rather than the menu-driven
 * `tabColours` map, so the toolbar follows colours set either way: the
 * right-click menu and the public `setColour` API (used by consumers like
 * jupyterlab_claude_code_extension) both land as a `jp-colourful-tab-*` class
 * on the tab element (DEF-3). Split layouts have one current tab per tab bar,
 * so each tab is paired with its OWN widget's toolbar via the shared widget id
 * (the shell sets tab `data-id` to the widget id, and Lumino's `Widget.id` is
 * the widget node's DOM id) - a colour never leaks onto another panel's
 * toolbar, and widgets without a toolbar (e.g. terminals) colour none (DEF-4).
 */
function applyToolbarColour(): void {
  // Clear all toolbar colours first
  const toolbars = document.querySelectorAll('jp-toolbar');
  toolbars.forEach(toolbar => {
    COLOURS.forEach(c => toolbar.classList.remove(c.cssClass));
  });

  // Colour each panel's toolbar from its own current tab
  const currentTabs = document.querySelectorAll(
    '#jp-main-dock-panel .lm-TabBar-tab.lm-mod-current'
  );
  currentTabs.forEach(tab => {
    const tabElement = tab as HTMLElement;
    const colour = COLOURS.find(c => tabElement.classList.contains(c.cssClass));
    const widgetId = tabElement.dataset.id;
    if (!colour || !widgetId) {
      return;
    }
    const toolbar = document
      .getElementById(widgetId)
      ?.querySelector('jp-toolbar');
    if (toolbar) {
      toolbar.classList.add(colour.cssClass);
    }
  });
}

/**
 * The public API handed to consumers through `IColourfulTabs`.
 *
 * A class rather than the object literal it replaces because `colourChanged`
 * has to name the API itself as its Lumino sender, which a literal cannot do
 * while it is still being built.
 */
class ColourfulTabs implements IColourfulTabs {
  /** Every menu pick and every clear. This is the ONLY way a consumer learns of
   *  a choice: a stored value is a leftover rather than evidence of a click,
   *  and a pick on a claimed tab is never stored at all. */
  get colourChanged(): ISignal<IColourfulTabs, IColourChoice> {
    return this._colourChanged;
  }

  /** Tint a widget's dock tab via its Lumino title, which rides tab re-renders.
   *  The tint itself is separate from the menu-driven, localStorage-backed
   *  per-tab colours; what it does to the STORED one depends on the claim, as
   *  below. */
  setColour(widget: Widget, colourId: string | null): void {
    if (colourId && widget && !widget.isDisposed && !tabClaims.has(widget.id)) {
      // The API takes ownership of this tab's colour - drop any stored menu
      // colour so the two paths stop fighting over the tab (DEF-5). A CLAIMED
      // tab is exempt: an owner paints the tab it claimed through this very
      // method, and a verified stored colour is what that tab shows whenever
      // the owner holds none for it - deleting here would erase the user's
      // earlier choice on the owner's first paint.
      releaseMenuColour(widget.id);
    }
    setWidgetTabColour(widget, colourId);
  }

  /**
   * Record that another extension persists this tab's colour, until the
   * returned disposable is disposed.
   *
   * The claim suppresses PERSISTENCE: a menu pick on a claimed tab still paints
   * the tab and is still announced through `colourChanged`, but is not written
   * here, because the owner writes it against a durable identity instead. A
   * pick or a clear does DELETE an entry already stored for the tab - the user
   * has just replaced the choice that entry recorded, and keeping it would let
   * it repaint over the new one in the window before the owner has filed it.
   *
   * A stored colour is still restored onto a claimed tab carrying no colour
   * class, which means its owner has painted nothing, but only when the entry's
   * fingerprint matches the terminal now behind its name. The owner's colour
   * therefore wins whenever it has one, a verified earlier choice shows when it
   * does not, and nothing is transferred or copied.
   *
   * Claims are counted, so a second holder keeps the tab owned after the first
   * releases. `DisposableDelegate` runs its callback at most once, so disposing
   * one holder twice releases one claim.
   */
  claim(widget: Widget): IDisposable {
    const widgetId = widget.id;
    tabClaims.set(widgetId, (tabClaims.get(widgetId) ?? 0) + 1);
    return new DisposableDelegate(() => {
      const held = tabClaims.get(widgetId) ?? 0;
      if (held > 1) {
        tabClaims.set(widgetId, held - 1);
      } else {
        tabClaims.delete(widgetId);
      }
    });
  }

  /** Announce a menu pick, or a clear with a null colour id. */
  emitChoice(widgetId: string, colourId: string | null): void {
    this._colourChanged.emit({ widgetId, colourId });
  }

  private _colourChanged = new Signal<IColourfulTabs, IColourChoice>(this);
}

/**
 * Initialization data for the jupyterlab_colourful_tab_extension extension.
 */
const plugin: JupyterFrontEndPlugin<IColourfulTabs> = {
  id: 'jupyterlab_colourful_tab_extension:plugin',
  description:
    'JupyterLab extension that makes tabs coloured using pastel colours to help identify them when many are open',
  autoStart: true,
  provides: IColourfulTabs,
  optional: [ITerminalTracker, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    tracker: ITerminalTracker | null,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log(
      'JupyterLab extension jupyterlab_colourful_tab_extension is activated!'
    );

    // Store terminal tracker reference for session name lookups
    terminalTracker = tracker;

    // Load persisted colours from localStorage
    loadTabColours();

    // Age out colours whose terminal incarnation is gone, so a recycled
    // terminal name starts clear (DEF-6). The fingerprints are the authority
    // here: the running list cannot see a recycled name, because the name is
    // running - it is the substitution behind it that the list cannot report.
    void fetchTerminalFingerprints().then(fingerprints => {
      terminalFingerprints = fingerprints;
      // Without fingerprints the running list is the only evidence of death,
      // and at activation the terminal manager has not necessarily fetched it -
      // pruning against an empty list here would wipe every terminal colour,
      // which is the 1.1.3 regression. With fingerprints the map alone decides,
      // so the list is not consulted.
      if (fingerprints) {
        pruneStaleTerminalColours([]);
      }
    });

    // And again whenever the running set changes. Driven by the server's own
    // running list rather than by tab restoration - the 1.1.3 regression came
    // from a cleanup that ran before tab identifiers had resolved.
    app.serviceManager.terminals.runningChanged.connect((_, models) => {
      const liveNames = models.map(m => m.name);
      void fetchTerminalFingerprints().then(fingerprints => {
        terminalFingerprints = fingerprints;
        pruneStaleTerminalColours(liveNames);
      });
    });

    // Settings drive the palette and the same-colour divider by regenerating
    // an injected <style> element: it redefines the CSS variables every rule
    // reads (tabs, toolbar, menu swatches, icons), so palette edits propagate
    // everywhere without touching style/base.css. `mergePalette` fills in
    // defaults for partial data - the settings composite replaces nested
    // objects wholesale rather than deep-merging, so a user override of one
    // colour arrives without the others. Invalid data never reaches it: the
    // registry validates user settings against the schema first, so a
    // malformed settings file (one mistyped hex is enough) rejects the whole
    // load and lands in the catch below. There the schema defaults are applied
    // instead - the user loses their customisations but keeps the default
    // palette and the default-on divider, rather than the whole feature.
    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          const apply = (): void => {
            applyDynamicStyle(
              buildDynamicCss(
                mergePalette(settings.composite.palette),
                settings.composite.dynamicDivider !== false,
                asDividerContrast(settings.composite.dividerContrast)
              )
            );
          };
          apply();
          settings.changed.connect(apply);
        })
        .catch(err => {
          console.warn('Colourful Tab: failed to load settings', err);
          applyDynamicStyle(buildDynamicCss(mergePalette(undefined), true));
        });
    }

    const { commands } = app;

    // Built before the commands so their handlers can announce the user's
    // choice through it
    const api = new ColourfulTabs();

    // Track right-clicked tab using capture phase to get it before menu opens
    document.addEventListener(
      'contextmenu',
      (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        // Only capture tabs within the main dock panel tab bar
        const tabElement = target.closest(
          '#jp-main-dock-panel .lm-DockPanel-tabBar .lm-TabBar-tab'
        ) as HTMLElement;
        if (tabElement && tabElement.classList.contains('lm-TabBar-tab')) {
          currentTabElement = tabElement;
        }
      },
      true // Use capture phase
    );

    // Register colour commands with icons
    COLOURS.forEach((colour, index) => {
      const icon = createColourIcon(colour.id);
      commands.addCommand(`colourful-tab:set-${colour.id}`, {
        label: colour.name,
        icon: icon,
        caption: `Set tab colour to ${colour.name}`,
        execute: () => {
          // Verify we have a valid tab element
          if (
            !currentTabElement ||
            !currentTabElement.classList.contains('lm-TabBar-tab')
          ) {
            return;
          }
          // Held for the rest of the command: `currentTabElement` is module
          // state that the next right-click overwrites
          const tabElement = currentTabElement;
          const stableId = getStableTabId(tabElement);
          const claimed = isClaimedTab(tabElement);
          // Everything the user's click decides - the paint, the announcement
          // and the write - happens before anything is fetched. Putting the
          // write behind the fetch instead lets a Clear or a second pick made
          // in that window be overwritten by an answer about the first one
          applyTabColour(tabElement, index);
          applyToolbarColour();
          // Emitted claimed or not: for a claimed tab this is the only record
          // of the choice that leaves this extension at all
          const widgetId = tabElement.dataset.id;
          if (widgetId) {
            api.emitChoice(widgetId, colour.id);
          }
          // Persist only when the tab has a stable identity - storing under a
          // recyclable widget id would re-paint future tabs that reuse the id
          // (DEF-6) - and never for a claimed tab, whose owner persists the
          // choice itself. The fingerprint is read from the map the prune keeps
          // rather than fetched here: it is refreshed at activation and on every
          // change to the running set, so a terminal is in it well before its
          // tab can be right-clicked. A name the map does not hold stores the
          // colour unverifiable, which is what an entry set against an
          // unreachable route already does
          if (stableId && !claimed) {
            const name = terminalSessionName(stableId);
            const fp = name === null ? undefined : terminalFingerprints?.[name];
            tabColours.set(
              stableId,
              fp === undefined ? { colour: index } : { colour: index, fp }
            );
            saveTabColours();
          } else if (stableId && tabColours.has(stableId)) {
            // A claimed tab stores nothing new, but an entry already held for
            // it records the very choice this pick replaces. Kept, it repaints
            // over the new colour as soon as Lumino rebuilds the tab's class
            // attribute from the widget title, because the owner has not filed
            // the new one yet - it holds the choice pending while the
            // conversation is unreadable. Superseded state, deleted as such
            tabColours.delete(stableId);
            saveTabColours();
          }
        }
      });
    });

    // Register clear command
    commands.addCommand('colourful-tab:clear', {
      label: 'Clear',
      caption: 'Remove tab colour',
      execute: () => {
        // Verify we have a valid tab element
        if (
          currentTabElement &&
          currentTabElement.classList.contains('lm-TabBar-tab')
        ) {
          // Clear the tab either way - a tab with no stable identity carries a
          // session-only colour and must still be clearable. A claimed tab is
          // not exempted from the delete, for the same reason a pick on one
          // deletes: the entry records the choice this clear replaces, and
          // keeping it would repaint it over the cleared tab as soon as Lumino
          // rebuilds the class attribute from the widget title
          const stableId = getStableTabId(currentTabElement);
          if (stableId) {
            tabColours.delete(stableId);
            saveTabColours();
          }
          clearTabColour(currentTabElement);
          applyToolbarColour();
          const widgetId = currentTabElement.dataset.id;
          if (widgetId) {
            api.emitChoice(widgetId, null);
          }
        }
      }
    });

    // Watch for DOM changes to reapply colours (e.g., when tabs are reordered or classes reset)
    app.restored.then(() => {
      const observer = new MutationObserver(mutations => {
        // Check if any mutation affects tab elements
        const affectsTabs = mutations.some(mutation => {
          // Check for class attribute changes on tabs
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'class'
          ) {
            const target = mutation.target as HTMLElement;
            return target.classList.contains('lm-TabBar-tab');
          }
          // Check for child list changes in tab bars
          if (mutation.type === 'childList') {
            const target = mutation.target as HTMLElement;
            return (
              target.classList.contains('lm-TabBar-content') ||
              target.closest('.lm-TabBar') !== null
            );
          }
          return false;
        });

        if (affectsTabs) {
          debouncedRefresh();
        }
      });

      const dockPanel = document.getElementById('jp-main-dock-panel');
      if (dockPanel) {
        observer.observe(dockPanel, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class']
        });

        // Initial application of colours
        refreshAllTabColours();
        applyToolbarColour();
      }
    });

    return api;
  }
};

export default plugin;
