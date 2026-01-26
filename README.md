# jupyterlab_colourful_tab_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_colourful_tab_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_colourful_tab_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_colourful_tab_extension.svg)](https://www.npmjs.com/package/jupyterlab_colourful_tab_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-colourful-tab-extension.svg)](https://pypi.org/project/jupyterlab-colourful-tab-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-colourful-tab-extension)](https://pepy.tech/project/jupyterlab-colourful-tab-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

> [!TIP]
> This extension is part of the [stellars_jupyterlab_extensions](https://github.com/stellarshenson/stellars_jupyterlab_extensions) metapackage. Install all Stellars extensions at once: `pip install stellars_jupyterlab_extensions`

A JupyterLab extension that applies pastel colours to tabs for visual identification when many tabs are open.

Coloured tabs make it easy to identify different notebooks and files at a glance.

![](.resources/screenshot-tabs.png)

Right-click any tab to select a colour from the "Tab Colour" submenu.

![](.resources/screenshot-menu.png)

## Features

Assign colours to tabs via right-click context menu for easy visual identification when working with multiple notebooks and files.

**Colour options**:

- Red, Orange, Yellow, Green, Blue, Purple
- Pastel shades optimised for both light and dark themes

**Key features**:

- Right-click any tab to assign a colour from the "Set Tab Colour" submenu
- Colours persist across browser refreshes via localStorage
- Notebook toolbar matches the active tab colour
- Automatic cleanup when tabs are closed

Yes, this is yet another mass-produced JupyterLab extension that does one trivially simple thing. We are almost embarrassed by how utterly unremarkable it is - just some CSS classes and a context menu. But someone had to do it, and here we are. You're welcome.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab_colourful_tab_extension
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab_colourful_tab_extension
```
