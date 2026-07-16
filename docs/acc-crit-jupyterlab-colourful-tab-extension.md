# Acceptance Criteria - jupyterlab_colourful_tab_extension

Consolidated acceptance criteria for the extension. One `##` section per feature.

## Contents

- [Active Tab Colour](#active-tab-colour)

## Active Tab Colour

The selected dock tab (`.lm-mod-current`) carrying a colour class renders a distinct shade of that colour so it stands out from inactive coloured tabs. Dark theme = darker shade, light theme = brighter/more saturated shade. Implemented in `style/base.css` via per-colour `--jp-colourful-tab-<id>-active` variables and `.lm-mod-current.jp-colourful-tab-<id>` rules.

- [x] **Active variables (light)** - `:root` defines `--jp-colourful-tab-<id>-active` for all six colours, brighter/more saturated than the base
  - log: 2026-07-15 implemented
- [x] **Active variables (dark)** - `[data-jp-theme-light='false']` defines `--jp-colourful-tab-<id>-active` for all six colours, darker than the base
  - log: 2026-07-15 implemented
- [x] **Rule per colour** - `.lm-mod-current.jp-colourful-tab-<id>` sets background to the `-active` variable for rose, peach, lemon, mint, sky, lavender
  - log: 2026-07-15 implemented
- [x] **Coverage** - each active rule covers the tab element and its descendants (`*`); no `::part(positioning-region)` rule (dead for the active state - only web-component toolbars expose that part and they never carry `.lm-mod-current`)
  - log: 2026-07-15 implemented
  - log: 2026-07-15 removed dead active `::part` rules after CSS-correctness adversarial review
  - log: 2026-07-15 correction - the removed rules were dead (toolbar never carries `.lm-mod-current`), but dropping toolbar handling entirely left the current widget's toolbar on the base shade (DEF-2); the toolbar now gets the active shade via `jp-toolbar`-scoped rules instead of `.lm-mod-current` ones
- [x] **Specificity** - active selector (2 classes) overrides the base colour rule (1 class); both `!important`, so the current tab resolves to the active shade
  - log: 2026-07-15 implemented
- [x] **Build and lint** - `jlpm build` compiles and `jlpm run lint:check` (stylelint + prettier + eslint) passes with the new rules
  - log: 2026-07-15 verified
- [x] **Design decision: dark active is darker (recedes toward chrome)** - dark-theme active shade is deliberately darker than the base per explicit request; UX/contrast review flagged this as inverting the usual "current tab advances" cue (active fill 1.2-1.66:1 vs dark chrome, inactive base tabs pop more) but legibility stays safe (light-text contrast improves on selection); intentional - do not silently flip to lighter
  - log: 2026-07-15 kept darker per user decision after adversarial UX review
- [ ] **Accent preserved on API tint** - applying or clearing a colour via the public `setColour` API preserves the shell's `jp-mod-current` accent class (and any other `title.className` token); only the `jp-colourful-tab-*` token is swapped, so the selected-tab accent bar survives consumer re-tints (DEF-1)
  - log: 2026-07-15 fixed - `setWidgetTabColour` tokenises `title.className` instead of overwriting it; unit-tested, runtime confirmation pending
- [ ] **Toolbar matches active shade** - the current widget's `jp-toolbar` (the `::part(positioning-region)` strip below the tab) renders the `-active` shade so it matches the active tab, not the base shade; `jp-toolbar`-scoped rules override the base `::part` rule without affecting tabs (DEF-2)
  - log: 2026-07-15 fixed - added six `jp-toolbar.jp-colourful-tab-<id>` `-active` rules; runtime confirmation pending
- [ ] **Toolbar follows API colours** - a tab tinted via the public `setColour` API (not just the right-click menu) also colours its toolbar; `applyToolbarColour` reads the colour from the active tab's live `classList`, which both paths set, not from the menu-only `tabColours` map (DEF-3)
  - log: 2026-07-15 fixed - `applyToolbarColour` derives colour from the tab class; runtime confirmation pending
- [ ] **Toolbar pairs with its own panel** - in split layouts each panel's toolbar takes the colour of that panel's own current tab, matched via the shared widget id (tab `data-id` = widget node `id`); a coloured tab never paints another panel's toolbar, and widgets without a toolbar (terminals) colour nothing (DEF-4)
  - log: 2026-07-16 fixed - `applyToolbarColour` pairs each current tab with its own widget's toolbar; runtime confirmation pending
- [ ] **Inactive unchanged** - a coloured tab without `.lm-mod-current` keeps its base shade
  - log: 2026-07-15 implemented, pending runtime verification
- [ ] **Visual dark** - selected coloured tab renders visibly darker than its inactive siblings in the dark theme
  - log: 2026-07-15 pending runtime verification
- [ ] **Visual light** - selected coloured tab renders visibly brighter/more saturated than its inactive siblings in the light theme
  - log: 2026-07-15 pending runtime verification
- [ ] **Text legibility** - tab label stays readable against the active shade in both themes
  - log: 2026-07-15 pending runtime verification
- [ ] **Selection follows focus** - switching the active tab moves the active shade to the newly-selected tab and restores the previous tab to its base shade
  - log: 2026-07-15 pending runtime verification
- [ ] **Edge: active tab has no colour** - selecting an uncoloured tab shows no active shade (no colour class present, rules do not match)
  - log: 2026-07-15 implemented, pending runtime verification
- [ ] **Edge: theme switch while active** - toggling light/dark re-resolves the `-active` variable so the active tab follows the new theme
  - log: 2026-07-15 implemented, pending runtime verification
- [ ] **Edge: toolbar shade** - the active notebook's `jp-toolbar` keeps the base colour, not the `-active` shade, since only `.lm-mod-current` tabs match the active rule; confirm acceptable
  - log: 2026-07-15 known behaviour, pending confirmation
