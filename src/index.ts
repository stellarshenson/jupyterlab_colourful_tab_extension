import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { LabIcon } from '@jupyterlab/ui-components';
import { COLOURS, setWidgetTabColour } from './colours';
import {
  applyDynamicStyle,
  asDividerContrast,
  buildDynamicCss,
  mergePalette
} from './dynamicStyle';
import { deadTerminalIds, stableTabId } from './identity';
import { IColourfulTabs } from './tokens';

export { IColourfulTabs } from './tokens';

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
 * Maps widget ID to colour index
 */
const tabColours: Map<string, number> = new Map();

/**
 * Load tab colours from localStorage
 */
function loadTabColours(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as Record<string, number>;
      Object.entries(data).forEach(([widgetId, colourIndex]) => {
        tabColours.set(widgetId, colourIndex);
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
    const data: Record<string, number> = {};
    tabColours.forEach((colourIndex, widgetId) => {
      data[widgetId] = colourIndex;
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
 * Drop stored colours for terminal sessions the server no longer lists, so a
 * recycled terminal name starts clear (DEF-6). The server's running list is the
 * authority on death: closing a terminal's TAB while its session keeps running
 * still lists it, so that colour correctly survives.
 */
function pruneDeadTerminalColours(liveNames: string[]): void {
  const dead = deadTerminalIds(tabColours.keys(), liveNames);
  if (dead.length > 0) {
    dead.forEach(id => tabColours.delete(id));
    saveTabColours();
  }
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
 */
function refreshAllTabColours(): void {
  const currentTabs = getAllTabsByStableId();

  tabColours.forEach((colourIndex, storedId) => {
    const tabElement = currentTabs.get(storedId);
    if (
      tabElement &&
      !COLOURS.some(c => tabElement.classList.contains(c.cssClass))
    ) {
      applyTabColour(tabElement, colourIndex);
    }
  });
}

/**
 * Drop the stored menu colour for a widget's tab when the public API takes
 * ownership of it. Without this, a stale localStorage entry under the same
 * stable id (terminal session names are reused) keeps fighting the API colour
 * and resurfaces whenever the API colour is cleared (DEF-5).
 */
function releaseMenuColour(widgetId: string): void {
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

    // Age out colours of terminal sessions the server no longer runs, so a
    // recycled terminal name starts clear (DEF-6). Driven by the server's own
    // running list rather than by tab restoration - the 1.1.3 regression came
    // from a cleanup that ran before tab identifiers had resolved.
    app.serviceManager.terminals.runningChanged.connect((_, models) => {
      pruneDeadTerminalColours(models.map(m => m.name));
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
            currentTabElement &&
            currentTabElement.classList.contains('lm-TabBar-tab')
          ) {
            // Colour the tab either way; persist only when it has a stable
            // identity - storing under a recyclable widget id would re-paint
            // future tabs that reuse the id (DEF-6)
            const stableId = getStableTabId(currentTabElement);
            if (stableId) {
              tabColours.set(stableId, index);
              saveTabColours();
            }
            applyTabColour(currentTabElement, index);
            applyToolbarColour();
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
          // session-only colour and must still be clearable
          const stableId = getStableTabId(currentTabElement);
          if (stableId) {
            tabColours.delete(stableId);
            saveTabColours();
          }
          clearTabColour(currentTabElement);
          applyToolbarColour();
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

    // Public API: let other extensions tint a widget's dock tab via its Lumino
    // title. This rides tab re-renders and stays separate from the menu-driven,
    // localStorage-backed per-tab colours above.
    const api: IColourfulTabs = {
      setColour: (widget, colourId) => {
        if (colourId && widget && !widget.isDisposed) {
          // The API takes ownership of this tab's colour - drop any stored
          // menu colour so the two paths stop fighting over the tab (DEF-5)
          releaseMenuColour(widget.id);
        }
        setWidgetTabColour(widget, colourId);
      }
    };

    return api;
  }
};

export default plugin;
