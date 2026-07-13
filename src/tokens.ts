import { Token } from '@lumino/coreutils';
import { Widget } from '@lumino/widgets';

export interface IColourfulTabs {
  /** Tint (or clear) a widget's dock tab. `colourId` is one of the colour ids
   *  'rose' | 'peach' | 'lemon' | 'mint' | 'sky' | 'lavender', or null to
   *  clear. Applied via the widget's Lumino title so it rides tab re-renders;
   *  it does not touch the persistent per-tab colours the context menu keeps. */
  setColour(widget: Widget, colourId: string | null): void;
}

export const IColourfulTabs = new Token<IColourfulTabs>(
  'jupyterlab_colourful_tab_extension:IColourfulTabs'
);
