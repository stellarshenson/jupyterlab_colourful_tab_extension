"""Who may read the terminal fingerprint route.

The route lists every terminal the server runs and the pid behind each one.
That is server state, so only an authenticated caller gets it - including on a
server that lets anonymous requests through to handlers that do not ask for a
user, which is jupyter_server's default.
"""
from __future__ import annotations

import json

import pytest
import tornado


URL = "colourful-tab"


@pytest.fixture
def jp_server_config(jp_server_config):
    """The repository conftest denies anonymous access on every endpoint, so
    there the server refuses an anonymous request before the route's own
    decorator is consulted and a route without one would pass unnoticed. Under
    jupyter_server's default only ``@tornado.web.authenticated`` on the route
    stands between an anonymous caller and the terminal list."""
    jp_server_config["ServerApp"]["allow_unauthenticated_access"] = True
    return jp_server_config


async def test_an_anonymous_request_is_refused(jp_fetch):
    # ACC-FPRINT-39: the route requires authentication
    with pytest.raises(tornado.httpclient.HTTPClientError) as excinfo:
        await jp_fetch(URL, "terminals", headers={"Authorization": ""})
    assert excinfo.value.code == 403


async def test_an_authenticated_request_is_answered(jp_fetch):
    # ACC-FPRINT-39: the same server answers the token holder, so the refusal
    # above is about the caller and not about the route
    response = await jp_fetch(URL, "terminals")
    assert response.code == 200
    assert isinstance(json.loads(response.body)["terminals"], dict)
