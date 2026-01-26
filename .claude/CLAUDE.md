<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file imports workspace-level configuration from `/home/lab/workspace/.claude/CLAUDE.md`.
All workspace rules apply. Project-specific rules below strengthen or extend them.

The workspace `/home/lab/workspace/.claude/` directory contains additional instruction files
(MERMAID.md, NOTEBOOK.md, DATASCIENCE.md, GIT.md, JUPYTERLAB_EXTENSION.md, and others) referenced by CLAUDE.md.
Consult workspace CLAUDE.md and the .claude directory to discover all applicable standards.

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`npm install`/`jlpm install`
- **No automatic git commits or pushes** - only when user explicitly requests

## Project Context

JupyterLab extension that applies persistent pastel colours to tabs for visual identification when multiple tabs are open. Colours persist across browser refresh using localStorage with stable file path and terminal session identifiers.

**Technology Stack**:

- TypeScript frontend extension (no server component)
- JupyterLab 4.x
- localStorage for colour persistence
- CSS custom properties for theme-aware colours

**Package Names**:

- npm: `jupyterlab_colourful_tab_extension`
- PyPI: `jupyterlab-colourful-tab-extension`
- GitHub: `stellarshenson/jupyterlab_colourful_tab_extension`

## Extension-Specific Rules

- Follow JUPYTERLAB_EXTENSION.md for CI/CD, jupyter-releaser, and build processes
- Test with `make install` after changes
- Colour definitions live in `style/base.css` as CSS custom properties
- Tab identification logic in `src/index.ts` uses file paths and terminal session names
