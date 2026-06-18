import json
import uuid
import traceback
import logging
from urllib.parse import parse_qs
from django.db import models, IntegrityError
from django.utils.timezone import now
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Device, DeviceEvent

log = logging.getLogger(__name__)


def _truncate_depth(data, depth):
    """
    Truncate a nested dict to at most `depth` levels.
    Leaves ({type, value}) are kept in full at any level so a shallow
    response is still actionable. Branches deeper than `depth` are
    returned as empty {} placeholders — the client knows to lazy-fetch
    them by sending a `get` for that path on expand.
    """
    if not isinstance(data, dict):
        return data
    if "type" in data and "value" in data:
        return data
    if depth <= 0:
        return {}
    return {k: _truncate_depth(v, depth - 1) for k, v in data.items()}


def _normalize_payload_values(payload):
    """
    Ensure the Python value type matches the declared type.
    float fields always store float, int fields always store int.
    """
    if not isinstance(payload, dict):
        return
    if "type" in payload and "value" in payload:
        t, v = payload["type"], payload["value"]
        if t == "float" and isinstance(v, int):
            payload["value"] = float(v)
        elif t == "int" and isinstance(v, float):
            payload["value"] = int(round(v))
        return
    for key, val in payload.items():
        if isinstance(val, dict):
            _normalize_payload_values(val)


