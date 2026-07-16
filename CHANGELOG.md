# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## 1.1.11

### Changed

- Darkened the dark-theme inactive (base) tab colours by about 13% (e.g. rose `#5a3840` to `#4e3138`) - they were too bright next to the dark chrome; the active (selected) shades are unchanged and remain visibly darker than the new base, preserving the selected-tab distinction

## 1.1.10

### Fixed

- API-tinted tabs no longer flicker between two colours - the stored right-click menu colours never overwrite a tab that already shows a colour, and setting a colour through the public `setColour` API now removes any stored menu colour for that tab; previously a stale menu colour saved under a reused terminal session name kept fighting the API colour on every tab update (visible as e.g. brown/blue flicker) and attached itself to new terminals the user never coloured

## 1.1.9

### Fixed

- Tab colours no longer bleed onto other panels in split layouts - the toolbar strip is now paired with its own panel's current tab (matched via the shared widget id), so a coloured tab in one split never paints the toolbar of a different widget; previously an API-tinted terminal (which has no toolbar of its own) always painted its colour onto another panel's toolbar, e.g. the notebook beside it

## 1.1.8

### Fixed

- A tab tinted through the public `setColour` API (for example by jupyterlab_claude_code_extension when restoring a conversation) now also colours the toolbar strip below it, not just the tab; the toolbar colour is read from the tab's live class so it follows both the right-click menu and the API, instead of only the menu

## 1.1.7

### Fixed

- The current tab's toolbar (the coloured strip directly below the tab) again matches the tab's colour - a regression from 1.1.5, which gave the selected tab a distinct shade but left its toolbar on the base shade, so the strip below the active tab looked uncoloured; the toolbar now takes the same active shade as its tab

## 1.1.6

### Fixed

- Selected-tab accent bar no longer disappears on coloured tabs - the public `setColour` API now preserves the shell's `jp-mod-current` current-tab class (and any other tab title class) instead of overwriting it, so a tab tinted by another extension keeps its selection accent when re-tinted

## 1.1.5

### Added

- Selected (active) dock tab now renders a distinct shade of its colour - brighter/more saturated in the light theme, darker in the dark theme - so the current coloured tab stands out from inactive coloured tabs

## 1.1.4

### Changed

- Maintenance re-release; no functional changes since 1.1.3

## 1.1.3

### Fixed

- Tab colours no longer disappear after visiting the JupyterHub control panel and returning to JupyterLab - removed the restore-time cleanup that deleted colours from localStorage before tab identifiers had resolved

### Changed

- Build tooling: adopted the canonical Makefile (v1.34) that uses a project-local `.nodeenv/` instead of overwriting the conda node prefix, fixing intermittent "Text file busy" publish failures

## 1.0.20

### Added

- Public `IColourfulTabs` token so other extensions can tint a widget's dock tab programmatically via `setColour(widget, colourId)`
- `@lumino/coreutils` dependency and `sharedPackages` federation singleton so the token resolves to one runtime instance across extensions
- Extension API section in README documenting the token and usage
- Unit tests for the token id and `setColour` behaviour (id→class mappings, clear on null/unknown, disposed-widget guard)

### Changed

- Extracted `COLOURS` and the tab-tinting logic into `src/colours.ts` (imports only `@lumino/widgets`) to decouple the testable API from the JupyterLab-heavy plugin module

## 1.0.15

### Theme-Aware Colour Icons

- Added coloured square icons next to each colour option in context menu
- Icons use CSS variables for automatic light/dark theme switching
- Added `@jupyterlab/ui-components` dependency for `LabIcon`
- Created `createColourIcon()` function with CSS class-based SVG fill

## 1.0.10

### Screenshots and Documentation

- Added screenshots to README showing coloured tabs and context menu
- Added self-deprecating comment to README
- Fixed prettier formatting for CI lint check

### CI/CD Fixes

- Fixed `package.json` repository URL for npm release check
- Added `homepage` and `bugs.url` fields
- Fixed CSS lint errors (modern color notation, empty lines before rules)

## 1.0.9

### Dark Mode Colours

- Darkened all dark theme colours for better visibility
- Rose: `#5a3840`, Peach: `#5a4a3a`, Lemon: `#5a563a`
- Mint: `#3a5a3f`, Sky: `#2e4258`, Lavender: `#4a3a5a`

### CI/CD Updates

- Updated `build.yml` to match reference project workflow
- Python version updated to 3.12
- Removed server extension checks (frontend-only extension)
- Added `ignore_links` for badge URLs in link checker

### README Updates

- Updated features to accurately describe context menu colour selection
- Listed available colours and key features
- Documented toolbar colouring and persistence

## 1.0.7

### Toolbar Colouring

- Notebook toolbar now matches the active tab colour
- Added `applyToolbarColour()` function that syncs toolbar with tab colour
- Toolbar colour updates on tab switch, colour application, and initial load

## 1.0.3

### Colour Persistence Across Browser Refresh

- Tab colours now persist across browser refreshes via localStorage
- Files identified by path extracted from title attribute
- Terminals identified by session name via `ITerminalTracker`
- Added `@jupyterlab/terminal` dependency
- Added cleanup function for colours of closed tabs
- Renamed colour labels to base colours (Red, Orange, Yellow, Green, Blue, Purple)
- Adjusted light theme blue (`#a8d4f0`) and dark theme colours for better visibility

## 0.1.12

### Colour Persistence on Tab Switch

- Fixed colours disappearing when switching tabs due to JupyterLab re-rendering
- Enhanced MutationObserver to watch for class attribute changes on tabs
- Added 50ms debouncing via `debouncedRefresh()` to batch rapid DOM changes
- Smart mutation filtering only reacts to relevant tab changes

## 0.1.11

### Tab Colour Application Fix

- Fixed colours not being applied to tabs
- Refactored to use JupyterLab's `data-id` attribute on tab elements
- Removed DockPanel import (private API)
- Stores tab element reference directly from contextmenu event

## 0.1.10

### Initial Release

- Right-click context menu with "Tab Colour" submenu
- Six pastel colours: Rose, Peach, Lemon, Mint, Sky, Lavender
- Theme-aware colours for light and dark modes
- CSS variable-based colour definitions using `[data-jp-theme-light='false']` selector
- Removed server extension components (frontend-only)

<!-- <END NEW CHANGELOG ENTRY> -->
