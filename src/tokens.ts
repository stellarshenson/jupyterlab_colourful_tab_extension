import { Token } from '@lumino/coreutils';
import { IDisposable } from '@lumino/disposable';
import { ISignal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

/** A colour the user picked on a tab, or cleared from it. */
export interface IColourChoice {
  /** Id of the widget whose tab the choice was made on. */
  widgetId: string;
  /** The colour id - 'rose' | 'peach' | 'lemon' | 'mint' | 'sky' | 'lavender' -
   *  or null when the colour was cleared. The id string and never the palette
   *  index, so a consumer does not break when the palette is reordered or
   *  extended. */
  colourId: string | null;
}

export interface IColourfulTabs {
  /** Tint (or clear) a widget's dock tab. `colourId` is one of the colour ids
   *  'rose' | 'peach' | 'lemon' | 'mint' | 'sky' | 'lavender', or null to
   *  clear. Applied via the widget's Lumino title so it rides tab re-renders.
   *  On an UNCLAIMED tab it also drops any colour the context menu had stored
   *  for that tab, so the two do not fight over it; on a claimed tab the stored
   *  colour is left where it is, since that is what the tab shows whenever the
   *  claim's owner holds no colour for it and the entry is still verified. */
  setColour(widget: Widget, colourId: string | null): void;

  /** Every colour picked from the context menu and every clear, whether or not
   *  the tab is claimed. A consumer cannot read a choice out of storage
   *  instead: a stored value is a leftover rather than evidence of a click, and
   *  a claimed tab is never written there at all. */
  readonly colourChanged: ISignal<IColourfulTabs, IColourChoice>;

  /** Declare that another extension persists this tab's colour. The claim
   *  suppresses PERSISTENCE: the context menu still paints a claimed tab and
   *  still emits `colourChanged`, but writes nothing here, because the owner
   *  writes the choice against a durable identity instead. A pick or a clear
   *  does delete an entry already stored for the tab, since the user has just
   *  replaced the choice that entry recorded and keeping it would repaint it
   *  over the new one before the owner has filed it.
   *
   *  A stored colour is still restored onto a tab that carries no colour class -
   *  the guard that has always been there - which for a claimed tab means its
   *  owner has painted nothing. On a claimed tab it must also still match the
   *  fingerprint of the terminal now behind its name, because an unverified
   *  entry is what a recycled terminal name leaves behind. The owner's colour
   *  therefore wins whenever it has one, and a verified earlier choice of the
   *  user's shows when it does not. Nothing is transferred and no second copy of
   *  the colour is made: the entry stays where it is, is pruned when the
   *  terminal behind it dies, and `setColour` on a claimed tab does not drop it.
   *
   *  Claims are counted, so the tab stays owned until every holder has
   *  disposed; dispose the return value to release one. */
  claim(widget: Widget): IDisposable;
}

export const IColourfulTabs = new Token<IColourfulTabs>(
  'jupyterlab_colourful_tab_extension:IColourfulTabs'
);
