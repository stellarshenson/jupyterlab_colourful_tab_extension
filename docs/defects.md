# Defects - jupyterlab_colourful_tab_extension

`[ ]` open, `[x]` fixed. Dated notes under each track how it evolved.

## Active tab

- [ ] `DEF-1` **selected-tab accent bar disappears after a few seconds** - MEDIUM; the blue top accent bar (`.lm-TabBar-tab.jp-mod-current::before`, `tabs.css`) vanishes on coloured tabs while they stay selected, so the user cannot tell which tab is current; cause: our public API `setWidgetTabColour` overwrote `widget.title.className` wholesale, but the shell stores the accent by appending `jp-mod-current` to that same property (`shell.js` `_onCurrentChanged`); a consumer (jupyterlab_claude_code_extension) re-tinting on each title/status update destroyed `jp-mod-current`, and Lumino's next render (`createTabClass`) dropped the accent; menu-coloured tabs were unaffected because that path uses the DOM `classList`, not `title.className`; fix: `setWidgetTabColour` now tokenises `title.className`, drops old colour tokens, appends the new one, and preserves everything else; `src/colours.ts`
  - 2026-07-15 reported: "the accent bar disappears from the selected tab after a short while - confuses user, as user doesn't know which tab is selected"; screenshot shows a selected peach terminal tab whose blue accent later vanishes
  - 2026-07-15 hypothesis (WRONG): guessed JupyterLab-core focus behaviour dropping `jp-mod-current`, "not our bug"; user disproved it by testing - non-coloured and launcher tabs keep the accent, only coloured tabs lose it
  - 2026-07-15 root-caused: our API's `title.className =` overwrite destroyed the shell's `jp-mod-current`; triggered when the claude_code consumer re-applies the colour on title changes
  - 2026-07-15 fixed (pending runtime confirmation): non-destructive tokenised swap in `setWidgetTabColour`; jest 11 green incl. 3 accent-preservation tests, build + lint clean; awaiting browser confirmation before marking `[x]`; see [acc-crit Active Tab Colour](acc-crit-jupyterlab-colourful-tab-extension.md#active-tab-colour)
