"""
Internal activity logging via model signals.

Records every deliberate admin create / update / delete on the internally-
managed models into ActivityLog, capturing *what exactly happened*:
  • the actor (who made the change),
  • field-level diffs for updates ({field: {from, to}} in metadata),
  • a readable summary message.

Public-side activity is NOT logged (public dashboard opens use queryset
.update() — no signals; ContactSubmission is excluded). High-frequency churn
(device telemetry, connection flips, login timestamps) is filtered out via
update_fields so the log stays a meaningful audit trail.
"""
import threading

from django.db.models.signals import pre_save, post_save, post_delete

# Saves that ONLY touch these fields are background churn — never logged.
# `status`/`viewers` are live MediaMTX telemetry: the Cameras page refreshes
# them via cam.save(update_fields=["status","viewers"]) *inside* an
# authenticated admin's request, so without this filter a camera going
# offline would be wrongly attributed to whoever's browser triggered the
# refresh ("Camera updated by <Admin> · status: True → False").
NOISE_UPDATE_FIELDS = {
    'payload', 'last_payload_update', 'is_connected',
    'last_login', 'updated_at', 'public_views',
    'status', 'viewers',
}
# Never diff/log these (noise or secrets). Same as the noise set EXCEPT we keep
# `status` diffable: a status-only telemetry save is already dropped above via
# the update_fields check, while a genuine user edit that changes some other
# model's status should still be recorded.
DIFF_EXCLUDE = (NOISE_UPDATE_FIELDS - {'status'}) | {'id'}
SENSITIVE_HINTS = ('password', 'token', 'secret')

# Pre-save snapshots keyed by (model, pk) for computing diffs in post_save.
_pre = threading.local()


def _is_sensitive(name):
    n = name.lower()
    return any(h in n for h in SENSITIVE_HINTS)


def _fmt(v):
    if v is None:
        return '—'
    s = str(v)
    return (s[:117] + '…') if len(s) > 120 else s


def _stash(model, pk, old):
    store = getattr(_pre, 'data', None)
    if store is None:
        store = _pre.data = {}
    store[(model, pk)] = old


def _pop(model, pk):
    store = getattr(_pre, 'data', None)
    if not store:
        return None
    return store.pop((model, pk), None)


def _diff(old, instance):
    """Build {field: {from, to}} for the changed, non-sensitive fields."""
    changes = {}
    try:
        for f in instance._meta.concrete_fields:
            attn = f.attname
            if attn in DIFF_EXCLUDE or _is_sensitive(attn) or attn not in old:
                continue
            new_val = getattr(instance, attn, None)
            old_val = old.get(attn)
            if old_val != new_val:
                changes[attn] = {'from': _fmt(old_val), 'to': _fmt(new_val)}
    except Exception:
        pass
    return changes


def _message(action, actor, changes):
    who = f"by {actor}" if actor else ""
    if action == 'update' and changes:
        parts = [f"{fld.replace('_', ' ')}: {d['from']} → {d['to']}" for fld, d in list(changes.items())[:3]]
        extra = f" (+{len(changes) - 3} more)" if len(changes) > 3 else ""
        detail = "; ".join(parts) + extra
        return (f"{who} · {detail}" if who else detail)[:300]
    verb = {'create': 'Created', 'update': 'Updated', 'delete': 'Deleted'}.get(action, action)
    return (f"{verb} {who}").strip()[:300]


def _broadcast(entry):
    """Push a new log entry to live "Recent activity" WebSocket listeners."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)("activity_logs", {"type": "activity.log", "log": {
            "id": entry.id,
            "category": entry.category,
            "action": entry.action,
            "entity_name": entry.entity_name,
            "message": entry.message,
            "actor_name": entry.actor_name,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
        }})
    except Exception:
        pass


def _actor():
    """The User behind the current request (or None for system/automated events)."""
    try:
        from .current_request import get_current_actor
        return get_current_actor()
    except Exception:
        return None


def _log(category, action, instance, name_attr, actor_user=None, changes=None):
    try:
        from .models import ActivityLog
        from .current_request import actor_display_name
        name = getattr(instance, name_attr, None) or f"#{getattr(instance, 'id', '')}"
        name = str(name)[:200]
        actor_name = actor_display_name(actor_user)
        entry = ActivityLog.objects.create(
            category=category,
            action=action,
            entity_name=name,
            message=_message(action, actor_name, changes),
            actor=actor_user if (actor_user and getattr(actor_user, 'pk', None)) else None,
            actor_name=actor_name,
            metadata=({'changes': changes} if changes else {}),
        )
        _broadcast(entry)
    except Exception:
        # Logging must never break the underlying operation.
        pass


def _connect(model, category, name_attr):
    def on_pre(sender, instance, raw=False, update_fields=None, **kwargs):
        if raw or instance.pk is None:
            return
        if update_fields and set(update_fields).issubset(NOISE_UPDATE_FIELDS):
            return  # telemetry/login churn — don't bother snapshotting
        try:
            old = sender.objects.filter(pk=instance.pk).values().first()
            if old is not None:
                _stash(sender, instance.pk, old)
        except Exception:
            pass

    def on_save(sender, instance, created, raw=False, update_fields=None, **kwargs):
        if raw:
            return
        if not created and update_fields and set(update_fields).issubset(NOISE_UPDATE_FIELDS):
            return
        if created:
            _log(category, 'create', instance, name_attr, _actor(), None)
            return
        old = _pop(sender, instance.pk)
        changes = _diff(old, instance) if old else {}
        # A full save that changed nothing meaningful → skip (no-op noise).
        if old is not None and not changes:
            return
        _log(category, 'update', instance, name_attr, _actor(), changes)

    def on_delete(sender, instance, **kwargs):
        _log(category, 'delete', instance, name_attr, _actor(), None)

    pre_save.connect(on_pre, sender=model, weak=False, dispatch_uid=f"actlog_pre_{category}")
    post_save.connect(on_save, sender=model, weak=False, dispatch_uid=f"actlog_save_{category}")
    post_delete.connect(on_delete, sender=model, weak=False, dispatch_uid=f"actlog_delete_{category}")


def register():
    """Wire up the signal handlers. Called once from AppConfig.ready()."""
    from .models import Application, Dashboard, Device, CompanyInformation
    mapping = [
        (Application,        'application', 'name'),
        (Dashboard,          'dashboard',   'name'),
        (Device,             'device',      'device_name'),
        (CompanyInformation, 'company',     'company_name'),
    ]
    try:
        from Cameras.models import Camera
        mapping.append((Camera, 'camera', 'camera_name'))
    except Exception:
        pass
    try:
        from UserAccounts.models import User, Role
        mapping.append((User, 'user', 'name'))
        mapping.append((Role, 'role', 'name'))
    except Exception:
        pass
    try:
        from .models import SSLCertificate
        mapping.append((SSLCertificate, 'ssl', 'name'))
    except Exception:
        pass

    for model, category, name_attr in mapping:
        _connect(model, category, name_attr)