class DeviceRealtimeConsumer(AsyncWebsocketConsumer):

    # ===============================================================
    # 🔹 VALIDATION
    # ===============================================================
    def _validate_payload_types(self, payload):
        """Validate recursively that fields follow {type,value} rules.

        Accepts three shapes at the top level so PUT-at-path works:
          • an empty/missing payload (an empty branch — valid),
          • a bare leaf  {"type": "...", "value": ...}  (PUT a single field), or
          • a container dict whose keys are either nested containers or leaves.
        """
        allowed_types = {"string", "int", "float", "boolean", "dict", "list"}

        def validate_item(key, item):
            if not isinstance(item, dict):
                raise ValueError(f"Field '{key}' must be an object")

            if "type" not in item:
                raise ValueError(f"Field '{key}' missing required 'type'")

            if "value" not in item:
                raise ValueError(f"Field '{key}' missing required 'value'")

            t = item["type"]
            v = item["value"]

            if t not in allowed_types:
                raise ValueError(f"Invalid type '{t}' for field '{key}'")

            if t == "string" and not isinstance(v, str):
                raise ValueError(f"Field '{key}' expects string")

            if t == "int" and not isinstance(v, int):
                raise ValueError(f"Field '{key}' expects integer")

            if t == "float" and not isinstance(v, (int, float)):
                raise ValueError(f"Field '{key}' expects float")

            if t == "boolean" and not isinstance(v, bool):
                raise ValueError(f"Field '{key}' expects boolean")

            if t == "dict" and not isinstance(v, dict):
                raise ValueError(f"Field '{key}' expects dict")

            if t == "list" and not isinstance(v, list):
                raise ValueError(f"Field '{key}' expects list")

        # Empty dict / non-dict — treat as a no-op container (e.g. an empty
        # branch being created by PUT). Lets callers create scaffolding.
        if not isinstance(payload, dict) or not payload:
            return

        # NEW: a bare leaf at the top level (PUT-at-path semantics).
        if "type" in payload and "value" in payload:
            validate_item("(value)", payload)
            return

        for key, value in payload.items():
            if isinstance(value, dict) and "type" not in value:
                self._validate_payload_types(value)
            else:
                validate_item(key, value)

    @database_sync_to_async
    def _coerce_numeric_types(self, path, payload):
        """
        Auto-coerce int↔float to match the existing field's declared type.
        Mutates payload in-place before validation.
        """
        self.device.refresh_from_db(fields=["payload"])
        existing = self.device.payload or {}
        parts = [p for p in path.split("/") if p]
        for p in parts:
            if isinstance(existing, dict):
                existing = existing.get(p, {})
            else:
                return
        self._coerce_walk(payload, existing)

    def _coerce_walk(self, incoming, existing):
        if not isinstance(incoming, dict):
            return
        if "type" in incoming and "value" in incoming:
            if isinstance(existing, dict) and "type" in existing and "value" in existing:
                it, tt = incoming["type"], existing["type"]
                iv = incoming["value"]
                if it == "int" and tt == "float":
                    incoming["type"] = "float"
                    incoming["value"] = float(iv) if isinstance(iv, (int, float)) else iv
                elif it == "float" and tt == "int":
                    incoming["type"] = "int"
                    incoming["value"] = int(round(iv)) if isinstance(iv, (int, float)) else iv
            return
        if not isinstance(existing, dict):
            return
        for key, val in incoming.items():
            if isinstance(val, dict):
                self._coerce_walk(val, existing.get(key, {}))

    # ===============================================================
    # 🔹 CONNECTION
    # ===============================================================
    async def connect(self):

        query = parse_qs(self.scope["query_string"].decode())
        client_type = query.get("type", ["web"])[0].lower()
        if client_type not in ["web", "hardware"]:
            client_type = "web"
        self.client_type = client_type

        self.token = self.scope["url_route"]["kwargs"].get("token")
        self.device = await self._get_device_by_token(self.token)

        # Validate before joining groups. We accept() the connection
        # BEFORE closing so the client actually receives the error
        # message — otherwise the WS just sees a raw close code with
        # no payload and has no way to show a useful toast.
        if not self.device:
            await self.accept()
            await self._send_json({
                "status": "error",
                "code": 4001,
                "reason": "device_not_found",
                "message": "Device not found. The provided token doesn't match any device on this server.",
            })
            await self.close(code=4001)
            return

        if not self.device.is_active:
            await self.accept()
            await self._send_json({
                "status": "error",
                "code": 4002,
                "reason": "device_disabled",
                "message": f"Device '{self.device.device_name}' is disabled. Enable it from the admin panel to connect.",
            })
            await self.close(code=4002)
            return

        self.device_group = f"device_{self.device.device_uid}"
        self.web_group    = f"{self.device_group}_web"
        self.hw_group     = f"{self.device_group}_hardware"

        if self.client_type == "hardware":
            await self.channel_layer.group_add(self.hw_group, self.channel_name)
        else:
            await self.channel_layer.group_add(self.web_group, self.channel_name)

        await self.accept()

        # ONLY a hardware client coming online should mark the device as
        # connected. Web dashboards opening the page must NOT flip the
        # device to online — they're just observers. Status reflects the
        # state of the physical device, not whether anyone is watching it.
        if self.client_type == "hardware":
            await self._set_device_connected(True)
            await self._broadcast_status(True)

        self.subscribed_paths = set()

        if self.client_type == "web":
            self.subscribed_paths.add("/")  # auto-root subscription

        await self._send_ok("connected", {
            "device_uid": self.device.device_uid,
            "client_type": self.client_type,
            "is_connected": self.device.is_connected,
        })

    # ===============================================================
    # 🔹 DISCONNECT
    # ===============================================================
    async def disconnect(self, close_code):

        await self.channel_layer.group_discard(self.web_group, self.channel_name)
        await self.channel_layer.group_discard(self.hw_group, self.channel_name)
        await self.channel_layer.group_discard(self.device_group, self.channel_name)

        self.subscribed_paths.clear()

        # Symmetric with connect — only a hardware client dropping flips
        # the device to offline. Web tabs closing should leave the device's
        # online state untouched.
        if self.device and self.client_type == "hardware":
            await self._set_device_connected(False)
            await self._broadcast_status(False)

    # ===============================================================
    # 🔹 RECEIVE
    # ===============================================================
    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except:
            await self._send_error("Invalid JSON")
            return

        action = data.get("action")
        path = data.get("path", "").strip("/")
        payload = data.get("payload", {})

        if not action:
            await self._send_error("Missing 'action'")
            return

        try:

            if action == "subscribe":
                await self._handle_subscribe(data)

            elif action == "unsubscribe":
                await self._handle_unsubscribe(data)

            elif action == "get":
                await self._handle_get(path, data.get("depth"))

            elif action == "put":
                await self._coerce_numeric_types(path, payload)
                self._validate_payload_types(payload)
                _normalize_payload_values(payload)
                await self._handle_put(path, payload)

            elif action == "patch":
                await self._coerce_numeric_types(path, payload)
                self._validate_payload_types(payload)
                _normalize_payload_values(payload)
                await self._handle_patch(path, payload)

            elif action == "post":
                await self._handle_post(path, payload)

            elif action == "delete":
                await self._handle_delete(path)

            else:
                await self._send_error(f"Unknown action '{action}'")

        except ValueError as e:
            await self._send_error(str(e))
        except IntegrityError as e:
            # Most common cause: POST with a custom `key` that already
            # exists at (device, path). Surface the cause so the user
            # gets a useful toast instead of a generic 500.
            msg = str(e)
            if "devevt_unique_dev_path_key" in msg:
                await self._send_error(
                    "An entry with this key already exists at this path."
                )
            else:
                await self._send_error("Database constraint violation.")
        except Exception:
            log.exception("WebSocket receive failed (action=%r path=%r)", action, path)
            await self._send_error("Internal server error")

    # ===============================================================
    # 🔹 SUBSCRIBE
    # ===============================================================
    async def _handle_subscribe(self, data):
        """
        Subscribe to one or more paths and return the current snapshot for
        each. Pass `depth: <N>` to lazy-load — N=1 returns only the
        immediate children at each path (branches further down are
        replaced with empty {} placeholders). Omit `depth` (or pass null)
        for the legacy full-tree behaviour.
        """
        paths = data.get("paths")
        if paths is None:
            paths = ["/"]

        if not isinstance(paths, list):
            await self._send_error("'paths' must be a list")
            return

        if len(paths) == 0:
            paths = ["/"]

        depth = data.get("depth")
        if depth is not None:
            try:
                depth = int(depth)
                if depth < 0:
                    raise ValueError
            except (TypeError, ValueError):
                await self._send_error("'depth' must be a non-negative integer")
                return

        snapshots = []
        for p in paths:
            clean = p.strip("/") or "/"
            self.subscribed_paths.add(clean)
            payload = await self._get_payload_for_path(
                "" if clean == "/" else clean,
                max_depth=depth,
            )
            snapshots.append({"path": clean, "payload": payload})

        await self._send_json({
            "status": "ok",
            "action": "subscribed",
            "snapshots": snapshots
        })

    # ===============================================================
    # 🔹 UNSUBSCRIBE
    # ===============================================================
    async def _handle_unsubscribe(self, data):

        paths = data.get("paths")
        if paths is None:
            paths = ["/"]

        if not isinstance(paths, list):
            await self._send_error("'paths' must be a list")
            return

        if len(paths) == 0:
            paths = ["/"]

        cleaned = []

        for p in paths:
            clean = p.strip("/") or "/"
            self.subscribed_paths.discard(clean)
            cleaned.append(clean)

        await self._send_ok("unsubscribed", {"paths": cleaned})

    # ===============================================================
    # 🔹 STRICT PATH MATCHING
    # ===============================================================
    def _is_path_match(self, subscribed, event_path):

        subscribed = subscribed or "/"
        event_path = event_path or "/"

        if subscribed == "/":
            return True

        if subscribed == event_path:
            return True

        sub_parts = subscribed.strip("/").split("/")
        evt_parts = event_path.strip("/").split("/")

        if len(evt_parts) < len(sub_parts):
            return False

        for i in range(len(sub_parts)):
            if sub_parts[i] != evt_parts[i]:
                return False

        return True

    # ===============================================================
    # 🔹 NEW BROADCAST (includes action)
    # ===============================================================
    async def _broadcast(self, action, path, payload):

        msg = {
            "type": "device_event",
            "event": "value_changed",
            "action": action,
            "source": self.client_type,
            # Include device_id so consumers fanning these events out
            # (e.g. DashboardRealtimeConsumer) can attribute the change
            # to a specific device without inferring from the path —
            # essential for root-level / cross-device cases.
            "device_id": self.device.id,
            "path": path,
            "payload": payload,
            "timestamp": now().isoformat()
        }

        await self.channel_layer.group_send(self.web_group, msg)
        await self.channel_layer.group_send(self.hw_group, msg)

    # ===============================================================
    # 🔹 DEVICE EVENT HANDLER
    # ===============================================================
    async def device_event(self, event):

        event_path = event["path"] or "/"
        event_payload = event["payload"] or {}

        for sub in self.subscribed_paths:

            if self._is_path_match(sub, event_path):
                await self._send_json(event)
                break

            if event_path != "/":
                if sub.startswith(event_path + "/"):

                    remainder = sub[len(event_path):].strip("/")
                    if not remainder:
                        continue

                    parts = remainder.split("/")
                    first_child = parts[0]

                    if first_child not in event_payload:
                        continue

                    updated_branch = event_payload[first_child]

                    evt = updated_branch
                    match = True

                    for seg in parts[1:]:
                        if seg in evt:
                            evt = evt[seg]
                        else:
                            match = False
                            break

                    if match:
                        await self._send_json(event)
                        break

    # ===============================================================
    # 🔹 GET / PUT / PATCH / POST / DELETE
    # ===============================================================
    async def _handle_get(self, path, depth=None):
        if depth is not None:
            try:
                depth = int(depth)
                if depth < 0:
                    raise ValueError
            except (TypeError, ValueError):
                await self._send_error("'depth' must be a non-negative integer")
                return
        payload = await self._get_payload_for_path(path, max_depth=depth)
        await self._send_ok("get", {"path": path or "/", "payload": payload, "depth": depth})

    async def _handle_put(self, path, payload):
        await self._replace_payload_async(path, payload)
        await self._broadcast("put", path, payload)

    async def _handle_patch(self, path, payload):
        await self._merge_payload_async(path, payload)
        await self._broadcast("patch", path, payload)

    async def _handle_post(self, path, payload):
        """
        Firebase-RTDB-style POST: appends a new keyed child under `path`.

        Instead of growing the device's main JSON payload (which would force
        a full re-write of the column on every event), each POST is stored
        as a row in the DeviceEvent table. Reading the latest N entries at
        a path is then a btree-indexed range scan, not a JSON walk over a
        ballooning blob. Subscribers still receive a live "post" event over
        the WebSocket so the client UI updates instantly.
        """
        new_key = payload.pop("key", None) or f"-{uuid.uuid4().hex[:10]}"
        body = payload.get("data", payload)

        self._validate_payload_types({new_key: body})

        clean_path = path.strip("/") if path else ""
        await self._insert_event_async(clean_path, new_key, body)
        await self._broadcast("post", f"{clean_path}/{new_key}".strip("/"), body)

    async def _handle_delete(self, path):
        await self._delete_path_async(path)
        await self._broadcast("delete", path, {})

    # ===============================================================
    # 🔹 DB OPERATIONS
    # ===============================================================
    @database_sync_to_async
    def _get_device_by_token(self, token):
        """
        Look up a device by token regardless of is_active state so the
        connect() handler can differentiate "no such device" from
        "device disabled" and report each cause to the client.
        """
        if not token:
            return None
        try:
            return Device.objects.get(device_token=token)
        except Device.DoesNotExist:
            return None

    @database_sync_to_async
    def _set_device_connected(self, status):
        self.device.is_connected = status
        self.device.last_payload_update = now()
        self.device.save(update_fields=["is_connected", "last_payload_update"])

    async def _broadcast_status(self, is_connected):
        """Push a connection-state event to every web subscriber on this
        device so dashboards / detail pages flip Online/Offline live."""
        msg = {
            "type": "device_event",
            "event": "device_status",
            "action": "status",
            "source": "hardware",
            "device_id": self.device.id,
            "path": "",
            "payload": {"is_connected": bool(is_connected)},
            "timestamp": now().isoformat(),
        }
        await self.channel_layer.group_send(self.web_group, msg)

    @database_sync_to_async
    def _get_payload_for_path(self, path, max_depth=None):
        """
        Returns the payload subtree at `path` MERGED with the device's
        DeviceEvent rows, then UNIFORMLY truncated to `max_depth`.

        Both JSONField branches and POSTed-entry branches obey the same
        depth rule: at depth 1, the client gets the keys-and-leaves at
        the immediate level; anything deeper becomes an empty {}
        placeholder the client lazy-fetches on expand.

        Leaves ({type, value}) are NEVER truncated — they always come
        back with their value, even at depth 0.

        Capped at 200 events to keep the response bounded.
        """
        self.device.refresh_from_db(fields=["payload"])
        data = self.device.payload or {}

        clean = path.strip("/") if path else ""
        parts = clean.split("/") if clean else []

        # Walk the JSONField subtree to the requested path.
        for p in parts:
            if isinstance(data, dict):
                data = data.get(p, {})
            else:
                data = {}
                break

        if not isinstance(data, dict):
            return data

        merged = dict(data)

        # An event's logical location in the tree is its (path, key) pair
        # joined by "/". If the request is for a path that lives INSIDE a
        # POSTed entry, the JSONField walk alone returns nothing — the
        # entry's data isn't in the JSONField, it's in DeviceEvent.data.
        # So we scan every (path, key) split of the request and pick the
        # deepest match; the remainder of the request walks into that
        # event's data tree.
        if parts:
            q = models.Q()
            for i in range(len(parts)):
                q |= models.Q(path="/".join(parts[:i]), key=parts[i])
            candidates = list(
                DeviceEvent.objects.filter(device=self.device).filter(q)
                .only("id", "path", "key", "data")
            )
            best_event = None
            best_i = -1
            for ev in candidates:
                for i in range(len(parts)):
                    if ev.path == "/".join(parts[:i]) and ev.key == parts[i]:
                        if i > best_i:
                            best_i = i
                            best_event = ev
                        break
            if best_event is not None:
                # Walk remaining segments inside the event's data tree.
                walk = best_event.data
                for seg in parts[best_i + 1:]:
                    if isinstance(walk, dict):
                        walk = walk.get(seg, {})
                    else:
                        walk = {}
                        break
                # If we landed on a leaf, the response IS the leaf
                # (truncation skips leaves, so return now).
                if isinstance(walk, dict) and "type" in walk and "value" in walk:
                    return walk
                # If it's a non-dict (string/number/etc), return verbatim.
                if not isinstance(walk, dict):
                    return walk
                # Branch — merge into `merged`. JSONField data usually
                # has nothing here, but if it does, JSONField wins (it
                # was a deliberate PUT).
                for k, v in walk.items():
                    if k not in merged:
                        merged[k] = v

        # Overlay ALL events (at-path and descendants) — both contribute
        # to the merged tree with their full data. Truncation below
        # then enforces the depth limit uniformly.
        if clean:
            events_qs = DeviceEvent.objects.filter(
                device=self.device,
            ).filter(
                models.Q(path=clean) | models.Q(path__startswith=clean + "/")
            )
        else:
            events_qs = DeviceEvent.objects.filter(device=self.device)
        events_qs = events_qs.order_by("-id")[:200]

        for ev in events_qs:
            if clean:
                rel = ev.path[len(clean):].strip("/")
            else:
                rel = ev.path

            target = merged
            for seg in (rel.split("/") if rel else []):
                existing = target.get(seg)
                if not isinstance(existing, dict):
                    target[seg] = {}
                target = target[seg]

            if ev.key not in target:
                target[ev.key] = ev.data

        # Single, uniform depth cut — same rule for JSONField data and
        # POST-derived data. POSTed-entry keys appear as collapsed
        # placeholders too, so the client lazy-loads each level on click.
        if max_depth is not None:
            merged = _truncate_depth(merged, max_depth)
        return merged

    @database_sync_to_async
    def _insert_event_async(self, path, key, body):
        DeviceEvent.objects.create(
            device=self.device,
            path=path or "",
            key=key,
            data=body,
        )
        self.device.last_payload_update = now()
        self.device.save(update_fields=["last_payload_update"])

    @database_sync_to_async
    def _replace_payload_async(self, path, payload):
        """
        PUT — replace the subtree at `path` with `payload`.

        Uses PostgreSQL's jsonb_set so the database does the structural
        update in-place instead of us reading the whole JSONField into
        Python, mutating it, and writing it all back. For a large payload
        this is the difference between O(blob_size) per write and
        O(path_depth).
        """
        from django.db import connection
        parts = [p for p in path.split("/") if p]
        if parts:
            # jsonb_set(target, path_array, new_value, create_missing := true)
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE "Applications_device"
                       SET payload = jsonb_set(
                               COALESCE(payload, '{}'::jsonb),
                               %s::text[],
                               %s::jsonb,
                               TRUE
                           ),
                           last_payload_update = NOW()
                     WHERE id = %s
                    """,
                    [parts, json.dumps(payload), self.device.id],
                )
        else:
            # Replacing root — single column write is unavoidable.
            self.device.payload = payload or {}
            self.device.last_payload_update = now()
            self.device.save(update_fields=["payload", "last_payload_update"])

    @database_sync_to_async
    def _merge_payload_async(self, path, payload):
        """
        PATCH — shallow-merge `payload` into the dict at `path`.

        Implemented as a single SQL `jsonb || jsonb` op when the path is a
        dict, falling back to a Python round-trip only when the target is
        absent or non-dict.
        """
        from django.db import connection
        parts = [p for p in path.split("/") if p]
        if parts:
            with connection.cursor() as cur:
                # If the target at `path` is already a JSON object, concat
                # merges the keys; otherwise we set it to the patch value.
                cur.execute(
                    """
                    WITH cur AS (
                      SELECT COALESCE(payload, '{}'::jsonb) AS p
                        FROM "Applications_device"
                       WHERE id = %s
                       FOR UPDATE
                    )
                    UPDATE "Applications_device" d
                       SET payload = CASE
                             WHEN jsonb_typeof(cur.p #> %s) = 'object'
                               THEN jsonb_set(cur.p, %s::text[],
                                              (cur.p #> %s) || %s::jsonb, TRUE)
                             ELSE jsonb_set(cur.p, %s::text[],
                                            %s::jsonb, TRUE)
                           END,
                           last_payload_update = NOW()
                      FROM cur
                     WHERE d.id = %s
                    """,
                    [
                        self.device.id,
                        parts, parts, parts, json.dumps(payload),
                        parts, json.dumps(payload),
                        self.device.id,
                    ],
                )
        else:
            # Root-level merge.
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE "Applications_device"
                       SET payload = COALESCE(payload, '{}'::jsonb) || %s::jsonb,
                           last_payload_update = NOW()
                     WHERE id = %s
                    """,
                    [json.dumps(payload), self.device.id],
                )

    @database_sync_to_async
    def _append_payload_async(self, path, key, body):
        data = self.device.payload or {}
        ref = data

        for p in path.split("/") if path else []:
            ref.setdefault(p, {})
            ref = ref[p]

        ref[key] = body

        self.device.payload = self._clean(data)
        self.device.last_payload_update = now()
        self.device.save(update_fields=["payload", "last_payload_update"])

    @database_sync_to_async
    def _delete_path_async(self, path):
        """
        DELETE — drop the key at `path` and any DeviceEvent rows POSTed
        under that path. Uses `#-` (jsonb minus-path) so PostgreSQL does
        the structural delete; an event sweep then removes the matching
        time-series rows. Both are indexed/native operations.
        """
        from django.db import connection
        parts = [p for p in path.split("/") if p]
        if parts:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE "Applications_device"
                       SET payload = COALESCE(payload, '{}'::jsonb) #- %s::text[],
                           last_payload_update = NOW()
                     WHERE id = %s
                    """,
                    [parts, self.device.id],
                )
        else:
            self.device.payload = {}
            self.device.last_payload_update = now()
            self.device.save(update_fields=["payload", "last_payload_update"])

        # Clean associated events under this path (indexed range delete).
        clean = path.strip("/") if path else ""
        if clean:
            DeviceEvent.objects.filter(
                device=self.device,
            ).filter(
                models.Q(path=clean) | models.Q(path__startswith=clean + "/")
            ).delete()
        else:
            DeviceEvent.objects.filter(device=self.device).delete()

    # ===============================================================
    # 🔹 CLEAN
    # ===============================================================
    def _clean(self, obj):
        if not isinstance(obj, dict):
            return obj
        for k in list(obj.keys()):
            if isinstance(obj[k], dict):
                obj[k] = self._clean(obj[k])
                if not obj[k]:
                    del obj[k]
        return obj

    # ===============================================================
    # 🔹 RESPONSE HELPERS
    # ===============================================================
    async def _send_ok(self, action, data=None):
        resp = {"status": "ok", "action": action}
        if data:
            resp.update(data)
        await self._send_json(resp)

    async def _send_error(self, msg, code=400):
        await self._send_json({"status": "error", "code": code, "message": msg})

    async def _send_json(self, data):
        try:
            await self.send(text_data=json.dumps(data))
        except Exception as e:
            log.warning("WebSocket send failed: %s", e)

import json
import uuid
import traceback
from django.utils.timezone import now
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

from .models import Dashboard, DashboardComponent, Device


class DashboardRealtimeConsumer(AsyncWebsocketConsumer):
    """
    Dashboard WebSocket (NO DUPLICATES)

    - Connect with dashboard_id
    - Load dashboard components + bindings
    - Send initial snapshot (per binding)
    - Join ONLY device_<uid>_web groups (NOT hardware group) to avoid duplicate events
    - Forward EXACTLY ONE event per device change:
        {"type":"dashboard_event","event":"value_changed", ...}
    - Handle get/put/patch/post/delete
      * DB update logic matches your DeviceRealtimeConsumer style
      * Broadcasts into device groups so DeviceRealtimeConsumer clients receive updates
    """

    # ===============================================================
    # 🔹 VALIDATION (same rules you use)
    # ===============================================================
    def _validate_payload_types(self, payload):
        allowed_types = {"string", "int", "float", "boolean", "dict", "list"}

        def validate_item(key, item):
            if not isinstance(item, dict):
                raise ValueError(f"Field '{key}' must be an object")
            if "type" not in item:
                raise ValueError(f"Field '{key}' missing required 'type'")
            if "value" not in item:
                raise ValueError(f"Field '{key}' missing required 'value'")

            t = item["type"]
            v = item["value"]

            if t not in allowed_types:
                raise ValueError(f"Invalid type '{t}' for field '{key}'")

            if t == "string" and not isinstance(v, str):
                raise ValueError(f"Field '{key}' expects string")
            if t == "int" and not isinstance(v, int):
                raise ValueError(f"Field '{key}' expects integer")
            if t == "float" and not isinstance(v, (int, float)):
                raise ValueError(f"Field '{key}' expects float")
            if t == "boolean" and not isinstance(v, bool):
                raise ValueError(f"Field '{key}' expects boolean")
            if t == "dict" and not isinstance(v, dict):
                raise ValueError(f"Field '{key}' expects dict")
            if t == "list" and not isinstance(v, list):
                raise ValueError(f"Field '{key}' expects list")

        # Empty or non-dict → no-op (e.g. an empty branch).
        if not isinstance(payload, dict) or not payload:
            return

        # A bare leaf at the top level: { type: "int", value: 1 }.
        # Control widgets (toggle / button / slider) PUT a single typed
        # value to a path, so the payload IS the leaf — not a container
        # of leaves. Validate it directly instead of iterating keys.
        if "type" in payload and "value" in payload:
            validate_item("(value)", payload)
            return

        for key, value in payload.items():
            if isinstance(value, dict) and "type" not in value:
                self._validate_payload_types(value)
            else:
                validate_item(key, value)

    @database_sync_to_async
    def _coerce_numeric_types(self, device_id, path, payload):
        """
        Auto-coerce int↔float to match the existing field's declared type.
        Mutates payload in-place before validation.
        """
        try:
            device = Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return
        existing = device.payload or {}
        parts = [p for p in path.split("/") if p]
        for p in parts:
            if isinstance(existing, dict):
                existing = existing.get(p, {})
            else:
                return
        self._coerce_walk(payload, existing)

    def _coerce_walk(self, incoming, existing):
        if not isinstance(incoming, dict):
            return
        if "type" in incoming and "value" in incoming:
            if isinstance(existing, dict) and "type" in existing and "value" in existing:
                it, tt = incoming["type"], existing["type"]
                iv = incoming["value"]
                if it == "int" and tt == "float":
                    incoming["type"] = "float"
                    incoming["value"] = float(iv) if isinstance(iv, (int, float)) else iv
                elif it == "float" and tt == "int":
                    incoming["type"] = "int"
                    incoming["value"] = int(round(iv)) if isinstance(iv, (int, float)) else iv
            return
        if not isinstance(existing, dict):
            return
        for key, val in incoming.items():
            if isinstance(val, dict):
                self._coerce_walk(val, existing.get(key, {}))

    # ===============================================================
    # 🔹 CONNECT
    # ===============================================================
    async def connect(self):
        self.dashboard_id = None
        self.dashboard = None
        self.bindings = []
        self.device_index = {}

        # Authenticated internal users connect with ?token=<JWT>.
        #   • editor=1  → the admin building the board: full bypass of the queue.
        #   • no editor → previewing the public dashboard: must take the admin
        #     override (queue_manager admin lock) to write; one admin at a time.
        # Anonymous public viewers send no token and stay subject to the queue.
        self.is_admin = False
        self.is_editor = False
        self.user_id = None
        try:
            params = parse_qs(self.scope.get("query_string", b"").decode())
            token = (params.get("token") or [None])[0]
            self.is_editor = (params.get("editor") or [None])[0] == "1"
            if token:
                from rest_framework_simplejwt.tokens import AccessToken
                t = AccessToken(token)   # validates signature + expiry (raises if bad)
                uid = t.get("user_id")
                self.user_id = str(uid) if uid is not None else None
                self.is_admin = self.user_id is not None
        except Exception:
            self.is_admin = False
            self.user_id = None

        print("\n=== DASHBOARD WS CONNECT ===", flush=True)
        print("PATH:", self.scope.get("path"), flush=True)
        print("KWARGS:", self.scope.get("url_route", {}).get("kwargs"), flush=True)

        try:
            self.dashboard_id = int(self.scope["url_route"]["kwargs"]["dashboard_id"])
        except Exception:
            await self.close(code=4000)
            return

        # CRITICAL: accept() FIRST so the WS handshake completes within
        # the client's timeout. Heavy DB / Redis work (which can take
        # several seconds over a remote DB) happens AFTER accept on a
        # background task — events that arrive before bindings are
        # loaded are simply dropped, which is fine because the frontend
        # has already snapshotted device payloads via REST.
        await self.accept()

        # Kick the binding setup + group_add work off in the background.
        # Disconnect can still arrive mid-setup; the task respects
        # `self._closed` so it bails out cleanly if so.
        self._closed = False
        import asyncio
        asyncio.create_task(self._post_accept_setup())

    async def _post_accept_setup(self):
        """Loads the dashboard's bindings, joins each device's web group,
        and emits the "connected" status message. Runs after accept(),
        so the WS stays open while these (potentially slow) remote DB
        + Redis ops complete."""
        try:
            self.dashboard = await self._get_dashboard(self.dashboard_id)
            if self._closed: return
            if not self.dashboard:
                await self.close(code=4004); return

            components = await self._get_components(self.dashboard_id)
            if self._closed: return
            self.bindings, self.device_index = await self._build_bindings(components)
            if self._closed: return

            for did, info in self.device_index.items():
                await self.channel_layer.group_add(info["web_group"], self.channel_name)
                if self._closed: return

            await self._send_json({
                "status": "ok",
                "action": "connected",
                "dashboard_id": self.dashboard_id,
                # No per-binding snapshot — REST already gave the client
                # current device payloads on dashboard load. The WS only
                # exists to push live changes from this moment on.
                "components": [],
                "timestamp": now().isoformat()
            })

            print(
                f"=== DASHBOARD WS CONNECTED dashboard={self.dashboard_id} "
                f"bindings={len(self.bindings)} devices={list(self.device_index.keys())} "
                f"groups={[i['web_group'] for i in self.device_index.values()]} ===",
                flush=True,
            )
        except Exception:
            log.exception("DashboardRealtimeConsumer post-accept setup failed")

    # ===============================================================
    # 🔹 DISCONNECT
    # ===============================================================
    async def disconnect(self, close_code):
        # Signal any pending post-accept setup task to bail out.
        self._closed = True
        try:
            for did, info in (self.device_index or {}).items():
                await self.channel_layer.group_discard(info["web_group"], self.channel_name)
        except Exception:
            pass

    # ===============================================================
    # 🔹 RECEIVE (get / put / patch / post / delete)
    # ===============================================================
    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except Exception:
            return await self._send_error("Invalid JSON")

        action = data.get("action")
        device_id = data.get("device_id")
        path = (data.get("path") or "").strip("/")
        payload = data.get("payload", {})

        if not action:
            return await self._send_error("Missing action")

        # Keepalive — the client pings periodically so idle networks/proxies
        # don't drop this socket when no device values are changing (unlike the
        # queue socket, which gets a server tick every second).
        if action == "ping":
            return await self._send_json({"action": "pong", "timestamp": now().isoformat()})

        # Access-queue gate (reads are always allowed):
        #   • Editor (admin building the board) → full bypass.
        #   • Admin override active → only the internal user holding it may write.
        #   • Otherwise → only the current public queue controller may write.
        if (action in ("put", "patch", "post", "delete")
                and getattr(self.dashboard, "queue_enabled", False)
                and not (getattr(self, "is_admin", False) and getattr(self, "is_editor", False))):
            from . import queue_manager
            if queue_manager.is_admin_locked(self.dashboard_id):
                if not (getattr(self, "is_admin", False)
                        and queue_manager.is_admin_controller(self.dashboard_id, getattr(self, "user_id", None))):
                    return await self._send_error("An administrator is controlling this dashboard.", code=403)
            elif not queue_manager.is_controller(self.dashboard_id, data.get("member_id")):
                return await self._send_error("It's not your turn to control this dashboard.", code=403)

        # device_id required for all except maybe future features
        if action != "get" and device_id is None:
            return await self._send_error("Missing device_id")

        if action == "get" and device_id is None:
            return await self._send_error("Missing device_id")

        try:
            device_id = int(device_id)

            if action == "get":
                value = await self._get_payload_for_path(device_id, path)
                return await self._send_json({
                    "status": "ok",
                    "action": "get",
                    "device_id": device_id,
                    "path": path or "/",
                    "payload": value,
                    "timestamp": now().isoformat()
                })

            if action == "put":
                await self._coerce_numeric_types(device_id, path, payload)
                self._validate_payload_types(payload)
                _normalize_payload_values(payload)
                await self._replace_payload(device_id, path, payload)
                await self._broadcast_device(device_id, "put", path, payload)

            elif action == "patch":
                await self._coerce_numeric_types(device_id, path, payload)
                self._validate_payload_types(payload)
                _normalize_payload_values(payload)
                await self._merge_payload(device_id, path, payload)
                await self._broadcast_device(device_id, "patch", path, payload)

            elif action == "post":
                key = payload.pop("key", None) or f"-{uuid.uuid4().hex[:10]}"
                body = payload.get("data", payload)
                self._validate_payload_types({key: body})
                await self._append_payload(device_id, path, key, body)
                await self._broadcast_device(device_id, "post", f"{path}/{key}".strip("/"), body)

            elif action == "delete":
                await self._delete_payload(device_id, path)
                await self._broadcast_device(device_id, "delete", path, {})

            else:
                return await self._send_error(f"Unknown action '{action}'")

            # IMPORTANT:
            # ✅ No extra "ok" acknowledgements for write actions.
            # Because you complained about multiple messages.
            # The ONLY message you get for writes is the dashboard_event forwarded via device_event.

        except ValueError as e:
            return await self._send_error(str(e))
        except Exception:
            log.exception("Dashboard WebSocket receive failed")
            return await self._send_error("Internal server error")

    # ===============================================================
    # 🔹 DEVICE EVENT HANDLER (from device_<uid>_web)
    # ===============================================================
    async def device_event(self, event):
        """
        Forward EXACTLY ONE message per device change.
        No per-binding fanout. No duplicates.

        Output:
        {
          "type": "dashboard_event",
          "event": "value_changed",
          "action": "...",
          "source": "...",
          "device_id": 20,
          "path": "led",
          "payload": {...},
          "timestamp": "..."
        }
        """
        try:
            event_path = (event.get("path") or "").strip("/")
            # Prefer the device_id sent by DeviceRealtimeConsumer (always
            # correct, including for root-level events). Fall back to the
            # legacy path-inference only when the source consumer didn't
            # include one.
            device_id = event.get("device_id")
            if device_id is None:
                device_id = self._infer_device_id_from_event_path(event_path)

            # Visible trace so daphne logs show the chain. Remove or
            # demote to log.debug once stable.
            print(
                f"[dashboard-ws] forward dashboard={self.dashboard_id} "
                f"device={device_id} path='{event_path}' "
                f"action={event.get('action')} src={event.get('source')}",
                flush=True,
            )

            # ✅ One single message
            await self._send_json({
                "type": "dashboard_event",
                "event": "value_changed",
                "action": event.get("action"),
                "source": event.get("source"),
                "device_id": device_id,
                "path": event_path or "/",
                "payload": event.get("payload") or {},
                "timestamp": event.get("timestamp") or now().isoformat()
            })

        except Exception:
            log.exception("Dashboard device_event handler failed")

    def _infer_device_id_from_event_path(self, event_path: str):
        """
        Device consumer DOES NOT include device_id (you refused to modify it).
        So we infer using this dashboard's bindings.

        If ambiguous (same path exists on multiple devices), returns None.
        """
        if not event_path:
            return None

        matches = set()
        e = event_path.strip("/")

        for b in self.bindings:
            bpath = (b.get("path") or "").strip("/")
            if not bpath:
                continue

            # related means parent/child/exact
            if bpath == e or bpath.startswith(e + "/") or e.startswith(bpath + "/"):
                matches.add(b["device_id"])

        if len(matches) == 1:
            return list(matches)[0]
        return None

    # ===============================================================
    # 🔹 INITIAL SNAPSHOT (per binding)
    # ===============================================================
    async def _initial_snapshot(self):
        result = []
        for b in self.bindings:
            value = await self._get_payload_for_path(b["device_id"], b["path"])
            result.append({
                "component_id": b["component_id"],
                "widget_name": b["widget_name"],
                "binding_index": b["binding_index"],
                "device_id": b["device_id"],
                "path": b["path"],
                "payload": value
            })
        return result

    # ===============================================================
    # 🔹 BROADCAST INTO DEVICE GROUPS (so DeviceRealtimeConsumer clients get it)
    # ===============================================================
    async def _broadcast_device(self, device_id, action, path, payload):
        info = self.device_index.get(device_id)
        if not info:
            return

        msg = {
            "type": "device_event",     # DeviceRealtimeConsumer listens on this
            "event": "value_changed",
            "action": action,
            "source": "dashboard",
            "path": (path or "").strip("/"),
            "payload": payload,
            "timestamp": now().isoformat()
        }

        # Send to ONLY web group (hardware group also exists but we don't join it -> no duplicates)
        await self.channel_layer.group_send(info["web_group"], msg)

        # NOTE:
        # Hardware clients should still receive writes:
        # If you want hardware clients too, you can also group_send to hw_group here.
        # But your duplication problem starts when dashboards also join hw_group.
        # So we broadcast to hw_group as well, WITHOUT joining it ourselves.
        await self.channel_layer.group_send(info["hw_group"], msg)

    # ===============================================================
    # 🔹 DB ACCESS
    # ===============================================================
    @database_sync_to_async
    def _get_dashboard(self, dashboard_id):
        try:
            return Dashboard.objects.get(id=dashboard_id)
        except Exception:
            return None

    @database_sync_to_async
    def _get_components(self, dashboard_id):
        return list(DashboardComponent.objects.filter(dashboard_id=dashboard_id).order_by("id"))

    @database_sync_to_async
    def _build_bindings(self, components):
        bindings = []
        device_index = {}

        for c in components:
            cfg = c.config or {}
            b_list = cfg.get("bindings", [])

            if not isinstance(b_list, list):
                print(f"[dashboard-ws] skip component {c.id}: bindings is not a list ({type(b_list).__name__})")
                continue

            for idx, b in enumerate(b_list):
                did = b.get("device_id")
                path = (b.get("payload_path") or "").strip("/")

                if not did or not path:
                    print(f"[dashboard-ws] skip binding {c.id}[{idx}]: did={did!r} path={path!r}")
                    continue

                try:
                    device = Device.objects.get(id=did)
                except Exception:
                    print(f"[dashboard-ws] skip binding {c.id}[{idx}]: device_id={did} not found")
                    continue

                if did not in device_index:
                    dev_group = f"device_{device.device_uid}"
                    device_index[did] = {
                        "uid": device.device_uid,
                        "web_group": f"{dev_group}_web",
                        "hw_group": f"{dev_group}_hardware",
                    }

                bindings.append({
                    "component_id": c.id,
                    "widget_name": c.widget_name,
                    "binding_index": idx,
                    "device_id": did,
                    "path": path
                })

        return bindings, device_index

    @database_sync_to_async
    def _get_payload_for_path(self, device_id, path):
        device = Device.objects.get(id=device_id)
        device.refresh_from_db(fields=["payload"])
        data = device.payload or {}

        for p in path.split("/") if path else []:
            if isinstance(data, dict):
                data = data.get(p, {})
            else:
                return {}
        return data

    # ===============================================================
    # 🔹 DB MUTATIONS (same style as your Device consumer)
    # ===============================================================
    @database_sync_to_async
    def _replace_payload(self, device_id, path, payload):
        device = Device.objects.get(id=device_id)
        data = device.payload or {}
        parts = [p for p in (path or "").split("/") if p]
        ref = data

        for p in parts[:-1]:
            ref.setdefault(p, {})
            ref = ref[p]

        if parts:
            ref[parts[-1]] = payload
        else:
            data = payload

        device.payload = self._clean(data)
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

    @database_sync_to_async
    def _merge_payload(self, device_id, path, payload):
        device = Device.objects.get(id=device_id)
        data = device.payload or {}
        parts = [p for p in (path or "").split("/") if p]
        ref = data

        for p in parts[:-1]:
            ref.setdefault(p, {})
            ref = ref[p]

        key = parts[-1] if parts else None
        if key:
            existing = ref.get(key, {})
            if not isinstance(existing, dict):
                existing = {}
            ref[key] = {**existing, **payload}
        else:
            if not isinstance(data, dict):
                data = {}
            data.update(payload)

        device.payload = self._clean(data)
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

    @database_sync_to_async
    def _append_payload(self, device_id, path, key, body):
        device = Device.objects.get(id=device_id)
        data = device.payload or {}
        ref = data

        for p in (path or "").split("/") if path else []:
            ref.setdefault(p, {})
            ref = ref[p]

        ref[key] = body

        device.payload = self._clean(data)
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

    @database_sync_to_async
    def _delete_payload(self, device_id, path):
        device = Device.objects.get(id=device_id)
        data = device.payload or {}
        parts = [p for p in (path or "").split("/") if p]

        def delete_nested(obj, parts_):
            if not isinstance(obj, dict):
                return
            if len(parts_) == 1:
                obj.pop(parts_[0], None)
                return
            head = parts_[0]
            if head in obj and isinstance(obj[head], dict):
                delete_nested(obj[head], parts_[1:])
                if not obj[head]:
                    obj.pop(head, None)

        if parts:
            delete_nested(data, parts)
        else:
            data = {}

        device.payload = self._clean(data)
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

    def _clean(self, obj):
        if not isinstance(obj, dict):
            return obj
        for k in list(obj.keys()):
            if isinstance(obj[k], dict):
                obj[k] = self._clean(obj[k])
                if not obj[k]:
                    del obj[k]
        return obj

    # ===============================================================
    # 🔹 RESPONSE
    # ===============================================================
    async def _send_error(self, msg, code=400):
        await self._send_json({"status": "error", "code": code, "message": msg})

    async def _send_json(self, data):
        try:
            await self.send(text_data=json.dumps(data))
        except Exception as e:
            log.warning("Dashboard WebSocket send failed: %s", e)


# =====================================================================
# 🔹 Dashboard ACCESS QUEUE consumer
# =====================================================================
import asyncio
from . import queue_manager

_queue_tickers = {}  # dashboard_id -> asyncio.Task (one live ticker per dashboard)


async def _queue_ticker(dashboard_id, control_seconds, channel_layer, group):
    """Drives rotation + live countdowns: every second it advances the queue and
    re-broadcasts state. Stops once the dashboard has been idle for a few ticks."""
    try:
        idle = 0
        while True:
            await asyncio.sleep(1)
            if not queue_manager.has_activity(dashboard_id):
                idle += 1
                if idle >= 3:
                    break
                continue
            idle = 0
            queue_manager.tick(dashboard_id, control_seconds)
            try:
                await channel_layer.group_send(group, {"type": "queue.update"})
            except Exception:
                pass
    finally:
        _queue_tickers.pop(int(dashboard_id), None)


class DashboardQueueConsumer(AsyncWebsocketConsumer):
    """
    Turn-based access queue for a published dashboard.

    Client → server:  {"action":"join","member_id":"...","name":"..."}
                      {"action":"leave"}
    Server → client:  {"type":"queue_state", enabled, active, control_remaining,
                       control_seconds, waiting_count, you:{in_queue,is_controller,
                       position,wait_seconds}}
    """

    async def connect(self):
        try:
            self.dashboard_id = int(self.scope["url_route"]["kwargs"]["dashboard_id"])
        except Exception:
            await self.close(code=4000); return
        self.member_id = None
        self.dashboard = None
        self.enabled = False
        self.control_seconds = 60
        self.group = f"dashqueue_{self.dashboard_id}"
        self._closed = False
        self._viewer_added = False
        # Internal-user identity (admin override). Resolved from the JWT in the
        # query string (?token=) — set in _setup once the DB is reachable.
        self._token = (parse_qs(self.scope.get("query_string", b"").decode()).get("token") or [None])[0]
        self.user_id = None
        self.user_name = None
        self.is_admin = False
        # Accept FIRST so the WS handshake completes instantly — the (possibly
        # slow, remote-DB) dashboard load + channel-layer join then run on a
        # background task. Doing them before accept() was blocking the
        # handshake on the remote Postgres query (slow "connecting" state).
        await self.accept()
        asyncio.create_task(self._setup())

    async def _setup(self):
        try:
            # The client only opens this socket for queue-enabled dashboards, so
            # send a provisional state IMMEDIATELY from the in-memory queue (no
            # remote calls) — this enables the lobby's "Join queue" button right
            # away instead of after the remote DB + Redis round-trips below.
            self.enabled = True
            await self._send_state()

            # Now the (remote) work: load the real control time + join the
            # Redis group for live ticker updates. Refine the state afterwards.
            self.dashboard = await self._get_dashboard(self.dashboard_id)
            if self._closed:
                return
            if not (self.dashboard and self.dashboard.queue_enabled):
                # Shouldn't normally happen (client gates on this), but stay safe.
                self.enabled = False
                await self._raw({"type": "queue_state", "enabled": False})
                return
            self.control_seconds = int(getattr(self.dashboard, "queue_control_seconds", 60) or 60)
            # Resolve internal-user identity (for the admin override "take control").
            self.user_id, self.user_name = await self._resolve_user(self._token)
            self.is_admin = self.user_id is not None
            queue_manager.add_viewer(self.dashboard_id)
            self._viewer_added = True
            await self.channel_layer.group_add(self.group, self.channel_name)
            if self._closed:
                return
            self._ensure_ticker()
            await self._send_state()
        except Exception:
            log.exception("DashboardQueueConsumer setup failed")

    async def disconnect(self, code):
        self._closed = True
        try:
            if self.member_id:
                queue_manager.leave(self.dashboard_id, self.member_id)
            if getattr(self, "_viewer_added", False):
                queue_manager.remove_viewer(self.dashboard_id)
            await self.channel_layer.group_discard(self.group, self.channel_name)
            if getattr(self, "enabled", False):
                await self._broadcast()
        except Exception:
            pass

    async def receive(self, text_data):
        if not self.enabled:
            return
        try:
            data = json.loads(text_data)
        except Exception:
            return
        action = data.get("action")
        if action == "join":
            self.member_id = data.get("member_id") or str(uuid.uuid4())
            added = queue_manager.join(self.dashboard_id, self.member_id, data.get("name"))
            # Immediate feedback to the joining client (don't wait on the Redis
            # round-trip from the broadcast below).
            await self._send_state()
            # A "view" is counted only when someone actually joins the queue
            # (not on a plain dashboard open, and not on a duplicate join).
            if added:
                await self._count_view()
            self._ensure_ticker()
            await self._broadcast()
        elif action == "leave":
            if self.member_id:
                queue_manager.leave(self.dashboard_id, self.member_id)
            await self._broadcast()
        elif action == "take_control":
            # Internal-user override: seize exclusive control for a fixed window,
            # freezing the public queue. A second internal user can't override.
            if not self.is_admin:
                await self._raw({"type": "queue_error", "error": "Only internal users can take control."})
                return
            # Duration (seconds) chosen by the admin; default 60 when unset/invalid.
            try:
                seconds = int(data.get("seconds"))
            except (TypeError, ValueError):
                seconds = 60
            if seconds <= 0:
                seconds = 60
            res = queue_manager.admin_take_control(self.dashboard_id, self.user_id, self.user_name, seconds=seconds)
            if not res.get("ok"):
                who = res.get("occupied_by") or "another administrator"
                await self._raw({
                    "type": "queue_error",
                    "error": f"This dashboard is occupied by {who}.",
                    "occupied_by": res.get("occupied_by"),
                    "remaining": res.get("remaining"),
                })
                return
            self._ensure_ticker()
            await self._send_state()
            await self._broadcast()
        elif action == "release_control":
            if self.is_admin:
                queue_manager.admin_release(self.dashboard_id, self.user_id)
                await self._send_state()
                await self._broadcast()

    async def queue_update(self, event):
        await self._send_state()

    async def queue_closed(self, event):
        """The dashboard was unpublished — tell the client to exit the queue."""
        await self._raw({
            "type": "queue_closed",
            "reason": event.get("reason") or "This dashboard was unpublished by an administrator.",
        })

    async def _broadcast(self):
        try:
            await self.channel_layer.group_send(self.group, {"type": "queue.update"})
        except Exception:
            pass

    async def _send_state(self):
        snap = queue_manager.snapshot(self.dashboard_id, self.control_seconds)
        active = snap["active"]
        you = {"in_queue": False, "is_controller": False, "position": 0, "wait_seconds": 0}
        if self.member_id:
            if active and active["id"] == self.member_id:
                you = {"in_queue": True, "is_controller": True, "position": 0, "wait_seconds": 0}
            else:
                for m in snap["members"]:
                    if m["id"] == self.member_id:
                        you = {"in_queue": True, "is_controller": False,
                               "position": m["position"], "wait_seconds": m["wait_seconds"]}
                        break
        # Internal-user override flags.
        you["is_admin"] = bool(self.is_admin)
        you["is_admin_controller"] = bool(
            self.is_admin and self.user_id and snap.get("admin_user_id") == self.user_id
        )
        await self._raw({
            "type": "queue_state",
            "enabled": True,
            "active": ({"name": active["name"]} if active else None),
            "control_remaining": snap["control_remaining"],
            "control_seconds": snap["control_seconds"],
            "waiting_count": snap["waiting_count"],
            "admin_active": snap["admin_active"],
            "admin_name": snap["admin_name"],
            "admin_remaining": snap["admin_remaining"],
            "you": you,
        })

    async def _raw(self, data):
        try:
            await self.send(text_data=json.dumps(data))
        except Exception:
            pass

    def _ensure_ticker(self):
        t = _queue_tickers.get(self.dashboard_id)
        if t and not t.done():
            return
        _queue_tickers[self.dashboard_id] = asyncio.create_task(
            _queue_ticker(self.dashboard_id, self.control_seconds, self.channel_layer, self.group)
        )

    @database_sync_to_async
    def _get_dashboard(self, dashboard_id):
        try:
            return Dashboard.objects.get(id=dashboard_id)
        except Exception:
            return None

    @database_sync_to_async
    def _resolve_user(self, token):
        """Decode the JWT → (user_id_str, display_name). Returns (None, None)
        for anonymous public viewers (no/invalid token)."""
        if not token:
            return (None, None)
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from django.contrib.auth import get_user_model
            uid = AccessToken(token).get("user_id")
            if uid is None:
                return (None, None)
            u = get_user_model().objects.filter(pk=uid).only("id", "name", "email").first()
            if not u:
                return (None, None)
            return (str(uid), (getattr(u, "name", None) or getattr(u, "email", "") or f"#{uid}"))
        except Exception:
            return (None, None)

    @database_sync_to_async
    def _count_view(self):
        """Atomically count one engagement ("view") for this dashboard's
        application — fired only when a visitor joins the queue. Bumps both
        the cumulative Application.public_views counter and the per-day
        ApplicationDailyView bucket (used by the dashboard's views graph)."""
        try:
            from django.db.models import F
            from django.utils import timezone
            from .models import Application, ApplicationDailyView
            app_id = getattr(self.dashboard, "application_id", None)
            if app_id:
                Application.objects.filter(pk=app_id).update(public_views=F("public_views") + 1)
                today = timezone.localdate()
                bumped = ApplicationDailyView.objects.filter(
                    application_id=app_id, date=today
                ).update(count=F("count") + 1)
                if not bumped:
                    try:
                        ApplicationDailyView.objects.create(
                            application_id=app_id, date=today, count=1
                        )
                    except Exception:
                        # Lost a race to create the row — just increment it.
                        ApplicationDailyView.objects.filter(
                            application_id=app_id, date=today
                        ).update(count=F("count") + 1)
        except Exception:
            pass


# Group every live "Recent activity" listener joins.
ACTIVITY_LOG_GROUP = "activity_logs"


class ActivityLogConsumer(AsyncWebsocketConsumer):
    """
    Live feed of the internal activity log for the dashboard's "Recent
    activity" panel. Auth-gated by a JWT access token in the query string
    (?token=...). On connect it sends a snapshot of the latest entries; new
    entries are pushed as they happen (broadcast from the logging signal).

      Server → client:  {"type":"snapshot","logs":[…]}   (on connect)
                        {"type":"log","log":{…}}          (live, per new entry)
    """

    SNAPSHOT_LIMIT = 6

    async def connect(self):
        params = parse_qs(self.scope.get("query_string", b"").decode())
        token = (params.get("token") or [None])[0]
        if not self._token_ok(token):
            await self.close(code=4001)
            return
        await self.channel_layer.group_add(ACTIVITY_LOG_GROUP, self.channel_name)
        await self.accept()
        try:
            logs = await self._recent(self.SNAPSHOT_LIMIT)
            await self.send(text_data=json.dumps({"type": "snapshot", "logs": logs}))
        except Exception:
            pass

    async def disconnect(self, code):
        try:
            await self.channel_layer.group_discard(ACTIVITY_LOG_GROUP, self.channel_name)
        except Exception:
            pass

    async def receive(self, text_data=None, bytes_data=None):
        # Server → client only; ignore anything the client sends.
        return

    async def activity_log(self, event):
        """Handler for {"type": "activity.log", "log": {...}} group messages."""
        try:
            await self.send(text_data=json.dumps({"type": "log", "log": event.get("log")}))
        except Exception:
            pass

    @staticmethod
    def _token_ok(token):
        if not token:
            return False
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            AccessToken(token)   # validates signature + expiry (raises if bad)
            return True
        except Exception:
            return False

    @database_sync_to_async
    def _recent(self, limit):
        from .models import ActivityLog
        try:
            ActivityLog.purge_old()
        except Exception:
            pass
        rows = []
        for r in ActivityLog.objects.values(
            "id", "category", "action", "entity_name", "message", "actor_name", "created_at"
        )[:limit]:
            r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None
            rows.append(r)
        return rows


# import json
# import uuid
# import traceback
# from urllib.parse import parse_qs
# from django.utils.timezone import now
# from channels.generic.websocket import AsyncWebsocketConsumer
# from channels.db import database_sync_to_async
# from .models import Device


# class DeviceRealtimeConsumer(AsyncWebsocketConsumer):

#     # ===============================================================
#     # 🔹 VALIDATION
#     # ===============================================================
#     def _validate_payload_types(self, payload):
#         """Validate recursively that fields follow {type,value} rules."""
#         allowed_types = {"string", "int", "float", "boolean", "dict", "list"}

#         def validate_item(key, item):
#             if not isinstance(item, dict):
#                 raise ValueError(f"Field '{key}' must be an object")

#             if "type" not in item:
#                 raise ValueError(f"Field '{key}' missing required 'type'")

#             if "value" not in item:
#                 raise ValueError(f"Field '{key}' missing required 'value'")

#             t = item["type"]
#             v = item["value"]

#             if t not in allowed_types:
#                 raise ValueError(f"Invalid type '{t}' for field '{key}'")

#             if t == "string" and not isinstance(v, str):
#                 raise ValueError(f"Field '{key}' expects string")

#             if t == "int" and not isinstance(v, int):
#                 raise ValueError(f"Field '{key}' expects integer")

#             if t == "float" and not isinstance(v, (int, float)):
#                 raise ValueError(f"Field '{key}' expects float")

#             if t == "boolean" and not isinstance(v, bool):
#                 raise ValueError(f"Field '{key}' expects boolean")

#             if t == "dict" and not isinstance(v, dict):
#                 raise ValueError(f"Field '{key}' expects dict")

#             if t == "list" and not isinstance(v, list):
#                 raise ValueError(f"Field '{key}' expects list")

#         for key, value in payload.items():
#             if isinstance(value, dict) and "type" not in value:
#                 self._validate_payload_types(value)
#             else:
#                 validate_item(key, value)

#     # ===============================================================
#     # 🔹 CONNECTION
#     # ===============================================================
#     async def connect(self):

#         # Parse client type safe
#         query = parse_qs(self.scope["query_string"].decode())
#         client_type = query.get("type", ["web"])[0].lower()
#         if client_type not in ["web", "hardware"]:
#             client_type = "web"
#         self.client_type = client_type

#         # Validate device
#         self.token = self.scope["url_route"]["kwargs"].get("token")
#         self.device = await self._get_device_by_token(self.token)

#         if not self.device:
#             await self.close(code=4001)
#             return

#         # Groups
#         self.device_group = f"device_{self.device.device_uid}"
#         self.web_group = f"{self.device_group}_web"
#         self.hw_group = f"{self.device_group}_hardware"

#         if self.client_type == "hardware":
#             await self.channel_layer.group_add(self.hw_group, self.channel_name)
#         else:
#             await self.channel_layer.group_add(self.web_group, self.channel_name)

#         await self.accept()
#         await self._set_device_connected(True)

#         # Subscriptions
#         self.subscribed_paths = set()

#         if self.client_type == "web":
#             self.subscribed_paths.add("/")  # auto-root subscription

#         await self._send_ok("connected", {
#             "device_uid": self.device.device_uid,
#             "client_type": self.client_type
#         })

#     # ===============================================================
#     # 🔹 DISCONNECT
#     # ===============================================================
#     async def disconnect(self, close_code):

#         await self.channel_layer.group_discard(self.web_group, self.channel_name)
#         await self.channel_layer.group_discard(self.hw_group, self.channel_name)
#         await self.channel_layer.group_discard(self.device_group, self.channel_name)

#         self.subscribed_paths.clear()

#         if self.device:
#             await self._set_device_connected(False)

#     # ===============================================================
#     # 🔹 RECEIVE
#     # ===============================================================
#     async def receive(self, text_data):
#         try:
#             data = json.loads(text_data)
#         except:
#             await self._send_error("Invalid JSON")
#             return

#         action = data.get("action")
#         path = data.get("path", "").strip("/")
#         payload = data.get("payload", {})

#         if not action:
#             await self._send_error("Missing 'action'")
#             return

#         try:
#             if action == "subscribe":
#                 await self._handle_subscribe(data)

#             elif action == "unsubscribe":
#                 await self._handle_unsubscribe(data)

#             elif action == "get":
#                 await self._handle_get(path)

#             elif action == "put":
#                 self._validate_payload_types(payload)
#                 await self._handle_put(path, payload)

#             elif action == "patch":
#                 self._validate_payload_types(payload)
#                 await self._handle_patch(path, payload)

#             elif action == "post":
#                 await self._handle_post(path, payload)

#             elif action == "delete":
#                 await self._handle_delete(path)

#             else:
#                 await self._send_error(f"Unknown action '{action}'")

#         except ValueError as e:
#             await self._send_error(str(e))
#         except Exception:
#             print("❌ SERVER ERROR:", traceback.format_exc())
#             await self._send_error("Internal server error")

#     # ===============================================================
#     # 🔹 SUBSCRIBE
#     # ===============================================================
#     async def _handle_subscribe(self, data):

#         paths = data.get("paths")

#         if paths is None:
#             paths = ["/"]

#         if not isinstance(paths, list):
#             await self._send_error("'paths' must be a list")
#             return

#         if len(paths) == 0:
#             paths = ["/"]

#         snapshots = []

#         for p in paths:
#             clean = p.strip("/") or "/"

#             already = clean in self.subscribed_paths
#             self.subscribed_paths.add(clean)

#             if not already:
#                 payload = await self._get_payload_for_path("" if clean == "/" else clean)
#                 snapshots.append({"path": clean, "payload": payload})
#             else:
#                 snapshots.append({"path": clean, "payload": "already_subscribed"})

#         await self._send_json({
#             "status": "ok",
#             "action": "subscribed",
#             "snapshots": snapshots
#         })

#     # ===============================================================
#     # 🔹 UNSUBSCRIBE
#     # ===============================================================
#     async def _handle_unsubscribe(self, data):

#         paths = data.get("paths")

#         if paths is None:
#             paths = ["/"]

#         if not isinstance(paths, list):
#             await self._send_error("'paths' must be a list")
#             return

#         if len(paths) == 0:
#             paths = ["/"]

#         cleaned = []

#         for p in paths:
#             clean = p.strip("/") or "/"
#             self.subscribed_paths.discard(clean)
#             cleaned.append(clean)

#         await self._send_ok("unsubscribed", {"paths": cleaned})

#     # ===============================================================
#     # 🔹 STRICT SEGMENT-BASED PATH MATCHING
#     # ===============================================================
#     def _is_path_match(self, subscribed, event_path):
#         """
#         Strict hierarchical path matching:
#         /        → matches everything
#         a/b      → matches a/b, a/b/x, a/b/x/y
#         NOT matching prefix collisions like:
#         settings  ≠ settings123
#         """

#         # Normalize
#         subscribed = subscribed or "/"
#         event_path = event_path or "/"

#         if subscribed == "/":
#             return True

#         # Exact match
#         if subscribed == event_path:
#             return True

#         # Split into segments
#         sub_parts = subscribed.strip("/").split("/")
#         evt_parts = event_path.strip("/").split("/")

#         if len(evt_parts) < len(sub_parts):
#             return False

#         for i in range(len(sub_parts)):
#             if sub_parts[i] != evt_parts[i]:
#                 return False

#         return True

#     # ===============================================================
#     # 🔹 BROADCAST
#     # ===============================================================
#     async def _broadcast(self, path, payload):

#         msg = {
#             "type": "device_event",
#             "event": "value_changed",
#             "source": self.client_type,
#             "path": path,
#             "payload": payload,
#             "timestamp": now().isoformat()
#         }

#         await self.channel_layer.group_send(self.web_group, msg)
#         await self.channel_layer.group_send(self.hw_group, msg)

#     async def device_event(self, event):

#         event_path = event["path"] or "/"
#         event_payload = event["payload"] or {}

#         for sub in self.subscribed_paths:

#             # ----------------------------------------------
#             # 1️⃣ NORMAL STRICT MATCH (parent → child allowed)
#             # ----------------------------------------------
#             if self._is_path_match(sub, event_path):
#                 await self._send_json(event)
#                 break

#             # ---------------------------------------------------------
#             # 2️⃣ CHILD SUBSCRIBER BUT EVENT IS PARENT
#             # Example:
#             #   subscribed: settings/system
#             #   event_path: settings
#             #   event_payload contains "system"
#             # ---------------------------------------------------------
#             # ---------------------------------------------------------
# # 2️⃣ EVENT IS PARENT, SUBSCRIBER IS CHILD
# # Notify ONLY if the EXACT child branch that changed
# # is on the path toward the subscriber.
# # ---------------------------------------------------------
#             if event_path != "/":

#                 # Example:
#                 #   subscribed: settings/system/uptime
#                 #   event_path: settings
#                 # → remainder = system/uptime
#                 if sub.startswith(event_path + "/"):

#                     remainder = sub[len(event_path):].strip("/")
#                     if not remainder:
#                         continue

#                     # Break remainder into segments: ["system", "uptime"]
#                     parts = remainder.split("/")

#                     # The first segment must exist in the payload,
#                     # otherwise this branch was not updated.
#                     first_child = parts[0]

#                     if first_child not in event_payload:
#                         # subscriber under this branch but event did NOT update that branch
#                         continue

#                     # Now verify deeper: check if this patch updated the exact path tree
#                     # Example:
#                     # event payload contains only "system/downtime"
#                     # subscriber is at "system/uptime" → DO NOT SEND
#                     updated_branch = event_payload[first_child]

#                     # Traverse down the tree until mismatch
#                     evt = updated_branch
#                     match = True
#                     for seg in parts[1:]:
#                         if seg in evt:
#                             evt = evt[seg]
#                         else:
#                             match = False
#                             break

#                     if match:
#                         await self._send_json(event)
#                         break

#                     continue


        

#     # async def device_event(self, event):

#     #     event_path = event["path"]

#     #     for sub in self.subscribed_paths:

#     #         if self._is_path_match(sub, event_path):
#     #             await self._send_json(event)
#     #             break

#     # ===============================================================
#     # 🔹 GET / PUT / PATCH / POST / DELETE
#     # ===============================================================
#     async def _handle_get(self, path):
#         payload = await self._get_payload_for_path(path)
#         await self._send_ok("get", {"path": path or "/", "payload": payload})

#     async def _handle_put(self, path, payload):
#         await self._replace_payload_async(path, payload)
#         await self._broadcast(path, payload)

#     async def _handle_patch(self, path, payload):
#         await self._merge_payload_async(path, payload)
#         await self._broadcast(path, payload)

#     async def _handle_post(self, path, payload):

#         new_key = payload.pop("key", None) or f"-{uuid.uuid4().hex[:10]}"
#         body = payload.get("data", payload)

#         self._validate_payload_types({new_key: body})

#         await self._append_payload_async(path, new_key, body)
#         await self._broadcast(f"{path}/{new_key}", body)

#         # await self._send_ok("post", {
#         #     "path": path,
#         #     "key": new_key,
#         #     "payload": body
#         # })

#     async def _handle_delete(self, path):
#         await self._delete_path_async(path)
#         await self._broadcast(path, {})
#         await self._send_ok("delete")

#     # ===============================================================
#     # 🔹 DB OPERATIONS
#     # ===============================================================
#     @database_sync_to_async
#     def _get_device_by_token(self, token):
#         try:
#             return Device.objects.get(device_token=token, is_active=True)
#         except:
#             return None

#     @database_sync_to_async
#     def _set_device_connected(self, status):
#         self.device.is_connected = status
#         self.device.last_payload_update = now()
#         self.device.save(update_fields=["is_connected", "last_payload_update"])

#     @database_sync_to_async
#     def _get_payload_for_path(self, path):
#         self.device.refresh_from_db(fields=["payload"])
#         data = self.device.payload or {}

#         for p in path.strip("/").split("/") if path else []:
#             data = data.get(p, {})
#         return data

#     @database_sync_to_async
#     def _replace_payload_async(self, path, payload):
#         data = self.device.payload or {}
#         parts = [p for p in path.split("/") if p]
#         ref = data

#         for p in parts[:-1]:
#             ref.setdefault(p, {})
#             ref = ref[p]

#         if parts:
#             ref[parts[-1]] = payload
#         else:
#             data = payload

#         self.device.payload = self._clean(data)
#         self.device.last_payload_update = now()
#         self.device.save(update_fields=["payload", "last_payload_update"])

#     @database_sync_to_async
#     def _merge_payload_async(self, path, payload):
#         data = self.device.payload or {}
#         parts = [p for p in path.split("/") if p]
#         ref = data

#         for p in parts[:-1]:
#             ref.setdefault(p, {})
#             ref = ref[p]

#         key = parts[-1] if parts else None
#         if key:
#             ref[key] = {**ref.get(key, {}), **payload}
#         else:
#             data.update(payload)

#         self.device.payload = self._clean(data)
#         self.device.last_payload_update = now()
#         self.device.save(update_fields=["payload", "last_payload_update"])

#     @database_sync_to_async
#     def _append_payload_async(self, path, key, body):
#         data = self.device.payload or {}
#         ref = data

#         for p in path.split("/") if path else []:
#             ref.setdefault(p, {})
#             ref = ref[p]

#         ref[key] = body

#         self.device.payload = self._clean(data)
#         self.device.last_payload_update = now()
#         self.device.save(update_fields=["payload", "last_payload_update"])

#     @database_sync_to_async
#     def _delete_path_async(self, path):
#         data = self.device.payload or {}
#         parts = [p for p in path.split("/") if p]

#         def delete_nested(obj, parts):
#             if len(parts) == 1:
#                 obj.pop(parts[0], None)
#             else:
#                 head = parts[0]
#                 if head in obj and isinstance(obj[head], dict):
#                     delete_nested(obj[head], parts[1:])
#                     if not obj[head]:
#                         obj.pop(head, None)

#         if parts:
#             delete_nested(data, parts)
#         else:
#             data = {}

#         self.device.payload = self._clean(data)
#         self.device.last_payload_update = now()
#         self.device.save(update_fields=["payload", "last_payload_update"])

#     # ===============================================================
#     # 🔹 CLEAN
#     # ===============================================================
#     def _clean(self, obj):
#         if not isinstance(obj, dict):
#             return obj
#         for k in list(obj.keys()):
#             if isinstance(obj[k], dict):
#                 obj[k] = self._clean(obj[k])
#                 if not obj[k]:
#                     del obj[k]
#         return obj

#     # ===============================================================
#     # 🔹 RESPONSE HELPERS
#     # ===============================================================
#     async def _send_ok(self, action, data=None):
#         resp = {"status": "ok", "action": action}
#         if data:
#             resp.update(data)
#         await self._send_json(resp)

#     async def _send_error(self, msg, code=400):
#         await self._send_json({"status": "error", "code": code, "message": msg})

#     async def _send_json(self, data):
#         try:
#             await self.send(text_data=json.dumps(data))
#         except Exception as e:
#             print("⚠️ Send Error:", e)


