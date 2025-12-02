# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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

### Colour Persistence

- Tab colours now persist across browser refreshes via localStorage
- Files identified by path extracted from title attribute
- Terminals identified by session name via `ITerminalTracker`
- Added cleanup function for colours of closed tabs
- Renamed colour labels to base colours (Red, Orange, Yellow, Green, Blue, Purple)

## 1.0.0

### Initial Release

- Right-click context menu with "Tab Colour" submenu
- Six pastel colours: Rose, Peach, Lemon, Mint, Sky, Lavender
- Theme-aware colours for light and dark modes
- CSS variable-based colour definitions
- MutationObserver for colour persistence during tab switches
- Debounced refresh to prevent excessive DOM operations

<!-- <END NEW CHANGELOG ENTRY> -->
