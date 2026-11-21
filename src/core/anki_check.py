"""Pact's AnkiWeb reader: the one place Pact talks to AnkiWeb.

The Anki adapter (anki.ts) runs this once per operation with Anki's own `anki`
package (pinned in anki-requirements.txt). It reads one JSON object on stdin
and writes one on stdout:

  {"op": "login", "username": ..., "password": ...}
      -> {"ok": true, "hostKey": ..., "endpoint": ... or null}
  {"op": "decks", "hostKey": ..., "endpoint": ..., "collection": path}
      -> {"ok": true, "decks": [...], "rolloverHour": n, "endpoint": ...}
  {"op": "counts", "hostKey": ..., "endpoint": ..., "collection": path, "deckIds": [...]}
      -> {"ok": true, "ankiDate": "YYYY-MM-DD", "asOf": ms, "decks": {id: counts or null},
          "names": {id: full name, for each deck still there}, "endpoint": ...}

or {"ok": false, "error": "auth" | "network" | "protocol", "message": ...}.

Rules it keeps (see .scratch/anki-evidence/spec.md, Adapter):
  - The collection opens with server=True, so Anki never writes this
    server's UTC offset into the owner's collection config.
  - Each run asks sync_status on a fresh backend (a backend caches the answer
    for 5 minutes), and follows AnkiWeb's new endpoint when it redirects. It
    asks before every download, the first included, as Anki's own clients
    do: the first download sent without it, to AnkiWeb's default endpoint,
    failed in production ("missing original size").
  - It downloads the collection, without media, only when sync_status says
    something changed, or there's no copy yet.
  - After each download it blanks the notes' content (`prune`), so the copy
    Pact keeps holds no card text: cards, decks, deck options, config and the
    review log stay. A copy from before pruning is pruned at its next
    download. Pruning must leave the change stamp alone, or the check fails.
  - Counts are Anki's deck list counts at `as_of`: the owner's last answer on
    the current Anki day, or now with none.
  - It never uploads (`download` is its only full sync) and never calls
    sync_collection, which unburies cards and pushes local changes back to
    AnkiWeb. Uploading the pruned copy would wipe the owner's notes.
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

# Anki's sync status: nothing changed since the copy was downloaded.
NO_CHANGES = 0


def main() -> None:
    request = json.load(sys.stdin)
    try:
        result = run(request)
    except Exception as error:  # noqa: BLE001 - every failure is reported, typed
        result = failure(error)
    json.dump(result, sys.stdout)


def run(request: dict) -> dict:
    from anki.collection import Collection
    from anki.sync import SyncAuth

    op = request["op"]
    if op == "login":
        # sync_login needs a backend, not the owner's copy: an empty collection, thrown away after.
        with tempfile.TemporaryDirectory(prefix="pact-anki-") as scratch:
            col = Collection(os.path.join(scratch, "login.anki2"), server=True)
            try:
                auth = col.sync_login(request["username"], request["password"], request.get("endpoint"))
            finally:
                col.close(downgrade=False)
        return {"ok": True, "hostKey": auth.hkey, "endpoint": auth.endpoint or None}

    path = request["collection"]
    auth = SyncAuth(hkey=request["hostKey"])
    if request.get("endpoint"):
        auth.endpoint = request["endpoint"]
    col = fresh_copy(Collection, path, auth)
    try:
        if op == "decks":
            tree = col._backend.deck_tree(now=int(time.time()))
            return {
                "ok": True,
                "decks": list(walk(tree, None, None)),
                "rolloverHour": rollover_hour(col),
                "endpoint": auth.endpoint or None,
            }
        if op == "counts":
            as_of = last_answer_today(col) or time.time()
            tree = col._backend.deck_tree(now=int(as_of))
            decks = {}
            names = {}
            for deck_id in request["deckIds"]:
                node = col.decks.find_deck_in_tree(tree, int(deck_id))
                decks[deck_id] = None if node is None else counts(node)
                # The tree node has only the last part of the name; the deck itself has the full one.
                name = None if node is None else col.decks.name_if_exists(int(deck_id))
                if name is not None:
                    names[deck_id] = name
            return {
                "ok": True,
                "ankiDate": anki_date(col, as_of),
                "asOf": int(as_of * 1000),
                "decks": decks,
                "names": names,
                "endpoint": auth.endpoint or None,
            }
        raise ValueError(f"unknown op {op!r}")
    finally:
        col.close(downgrade=False)


def fresh_copy(Collection, path: str, auth):
    """The owner's collection, downloaded again if AnkiWeb has changes, opened on a fresh backend."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    exists = os.path.exists(path)
    col = Collection(path, server=True)
    # Asked even with no copy yet, as Anki's own clients ask before any download: only this
    # check follows AnkiWeb's redirect to the account's own endpoint, which the download needs.
    status = col.sync_status(auth)
    if status.new_endpoint:
        auth.endpoint = status.new_endpoint
    if exists and status.required == NO_CHANGES:
        return col
    download(col, auth)
    prune(col)
    return col


