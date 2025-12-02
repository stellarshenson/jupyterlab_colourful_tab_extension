import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { LabIcon } from '@jupyterlab/ui-components';

/**
 * Colour definitions - CSS classes are defined in style/base.css
 * CSS variables handle light/dark theme switching automatically
 */
const COLOURS = [
  { name: 'Red', id: 'rose', cssClass: 'jp-colourful-tab-rose' },
  { name: 'Orange', id: 'peach', cssClass: 'jp-colourful-tab-peach' },
  { name: 'Yellow', id: 'lemon', cssClass: 'jp-colourful-tab-lemon' },
  { name: 'Green', id: 'mint', cssClass: 'jp-colourful-tab-mint' },
  { name: 'Blue', id: 'sky', cssClass: 'jp-colourful-tab-sky' },
  { name: 'Purple', id: 'lavender', cssClass: 'jp-colourful-tab-lavender' }
];

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
        widgetToSession.set(widget.id, `terminal:${session.model.name}`);
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
 * Get stable identifier for a tab.
 * - For files: extract Path from title attribute
 * - For terminals: use terminal session name (e.g., "terminal:1")
 */
function getStableTabId(tabElement: HTMLElement): string | null {
  const title = tabElement.getAttribute('title');
  const widgetId = tabElement.dataset.id;

  // For files: title contains "Path: /path/to/file.ipynb"
  if (title && title.includes('Path:')) {
    const pathMatch = title.match(/Path:\s*(.+?)(?:\n|$)/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1].trim();
    }
  }

  // For terminals: use session name which persists across browser refresh
  if (widgetId) {
    const terminalMap = getTerminalSessionMap();
    const sessionId = terminalMap.get(widgetId);
    if (sessionId) {
      return sessionId;
    }
    // Fallback to widget ID for non-terminal widgets
    return widgetId;
  }

  return null;
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
 * Clean up colours for tabs that no longer exist
 */
function cleanupStaleColours(): void {
  const currentTabs = getAllTabsByStableId();
  const staleIds: string[] = [];

  tabColours.forEach((_, storedId) => {
    if (!currentTabs.has(storedId)) {
      staleIds.push(storedId);
    }
  });

  if (staleIds.length > 0) {
    staleIds.forEach(id => tabColours.delete(id));
    saveTabColours();
  }
}

/**
 * Refresh all tab colours (useful after DOM changes)
 */
function refreshAllTabColours(): void {
  const currentTabs = getAllTabsByStableId();

  tabColours.forEach((colourIndex, storedId) => {
    const tabElement = currentTabs.get(storedId);
    if (
      tabElement &&
      !tabElement.classList.contains(COLOURS[colourIndex].cssClass)
    ) {
      applyTabColour(tabElement, colourIndex);
    }
  });

  // Clean up colours for closed tabs
  cleanupStaleColours();
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
 * Apply colour to the active notebook's toolbar based on its tab colour
 */
function applyToolbarColour(): void {
  // Find the currently active tab
  const activeTab = document.querySelector(
    '#jp-main-dock-panel .lm-TabBar-tab.lm-mod-current'
  ) as HTMLElement;
  if (!activeTab) {
    return;
  }

  // Get the stable ID for this tab
  const stableId = getStableTabId(activeTab);
  if (!stableId) {
    return;
  }

  // Get the colour index for this tab
  const colourIndex = tabColours.get(stableId);

  // Find all toolbars and clear their colours first
  const toolbars = document.querySelectorAll('jp-toolbar');
  toolbars.forEach(toolbar => {
    COLOURS.forEach(c => toolbar.classList.remove(c.cssClass));
  });

  // If the active tab has a colour, apply it to the active panel's toolbar
  if (
    colourIndex !== undefined &&
    colourIndex >= 0 &&
    colourIndex < COLOURS.length
  ) {
    // Find the active panel's toolbar - it's in the currently visible notebook panel
    const activePanel = document.querySelector(
      '#jp-main-dock-panel .lm-DockPanel-widget:not(.lm-mod-hidden) jp-toolbar'
    );
    if (activePanel) {
      activePanel.classList.add(COLOURS[colourIndex].cssClass);
    }
  }
}

/**
 * Initialization data for the jupyterlab_colourful_tab_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_colourful_tab_extension:plugin',
  description:
    'JupyterLab extension that makes tabs coloured using pastel colours to help identify them when many are open',
  autoStart: true,
  optional: [ITerminalTracker],
  activate: (app: JupyterFrontEnd, tracker: ITerminalTracker | null) => {
    console.log(
      'JupyterLab extension jupyterlab_colourful_tab_extension is activated!'
    );

    // Store terminal tracker reference for session name lookups
    terminalTracker = tracker;

    // Load persisted colours from localStorage
    loadTabColours();

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
            const stableId = getStableTabId(currentTabElement);
            if (stableId) {
              tabColours.set(stableId, index);
              saveTabColours();
              applyTabColour(currentTabElement, index);
              applyToolbarColour();
            }
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
          const stableId = getStableTabId(currentTabElement);
          if (stableId) {
            clearTabColour(currentTabElement);
            tabColours.delete(stableId);
            saveTabColours();
            applyToolbarColour();
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
  }
};

export default plugin;
