/**
 * Unit tests for the settings load-failure fallback in the plugin activation
 */
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Token } from '@lumino/coreutils';

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

import plugin from '../index';
import { buildDynamicCss, mergePalette } from '../dynamicStyle';

/** Drain the microtask queue so promise handlers settle. */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('settings load failure fallback', () => {
  it('applies default palette and divider when settingRegistry.load rejects', async () => {
    // The registry validates raw user settings before composing, so a single
    // invalid field in a hand-edited settings file rejects the whole load.
    // The catch must degrade to the schema defaults (default palette, divider
    // on) rather than to feature-off.
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    // Only the members activate touches are stubbed; restored never resolves
    // so the MutationObserver wiring stays out of this test.
    const app = {
      serviceManager: {
        terminals: { runningChanged: { connect: jest.fn() } }
      },
      commands: { addCommand: jest.fn() },
      restored: new Promise<void>(() => undefined)
    } as unknown as JupyterFrontEnd;
    const settingRegistry = {
      load: jest.fn().mockRejectedValue(new Error('schema validation failed'))
    } as unknown as ISettingRegistry;

    plugin.activate(app, null, settingRegistry);
    await flushPromises();

    expect(warn).toHaveBeenCalled();
    const style = document.getElementById('jp-colourful-tab-dynamic-style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toEqual(
      buildDynamicCss(mergePalette(undefined), true)
    );
    // The default-on divider rules must survive the rejected load
    expect(style?.textContent).toContain('border-right-color');
    log.mockRestore();
    warn.mockRestore();
  });
});