def download(col, auth) -> None:
    """Replace the copy with AnkiWeb's collection, without media: the script's only full sync.

    Download only, never upload: the copy is pruned, so uploading it would replace the
    owner's notes on AnkiWeb, and on every device that syncs, with blank ones.
    """
    col.close_for_full_sync()
    col.full_upload_or_download(auth=auth, server_usn=None, upload=False)
    col.reopen(after_full_sync=True)


def prune(col) -> None:
    """Blank the notes' content, so the stored copy holds none of the owner's card text.

    Counting (the deck tree, the last answer, rollover, deck names) never reads notes.
    The review log stays: daily limits read today's answers. It runs through Anki's own
    connection: the vacuum rebuilds indexes on Anki's own collation, which plain sqlite3 lacks.
    """
    stamp = change_stamp(col)
    col.db.execute("update notes set flds = '', sfld = '', csum = 0")
    col.optimize()  # vacuum, so the file shrinks
    # Anki doesn't count this as a change today. If a bumped anki package did, the copy would
    # differ from AnkiWeb's and be downloaded again at every check. That fails here, as a
    # protocol error the operator is emailed about, rather than being put right with plain
    # sqlite3 after close: it can only follow a bump of the pinned package, whose other
    # assumptions (that counting never reads notes) then need checking too, and a hand-
    # written stamp would hide the change.
    after = change_stamp(col)
    if after != stamp:
        raise RuntimeError(f"pruning the copy changed its change stamp (mod, usn, ls) from {stamp} to {after}")


def change_stamp(col) -> list:
    """What sync_status compares with AnkiWeb's: when the collection changed, and when it last synced."""
    return list(col.db.first("select mod, usn, ls from col"))


def walk(node, parent_id, prefix):
    """Every deck under `node`, parents before their subdecks, with full names."""
    for child in node.children:
        name = child.name if prefix is None else f"{prefix}::{child.name}"
        yield {
            "id": str(child.deck_id),
            "name": name,
            "parentId": parent_id,
            "counts": counts(child),
        }
        yield from walk(child, str(child.deck_id), name)


def counts(node) -> dict:
    return {"new": node.new_count, "learn": node.learn_count, "review": node.review_count}


def rollover_hour(col) -> int:
    return int(col.get_config("rollover", 4))


def last_answer_today(col):
    """Seconds since the epoch, just after the owner's last answer on the current Anki day, or None."""
    day_start = col.sched.day_cutoff - 86400
    last = col.db.scalar("select max(id) from revlog where id >= ?", day_start * 1000)
    return None if last is None else last / 1000 + 1


def anki_date(col, at: float) -> str:
    """The calendar day the Anki day containing `at` started on, on the collection's clock."""
    # localOffset is minutes west of UTC, as JavaScript's getTimezoneOffset; Anki keeps the owner's devices'.
    offset_minutes = col.get_config("localOffset", 0) or 0
    local = at - offset_minutes * 60 - rollover_hour(col) * 3600
    return datetime.fromtimestamp(local, tz=timezone.utc).date().isoformat()


def failure(error: Exception) -> dict:
    """AnkiWeb refusing the login, the network failing (a timeout, no connection), or anything else.

    The pinned anki package raises NetworkError when the request didn't get
    through, and SyncError with kind AUTH or OTHER when AnkiWeb answered: OTHER
    covers every sync failure that isn't a refused login (a server error, a
    client too old, a conflict), so it's treated as a protocol error.
    """
    message = f"{type(error).__name__}: {error}"
    try:
        from anki.errors import NetworkError, SyncError, SyncErrorKind
    except ImportError:
        return {"ok": False, "error": "protocol", "message": message}
    if isinstance(error, SyncError) and error.kind == SyncErrorKind.AUTH:
        return {"ok": False, "error": "auth", "message": message}
    if isinstance(error, NetworkError):
        return {"ok": False, "error": "network", "message": message}
    # Anything else usually means AnkiWeb changed its sync protocol and the pinned package needs updating.
    return {"ok": False, "error": "protocol", "message": message}


if __name__ == "__main__":
    main()
