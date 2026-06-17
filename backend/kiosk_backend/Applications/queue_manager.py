"""
In-memory, per-dashboard access queue.

Models a turn-based control queue: viewers join a FIFO line; the person at the
front becomes the *controller* for `control_seconds`, during which only they may
write (send device commands) to the dashboard. When their time runs out control
rotates to the next person in line.

NOTE: state lives in this process's memory, so it is correct for a single ASGI
worker (the dev `daphne`/`runserver`). A multi-worker deployment would need a
shared store (Redis); the public API here is intentionally small so that swap is
localized.
"""
import time
from threading import RLock

_lock = RLock()
_queues = {}  # dashboard_id (int) -> state dict


def _state(dashboard_id):
    dashboard_id = int(dashboard_id)
    q = _queues.get(dashboard_id)
    if q is None:
        q = {
            "members": [],        # FIFO list of {"id","name","joined"}
            "active": None,       # {"id","name"} currently in control, or None
            "active_until": 0.0,  # epoch when the active turn ends
            "viewers": 0,         # connected queue sockets (for ticker lifecycle)
        }
        _queues[dashboard_id] = q
    return q


def add_viewer(dashboard_id):
    with _lock:
        _state(dashboard_id)["viewers"] += 1


def remove_viewer(dashboard_id):
    with _lock:
        q = _state(dashboard_id)
        q["viewers"] = max(0, q["viewers"] - 1)
        # Drop the whole record once nobody is watching and the line is empty.
        if q["viewers"] == 0 and not q["members"] and not q["active"]:
            _queues.pop(int(dashboard_id), None)


def join(dashboard_id, member_id, name):
    """Add a member to the back of the line. Returns True if they were actually
    added (False if already queued or currently in control)."""
    if not member_id:
        return False
    with _lock:
        q = _state(dashboard_id)
        if q["active"] and q["active"]["id"] == member_id:
            return False
        if any(m["id"] == member_id for m in q["members"]):
            return False
        q["members"].append({"id": member_id, "name": (name or "Guest")[:60], "joined": time.time()})
        return True


def leave(dashboard_id, member_id):
    """Remove a member from the line; if they held control, release it."""
    if not member_id:
        return
    with _lock:
        q = _state(dashboard_id)
        q["members"] = [m for m in q["members"] if m["id"] != member_id]
        if q["active"] and q["active"]["id"] == member_id:
            q["active"] = None
            q["active_until"] = 0.0


def tick(dashboard_id, control_seconds):
    """Expire a finished turn and promote the next member. Returns True if the
    active controller changed."""
    control_seconds = max(5, int(control_seconds or 60))
    with _lock:
        q = _state(dashboard_id)
        now = time.time()
        changed = False
        if q["active"] and now >= q["active_until"]:
            q["active"] = None
            q["active_until"] = 0.0
            changed = True
        if q["active"] is None and q["members"]:
            nxt = q["members"].pop(0)
            q["active"] = {"id": nxt["id"], "name": nxt["name"]}
            q["active_until"] = now + control_seconds
            changed = True
        return changed


def is_controller(dashboard_id, member_id):
    if not member_id:
        return False
    with _lock:
        q = _state(dashboard_id)
        return bool(q["active"] and q["active"]["id"] == member_id and time.time() < q["active_until"])


def has_activity(dashboard_id):
    with _lock:
        q = _state(dashboard_id)
        return q["viewers"] > 0 or bool(q["members"]) or bool(q["active"])


def snapshot(dashboard_id, control_seconds):
    """A serializable view of the queue, plus per-position estimated waits."""
    control_seconds = max(5, int(control_seconds or 60))
    with _lock:
        q = _state(dashboard_id)
        now = time.time()
        remaining = max(0, int(round(q["active_until"] - now))) if q["active"] else 0
        members = []
        for idx, m in enumerate(q["members"]):
            members.append({
                "id": m["id"],
                "name": m["name"],
                "position": idx + 1,
                "wait_seconds": remaining + idx * control_seconds,
            })
        return {
            "active": q["active"],
            "control_remaining": remaining,
            "control_seconds": control_seconds,
            "waiting_count": len(q["members"]),
            "members": members,
        }
