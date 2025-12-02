import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { DockPanel } from '@lumino/widgets';

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
 * Currently right-clicked widget ID (set by contextmenu event)
 */
let currentWidgetId: string | null = null;

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
 * Refresh all tab colours (useful after DOM changes)
 */
function refreshAllTabColours(app: JupyterFrontEnd): void {
  const dockPanel = (app.shell as any).mainDock?.dock as DockPanel | undefined;
  if (!dockPanel) {
    return;
  }

  const tabBars = dockPanel.tabBars();
  for (const tabBar of tabBars) {
    for (let i = 0; i < tabBar.titles.length; i++) {
      const widget = tabBar.titles[i].owner;
      const colourIndex = tabColours.get(widget.id);
      if (colourIndex !== undefined) {
        const tabNodes = tabBar.contentNode.querySelectorAll('.lm-TabBar-tab');
        const tabElement = tabNodes[i] as HTMLElement;
        if (tabElement) {
          applyTabColour(tabElement, colourIndex);
        }
      }
    }
  }
}

/**
 * Find widget ID from tab element
 */
function findWidgetFromTab(
  app: JupyterFrontEnd,
  tabElement: HTMLElement
): string | null {
  const dockPanel = (app.shell as any).mainDock?.dock as DockPanel | undefined;
  if (!dockPanel) {
    return null;
  }

  const tabBars = dockPanel.tabBars();
  for (const tabBar of tabBars) {
    const tabNodes = tabBar.contentNode.querySelectorAll('.lm-TabBar-tab');
    for (let i = 0; i < tabNodes.length; i++) {
      if (tabNodes[i] === tabElement) {
        return tabBar.titles[i].owner.id;
      }
    }
  }
  return null;
}

/**
 * Find tab element by widget ID
 */
function findTabByWidgetId(
  app: JupyterFrontEnd,
  widgetId: string
): HTMLElement | null {
  const dockPanel = (app.shell as any).mainDock?.dock as DockPanel | undefined;
  if (!dockPanel) {
    return null;
  }

  const tabBars = dockPanel.tabBars();
  for (const tabBar of tabBars) {
    for (let i = 0; i < tabBar.titles.length; i++) {
      if (tabBar.titles[i].owner.id === widgetId) {
        const tabNodes = tabBar.contentNode.querySelectorAll('.lm-TabBar-tab');
        return tabNodes[i] as HTMLElement;
      }
    }
  }
  return null;
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
          currentWidgetId = findWidgetFromTab(app, tabElement);
        }
        // Don't reset if not on a tab - keep the last value for the menu
      },
      true // Use capture phase
    );

    // Register colour commands - always enabled since submenu selector handles visibility
    COLOURS.forEach((colour, index) => {
      commands.addCommand(`colourful-tab:set-${colour.id}`, {
        label: colour.name,
        caption: `Set tab colour to ${colour.name}`,
        execute: () => {
          if (currentWidgetId) {
            tabColours.set(currentWidgetId, index);
            const tabElement = findTabByWidgetId(app, currentWidgetId);
            if (tabElement) {
              applyTabColour(tabElement, index);
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
        if (currentWidgetId) {
          const tabElement = findTabByWidgetId(app, currentWidgetId);
          if (tabElement) {
            clearTabColour(tabElement);
          }
          tabColours.delete(currentWidgetId);
        }
      }
    });

    // Watch for DOM changes to reapply colours
    app.restored.then(() => {
      const observer = new MutationObserver(() => {
        refreshAllTabColours(app);
      });

      const shellNode = app.shell.node;
      observer.observe(shellNode, {
        childList: true,
        subtree: true
      });
    });
  }
};

export default plugin;
