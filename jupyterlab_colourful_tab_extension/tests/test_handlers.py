"""The terminal fingerprint route, over a live jupyter_server.

A terminal name is a slot, not an identity: terminado hands a closed terminal's
name to the next terminal created, so a colour stored against the name paints a
terminal whose user never chose it. Everything asserted here is about telling
one incarnation from the next, and about not taking the server down while doing
it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
import tornado

from jupyterlab_colourful_tab_extension import handlers


URL = "colourful-tab"


class _FakePty:
    """A registered terminal as terminado holds one - an object carrying the
    ``ptyproc`` whose pid identifies this incarnation."""

    def __init__(self, pid: int) -> None:
        self.ptyproc = self
        self.pid = pid


class _ClosingPty:
    """A registry entry whose pty has already gone.

    The manager holds the entry for a moment after the process exits, so the
    route must answer for the terminals around it rather than fail.
    """

    ptyproc = None


class _FakeTerminalManager:
    """A terminal manager whose ``get_terminal`` is a landmine.

    ``get_terminal`` is get-OR-CREATE in both terminado's NamedTermManager and
    jupyter_server_terminals' TerminalManager, and a terminal born that way
    lacks the ``last_activity`` attribute ``TerminalManager.list()`` reads - one
    call makes ``GET /api/terminals`` 500 for every client of the server until
    it restarts. Raising turns that regression into a red test instead of a dead
    server.
    """

    def __init__(self, terminals: dict | None = None) -> None:
        self.terminals = dict(terminals or {})

    def get_terminal(self, name):
        raise AssertionError("get_terminal is get-or-create and must never be called")


class _RegistrylessManager:
    """A manager of a shape this route cannot read."""

    def get_terminal(self, name):
        raise AssertionError("get_terminal is get-or-create and must never be called")


async def error_of(jp_fetch, *path) -> tuple[int, str]:
    """The status and ``error`` token of a refused request."""
    with pytest.raises(tornado.httpclient.HTTPClientError) as excinfo:
        await jp_fetch(*path)
    body = json.loads(excinfo.value.response.body)
    return excinfo.value.code, body.get("error")


def test_a_command_name_with_spaces_does_not_shift_the_start_time_field():
    """Field 2 of ``/proc/<pid>/stat`` is unescaped and can contain anything.

    A plain whitespace split returns some other process attribute as the start
    time, and the fingerprint then changes whenever that attribute changes -
    which drops a live terminal's colour on a poll that should have matched.
    """
    fields = " ".join(str(n) for n in range(3, 30))
    assert handlers._starttime_field(f"4242 (odd ) name) {fields}") == "22"


def test_a_stat_line_too_short_to_carry_the_field_is_not_guessed_at():
    assert handlers._starttime_field("4242 (bash) S 1 2 3") is None


def test_a_pid_proc_cannot_answer_for_degrades_to_the_bare_pid():
    """The open() failure is the only guard on the start time.

    A pid with no ``/proc`` entry - one that has exited, or any pid at all on a
    server without ``/proc`` - must leave the terminal fingerprinted by its pid
    rather than raise out of the route.
    """
    absent = 2 ** 30
    assert handlers._process_starttime(absent) is None
    assert handlers._fingerprint(absent) == str(absent)


@pytest.mark.skipif(sys.platform != "linux", reason="fingerprints need /proc")
async def test_the_fingerprint_pairs_the_pid_with_its_start_time(
    jp_fetch, jp_serverapp, monkeypatch
):
    """The pid alone is a slot too - the operating system reuses it."""
    pid = os.getpid()
    raw = Path(f"/proc/{pid}/stat").read_text()
    starttime = raw[raw.rindex(")") + 1:].split()[19]
    manager = _FakeTerminalManager({"1": _FakePty(pid)})
    monkeypatch.setitem(jp_serverapp.web_app.settings, "terminal_manager", manager)

    response = await jp_fetch(URL, "terminals")

    payload = json.loads(response.body)
    assert payload == {"terminals": {"1": f"{pid}:{starttime}"}}


async def test_a_terminal_without_a_pty_is_absent_rather_than_fatal(
    jp_fetch, jp_serverapp, monkeypatch
):
    """One dead terminal must not cost the others their fingerprints."""
    manager = _FakeTerminalManager(
        {"1": _FakePty(os.getpid()), "2": _ClosingPty()}
    )
    monkeypatch.setitem(jp_serverapp.web_app.settings, "terminal_manager", manager)

    response = await jp_fetch(URL, "terminals")

    payload = json.loads(response.body)
    assert response.code == 200
    assert list(payload["terminals"]) == ["1"]


async def test_no_terminal_manager_answers_503_rather_than_no_terminals(
    jp_fetch, jp_serverapp, monkeypatch
):
    """An empty map would read as "no terminals exist" and make the client drop
    every stored colour on a server that merely has terminals turned off."""
    monkeypatch.setitem(jp_serverapp.web_app.settings, "terminal_manager", None)

    assert await error_of(jp_fetch, URL, "terminals") == (
        503,
        "terminal_service_unavailable",
    )


async def test_a_manager_without_a_registry_answers_503(
    jp_fetch, jp_serverapp, monkeypatch
):
    """Same reason, one shape further in: a manager this route cannot read is
    not a server with no terminals."""
    monkeypatch.setitem(
        jp_serverapp.web_app.settings, "terminal_manager", _RegistrylessManager()
    )

    assert await error_of(jp_fetch, URL, "terminals") == (
        503,
        "terminal_registry_unavailable",
    )


async def test_the_route_never_creates_a_terminal(
    jp_fetch, jp_serverapp, monkeypatch
):
    """The registry is read directly (DEF-32 in the sibling extension).

    ``get_terminal`` on the fake raises, so any route that reaches for it fails
    here instead of spawning a terminal without ``last_activity`` and taking
    ``GET /api/terminals`` down for every client of the server.
    """
    manager = _FakeTerminalManager({"1": _FakePty(os.getpid())})
    monkeypatch.setitem(jp_serverapp.web_app.settings, "terminal_manager", manager)

    response = await jp_fetch(URL, "terminals")

    assert response.code == 200
    assert list(manager.terminals) == ["1"]
