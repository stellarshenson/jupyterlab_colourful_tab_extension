"""Tornado API handler reporting each terminal's pty incarnation.

A browser cannot tell one terminal incarnation from another. Terminado's
``_next_available_name`` hands a closed terminal's name to the next terminal
created, and the model behind ``GET /api/terminals`` carries ``name`` and
``last_activity`` only - ``last_activity`` moves forward for a reused name
exactly as it does for a busy one, so no amount of client-side comparison can
separate them. The pty process behind the terminal can, because a new
incarnation is a new process. Exposing that identity is the only thing this
route does; the colour store that consumes it lives in the frontend.
"""
from __future__ import annotations

import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join


URL_PREFIX = "colourful-tab"


def _starttime_field(stat_line: str) -> str | None:
    """Field 22 of a ``/proc/<pid>/stat`` line - the process start time in
    clock ticks since boot - or None when the line has too few fields.

    Split after the LAST ``)`` rather than on the whole line: field 2 is the
    executable name in parentheses and may itself contain spaces and
    parentheses, which shifts every field after it and would silently return
    some other process attribute as the start time. What follows that ``)`` is
    field 3 onwards, so field 22 sits at index 19.
    """
    _, _, tail = stat_line.rpartition(")")
    fields = tail.split()
    if len(fields) < 20:
        return None
    return fields[19]


def _process_starttime(pid: int) -> str | None:
    """The process's start time, or None when ``/proc`` cannot answer."""
    try:
        with open(f"/proc/{pid}/stat", "r") as fh:
            return _starttime_field(fh.read())
    except OSError:
        return None


def _fingerprint(pid: int) -> str:
    """The pty process's identity as ``<pid>:<starttime>``.

    The start time is paired with the pid because the operating system reuses
    pids: a bare pid would eventually collide the way the terminal NAME already
    does, and a stale colour would then survive the very check that exists to
    drop it. Where ``/proc`` is unreadable - any non-Linux server - the bare pid
    is all the identity available, which still separates the terminals alive at
    one moment and is what a client comparing a stored fingerprint needs.
    """
    starttime = _process_starttime(pid)
    return f"{pid}:{starttime}" if starttime is not None else str(pid)


class TerminalFingerprintsHandler(APIHandler):
    """``GET colourful-tab/terminals`` -> ``{"terminals": {name: fingerprint}}``."""

    @tornado.web.authenticated
    def get(self) -> None:
        terminal_manager = self.settings.get("terminal_manager")
        if terminal_manager is None:
            # 503 rather than an empty map: an empty answer reads as "no
            # terminals exist", and the client would drop every stored colour
            # on a server that simply has terminals turned off.
            self.set_status(503)
            self.finish(json.dumps({"error": "terminal_service_unavailable"}))
            return
        # The registry is read directly. ``get_terminal`` is get-OR-CREATE in
        # both terminado's NamedTermManager and jupyter_server_terminals'
        # TerminalManager, so asking it about a name the manager has never seen
        # SPAWNS a terminal, and one born that way never gets the
        # ``last_activity`` attribute ``TerminalManager.create`` patches on -
        # the very next ``TerminalManager.list()`` then raises for every
        # terminal in the list and ``GET /api/terminals`` 500s for every client
        # of the server until it restarts. The sibling AI code assistants
        # extension took a server down that way and records it as DEF-32.
        registry = getattr(terminal_manager, "terminals", None)
        if registry is None:
            # Same reason as the 503 above: a manager of a shape this route
            # cannot read is not a server with no terminals, and saying so is
            # the difference between the client keeping its colours and
            # discarding all of them.
            self.set_status(503)
            self.finish(json.dumps({"error": "terminal_registry_unavailable"}))
            return
        fingerprints = {}
        # Snapshot the registry: a terminal closing during the walk mutates it,
        # and the answer is a best-effort view of one moment either way.
        for name, terminal in list(registry.items()):
            ptyproc = getattr(terminal, "ptyproc", None)
            pid = getattr(ptyproc, "pid", None)
            if pid is None:
                # Absent rather than fatal. A terminal whose pty has gone has
                # no incarnation to report, and raising would throw away the
                # fingerprints of every other terminal, which are still correct
                # and still the only way the client can prune a recycled name.
                continue
            fingerprints[name] = _fingerprint(pid)
        self.finish(json.dumps({"terminals": fingerprints}))


def setup_route_handlers(web_app) -> None:
    base_url = web_app.settings["base_url"]
    web_app.add_handlers(
        ".*$",
        [
            (
                url_path_join(base_url, URL_PREFIX, "terminals"),
                TerminalFingerprintsHandler,
            )
        ],
    )
