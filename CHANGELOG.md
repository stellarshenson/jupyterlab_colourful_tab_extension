# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
