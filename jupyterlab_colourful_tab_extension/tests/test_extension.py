"""Test extension loading."""
import pytest


def test_extension_import():
    """Test that the extension can be imported."""
    import jupyterlab_colourful_tab_extension
    assert jupyterlab_colourful_tab_extension is not None


def test_labextension_paths():
    """Test that labextension paths are defined."""
    from jupyterlab_colourful_tab_extension import _jupyter_labextension_paths
    paths = _jupyter_labextension_paths()
    assert len(paths) == 1
    assert paths[0]["dest"] == "jupyterlab_colourful_tab_extension"
