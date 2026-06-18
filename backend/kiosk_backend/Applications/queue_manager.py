"""
In-memory, per-dashboard access queue.

Models a turn-based control queue: viewers join a FIFO line; the person at the
front becomes the *controller* for `control_seconds`, during which only they may
write (send device commands) to the dashboard. When their time runs out control
rotates to the next person in line.

On top of the public queue there is an *admin override*: an authenticated
internal user (previewing the public dashboard) can seize exclusive control for
ADMIN_CONTROL_SECONDS. While an admin holds control the public queue is frozen
(no rotation, the current public turn is parked at the front of the line and
resumes afterwards) and only that admin may write. A second internal user cannot
override the first — they're told who holds it.

NOTE: state lives in this process's memory, so it is correct for a single ASGI
worker (the dev `daphne`/`runserver`). A multi-worker deployment would need a
shared store (Redis); the public API here is intentionally small so that swap is
localized.
"""
import time
from threading import RLock

# How long an internal "take control" override lasts before the public queue
# automatically resumes. 5 minutes per the product spec.
ADMIN_CONTROL_SECONDS = 300

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
            "admin": None,        # {"user_id","name"} internal override holder, or None
            "admin_until": 0.0,   # epoch when the admin override ends
        }
        _queues[dashboard_id] = q
    return q


def _admin_active(q, now=None):
    now = now if now is not None else time.time()
    return bool(q["admin"] and now < q["admin_until"])


def add_viewer(dashboard_id):
    with _lock:
        _state(dashboard_id)["viewers"] += 1


def remove_viewer(dashboard_id):
    with _lock:
        q = _state(dashboard_id)
        q["viewers"] = max(0, q["viewers"] - 1)
        # Drop the whole record once nobody is watching and the line is empty.
        if q["viewers"] == 0 and not q["members"] and not q["active"] and not q["admin"]:
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
    active controller (or admin override) changed. While an admin override is
    live the public queue is frozen; when it expires the queue resumes."""
    control_seconds = max(5, int(control_seconds or 60))
    with _lock:
        q = _state(dashboard_id)
        now = time.time()
        changed = False
        # Admin override frozen window — nothing rotates.
        if q["admin"] and now < q["admin_until"]:
            return False
        # Admin override just expired — clear it and let the public queue resume.
        if q["admin"] and now >= q["admin_until"]:
            q["admin"] = None
            q["admin_until"] = 0.0
            changed = True
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
    """True only for the current PUBLIC controller. Always False while an admin
    override is in effect (the admin has exclusive control then)."""
    if not member_id:
        return False
    with _lock:
        q = _state(dashboard_id)
        if _admin_active(q):
            return False
        return bool(q["active"] and q["active"]["id"] == member_id and time.time() < q["active_until"])


# ----------------------- Admin override -----------------------

def admin_take_control(dashboard_id, user_id, name, seconds=ADMIN_CONTROL_SECONDS):
    """Internal user seizes exclusive control.

    Returns:
      {"ok": True, "remaining": int}                          on success / refresh
      {"ok": False, "occupied_by": name, "remaining": int}    if another admin holds it
    """
    if user_id is None:
        return {"ok": False, "occupied_by": None, "remaining": 0}
    user_id = str(user_id)
    seconds = max(5, int(seconds or ADMIN_CONTROL_SECONDS))
    with _lock:
        q = _state(dashboard_id)
        now = time.time()
        if q["admin"] and now < q["admin_until"]:
            if q["admin"]["user_id"] == user_id:
                # Same admin re-takes → refresh their window.
                q["admin_until"] = now + seconds
                return {"ok": True, "remaining": seconds}
            return {
                "ok": False,
                "occupied_by": q["admin"]["name"],
                "remaining": int(round(q["admin_until"] - now)),
            }
        # Park the current public controller at the front so they resume first
        # once the admin override ends ("the queue will resume").
        if q["active"]:
            q["members"].insert(0, {
                "id": q["active"]["id"], "name": q["active"]["name"], "joined": time.time(),
            })
            q["active"] = None
            q["active_until"] = 0.0
        q["admin"] = {"user_id": user_id, "name": (name or "Administrator")[:60]}
        q["admin_until"] = now + seconds
        return {"ok": True, "remaining": seconds}


def admin_release(dashboard_id, user_id):
    """The holding admin gives control back early. Returns True if released."""
    if user_id is None:
        return False
    user_id = str(user_id)
    with _lock:
        q = _state(dashboard_id)
        if q["admin"] and q["admin"]["user_id"] == user_id:
            q["admin"] = None
            q["admin_until"] = 0.0
            return True
        return False


def is_admin_controller(dashboard_id, user_id):
    """True if `user_id` currently holds the admin override."""
    if user_id is None:
        return False
    user_id = str(user_id)
    with _lock:
        q = _state(dashboard_id)
        return bool(_admin_active(q) and q["admin"]["user_id"] == user_id)


def is_admin_locked(dashboard_id):
    with _lock:
        return _admin_active(_state(dashboard_id))


def close(dashboard_id):
    """Tear down a dashboard's queue entirely (e.g. it was unpublished)."""
    with _lock:
        _queues.pop(int(dashboard_id), None)


def has_activity(dashboard_id):
    with _lock:
        q = _state(dashboard_id)
        return q["viewers"] > 0 or bool(q["members"]) or bool(q["active"]) or _admin_active(q)


def snapshot(dashboard_id, control_seconds):
    """A serializable view of the queue, plus per-position estimated waits and
    the current admin-override status."""
    control_seconds = max(5, int(control_seconds or 60))
    with _lock:
        q = _state(dashboard_id)
        now = time.time()
        admin_active = _admin_active(q, now)
        admin_remaining = max(0, int(round(q["admin_until"] - now))) if admin_active else 0
        remaining = max(0, int(round(q["active_until"] - now))) if q["active"] else 0
        members = []
        for idx, m in enumerate(q["members"]):
            members.append({
                "id": m["id"],
                "name": m["name"],
                "position": idx + 1,
                # While admin-locked the public timer is frozen, so waits are
                # offset by the admin's remaining time.
                "wait_seconds": admin_remaining + remaining + idx * control_seconds,
            })
        return {
            "active": q["active"],
            "control_remaining": remaining,
            "control_seconds": control_seconds,
            "waiting_count": len(q["members"]),
            "viewers": q["viewers"],
            "members": members,
            "admin_active": admin_active,
            "admin_name": q["admin"]["name"] if admin_active else None,
            "admin_user_id": q["admin"]["user_id"] if admin_active else None,
            "admin_remaining": admin_remaining,
        }
