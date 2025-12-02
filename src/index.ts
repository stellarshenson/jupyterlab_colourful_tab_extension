import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Colour definitions - CSS classes are defined in style/base.css
 * CSS variables handle light/dark theme switching automatically
 */
const COLOURS = [
  { name: 'Rose', id: 'rose', cssClass: 'jp-colourful-tab-rose' },
  { name: 'Peach', id: 'peach', cssClass: 'jp-colourful-tab-peach' },
  { name: 'Lemon', id: 'lemon', cssClass: 'jp-colourful-tab-lemon' },
  { name: 'Mint', id: 'mint', cssClass: 'jp-colourful-tab-mint' },
  { name: 'Sky', id: 'sky', cssClass: 'jp-colourful-tab-sky' },
  { name: 'Lavender', id: 'lavender', cssClass: 'jp-colourful-tab-lavender' }
];

/**
 * Storage for tab colours (persists for tab lifetime)
 * Maps widget ID to colour index
 */
const tabColours: Map<string, number> = new Map();

/**
 * Currently right-clicked tab element (set by contextmenu event)
 */
let currentTabElement: HTMLElement | null = null;

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
 * Get widget ID from tab element using data-id attribute
 * JupyterLab stores widget ID in title.dataset.id which renders as data-id
 */
function getWidgetIdFromTab(tabElement: HTMLElement): string | null {
  return tabElement.dataset.id || null;
}

/**
 * Find tab element by widget ID using data-id attribute
 */
function findTabByWidgetId(widgetId: string): HTMLElement | null {
  return document.querySelector(
    `#jp-main-dock-panel .lm-TabBar-tab[data-id="${widgetId}"]`
  ) as HTMLElement | null;
}

/**
 * Refresh all tab colours (useful after DOM changes)
 */
function refreshAllTabColours(): void {
  tabColours.forEach((colourIndex, widgetId) => {
    const tabElement = findTabByWidgetId(widgetId);
    if (tabElement) {
      applyTabColour(tabElement, colourIndex);
    }
  });
}

/**
 * Initialization data for the jupyterlab_colourful_tab_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_colourful_tab_extension:plugin',
  description:
    'JupyterLab extension that makes tabs coloured using pastel colours to help identify them when many are open',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log(
      'JupyterLab extension jupyterlab_colourful_tab_extension is activated!'
    );

    const { commands } = app;

    // Track right-clicked tab using capture phase to get it before menu opens
    document.addEventListener(
      'contextmenu',
      (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const tabElement = target.closest('.lm-TabBar-tab') as HTMLElement;
        if (tabElement) {
          currentTabElement = tabElement;
          console.log(
            'Colourful Tab: Right-clicked tab with widget ID:',
            getWidgetIdFromTab(tabElement)
          );
        }
      },
      true // Use capture phase
    );

    // Register colour commands
    COLOURS.forEach((colour, index) => {
      commands.addCommand(`colourful-tab:set-${colour.id}`, {
        label: colour.name,
        caption: `Set tab colour to ${colour.name}`,
        execute: () => {
          console.log(
            `Colourful Tab: Setting colour ${colour.name}, currentTabElement:`,
            currentTabElement
          );
          if (currentTabElement) {
            const widgetId = getWidgetIdFromTab(currentTabElement);
            if (widgetId) {
              tabColours.set(widgetId, index);
              applyTabColour(currentTabElement, index);
              console.log(`Colourful Tab: Applied ${colour.name} to ${widgetId}`);
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
        if (currentTabElement) {
          const widgetId = getWidgetIdFromTab(currentTabElement);
          if (widgetId) {
            clearTabColour(currentTabElement);
            tabColours.delete(widgetId);
            console.log(`Colourful Tab: Cleared colour from ${widgetId}`);
          }
        }
      }
    });

    // Watch for DOM changes to reapply colours (e.g., when tabs are reordered)
    app.restored.then(() => {
      const observer = new MutationObserver(() => {
        refreshAllTabColours();
      });

      const dockPanel = document.getElementById('jp-main-dock-panel');
      if (dockPanel) {
        observer.observe(dockPanel, {
          childList: true,
          subtree: true
        });
      }
    });
  }
};

export default plugin;
