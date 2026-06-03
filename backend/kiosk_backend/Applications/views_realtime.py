import json, uuid
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.timezone import now
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .models import Device


# ======================================================
# 🔹 Utility Helpers
# ======================================================

def get_nested(obj, path_parts):
    for p in path_parts:
        if not isinstance(obj, dict):
            return {}
        obj = obj.get(p, {})
    return obj


def ensure_path(obj, path_parts):
    for p in path_parts:
        if p not in obj or not isinstance(obj[p], dict):
            obj[p] = {}
        obj = obj[p]
    return obj


def set_nested(obj, path_parts, value):
    if not path_parts:
        return value
    key = path_parts[0]
    if len(path_parts) == 1:
        obj[key] = value
    else:
        if key not in obj or not isinstance(obj[key], dict):
            obj[key] = {}
        set_nested(obj[key], path_parts[1:], value)
    return obj


def delete_nested(obj, path_parts):
    if len(path_parts) == 1:
        obj.pop(path_parts[0], None)
    else:
        head = path_parts[0]
        if head in obj and isinstance(obj[head], dict):
            delete_nested(obj[head], path_parts[1:])
            if not obj[head]:
                obj.pop(head, None)
    return obj


def clean_empty(obj):
    """Remove empty dict nodes like websocket logic."""
    if not isinstance(obj, dict):
        return obj
    for k in list(obj.keys()):
        if isinstance(obj[k], dict):
            obj[k] = clean_empty(obj[k])
            if not obj[k]:
                del obj[k]
    return obj


# ======================================================
# 🔹 Strict Typed Validation (1:1 match with WS)
# ======================================================

def coerce_numeric_types(incoming, existing):
    """
    Auto-coerce int↔float in incoming payload to match the existing
    field's declared type. Mutates incoming in-place.
    """
    if not isinstance(incoming, dict) or not isinstance(existing, dict):
        return
    if "type" in incoming and "value" in incoming:
        if "type" in existing and "value" in existing:
            it, tt = incoming["type"], existing["type"]
            iv = incoming["value"]
            if it == "int" and tt == "float":
                incoming["type"] = "float"
                incoming["value"] = float(iv) if isinstance(iv, (int, float)) else iv
            elif it == "float" and tt == "int":
                incoming["type"] = "int"
                incoming["value"] = int(round(iv)) if isinstance(iv, (int, float)) else iv
        return
    for key, val in incoming.items():
        if isinstance(val, dict):
            coerce_numeric_types(val, existing.get(key, {}))


def normalize_payload_values(payload):
    """
    Ensure the Python value type matches the declared type.
    float fields always store float, int fields always store int.
    Mutates payload in-place. Call AFTER validation.
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
            normalize_payload_values(val)


def validate_types(payload):
    allowed = {"string", "int", "float", "boolean", "dict", "list"}

    if not isinstance(payload, dict):
        return "Payload must be JSON object"

    for key, value in payload.items():

        # Nested branch (dict without {type,value})
        if isinstance(value, dict) and "type" not in value:
            err = validate_types(value)
            if err:
                return err
            continue

        if not isinstance(value, dict):
            return f"'{key}' must be an object"

        if "type" not in value:
            return f"'{key}' missing 'type'"

        if "value" not in value:
            return f"'{key}' missing 'value'"

        t = value["type"]
        v = value["value"]

        if t not in allowed:
            return f"Invalid type '{t}' at '{key}'"

        if t == "string" and not isinstance(v, str):
            return f"'{key}' expects string"

        if t == "int" and not isinstance(v, int):
            return f"'{key}' expects int"

        if t == "float" and not isinstance(v, (int, float)):
            return f"'{key}' expects float"

        if t == "boolean" and not isinstance(v, bool):
            return f"'{key}' expects boolean"

        if t == "dict" and not isinstance(v, dict):
            return f"'{key}' expects dict"

        if t == "list" and not isinstance(v, list):
            return f"'{key}' expects list"

    return None


# ======================================================
# 🔹 WebSocket Broadcast (MATCHING consumers.py)
# ======================================================

def broadcast_ws(device, action, path, payload):
    try:
        channel = get_channel_layer()
        msg = {
            "type": "device_event",
            "event": "value_changed",
            "action": action,
            "source": "http",
            # Stamp the device_id so DashboardRealtimeConsumer can
            # attribute the event without re-inferring it from the path.
            "device_id": device.id,
            "path": path,
            "payload": payload,
            "timestamp": now().isoformat()
        }
        async_to_sync(channel.group_send)(
            f"device_{device.device_uid}_web", msg
        )
        async_to_sync(channel.group_send)(
            f"device_{device.device_uid}_hardware", msg
        )
    except Exception as e:
        print("❌ WS Broadcast Error:", e)


# ======================================================
# 🔹 Main REST API (Firebase-like)
# ======================================================

@csrf_exempt
def firebase_style_api(request, token, path=""):

    # 1️⃣ Validate device
    try:
        device = Device.objects.get(device_token=token, is_active=True)
    except Device.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Invalid device token"}, status=403)

    payload = device.payload or {}
    path_parts = [p for p in path.strip("/").split("/") if p]

    # 2️⃣ GET (identical to WS get)
    if request.method == "GET":
        node = get_nested(payload, path_parts) if path_parts else payload
        return JsonResponse({
            "status": "ok",
            "action": "get",
            "path": path or "/",
            "payload": node
        })

    # 3️⃣ Parse body
    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except:
        return JsonResponse({"status": "error", "message": "Invalid JSON"}, status=400)

    # 4️⃣ Coerce int↔float to match existing field types, then validate
    if request.method in ["PUT", "PATCH"]:
        existing_at_path = get_nested(payload, path_parts) if path_parts else payload
        coerce_numeric_types(body, existing_at_path if isinstance(existing_at_path, dict) else {})
    err = validate_types(body) if request.method in ["PUT", "PATCH"] else None
    if err:
        return JsonResponse({"status": "error", "message": err}, status=422)
    if request.method in ["PUT", "PATCH"]:
        normalize_payload_values(body)

    # ======================================================
    # PUT — Full Replace
    # ======================================================
    if request.method == "PUT":

        if path_parts:
            ensure_path(payload, path_parts[:-1])
            set_nested(payload, path_parts, body)
        else:
            payload = body

        payload = clean_empty(payload)
        device.payload = payload
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

        broadcast_ws(device, "put", "/".join(path_parts), body)

        return JsonResponse({
            "status": "ok",
            "action": "put",
            "path": path or "/",
            "payload": body
        })

    # ======================================================
    # PATCH — Strict merge
    # ======================================================
    if request.method == "PATCH":

        ensure_path(payload, path_parts[:-1])
        node = get_nested(payload, path_parts) if path_parts else payload

        if not isinstance(node, dict):
            set_nested(payload, path_parts, {})
            node = get_nested(payload, path_parts)

        for k, v in body.items():
            node[k] = v

        payload = clean_empty(payload)
        device.payload = payload
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

        broadcast_ws(device, "patch", "/".join(path_parts), body)

        return JsonResponse({
            "status": "ok",
            "action": "patch",
            "path": path or "/",
            "payload": body
        })

    # ======================================================
    # POST — Append with auto key
    # ======================================================
    if request.method == "POST":

        new_key = body.get("key") or f"-{uuid.uuid4().hex[:10]}"
        data = body.get("data")

        if not isinstance(data, dict) or "type" not in data or "value" not in data:
            return JsonResponse(
                {"status": "error", "message": "POST requires { key?, data:{type,value} }"},
                status=422
            )

        # Validate single typed field
        err = validate_types({new_key: data})
        if err:
            return JsonResponse({"status": "error", "message": err}, status=422)

        target = ensure_path(payload, path_parts)
        target[new_key] = data

        payload = clean_empty(payload)
        device.payload = payload
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

        broadcast_ws(device, "post", "/".join(path_parts), {new_key: data})

        return JsonResponse({
            "status": "ok",
            "action": "post",
            "path": path or "/",
            "key": new_key,
            "payload": data
        })

    # ======================================================
    # DELETE
    # ======================================================
    if request.method == "DELETE":

        if path_parts:
            delete_nested(payload, path_parts)
        else:
            payload = {}

        payload = clean_empty(payload)
        device.payload = payload
        device.last_payload_update = now()
        device.save(update_fields=["payload", "last_payload_update"])

        broadcast_ws(device, "delete", "/".join(path_parts), {})

        return JsonResponse({
            "status": "ok",
            "action": "delete",
            "path": path or "/"
        })

    return JsonResponse({"status": "error", "message": "Method not allowed"}, status=405)


# import json, uuid
# from django.http import JsonResponse
# from django.views.decorators.csrf import csrf_exempt
# from django.utils.timezone import now
# from asgiref.sync import async_to_sync
# from channels.layers import get_channel_layer
# from .models import Device


# # ─────────────── Utility functions ───────────────

# def get_nested(obj, path_parts):
#     for p in path_parts:
#         if isinstance(obj, dict):
#             obj = obj.get(p, {})
#         else:
#             return {}
#     return obj


# def ensure_path(obj, path_parts):
#     for p in path_parts:
#         if p not in obj or not isinstance(obj[p], dict):
#             obj[p] = {}
#         obj = obj[p]
#     return obj


# def set_nested(obj, path_parts, value):
#     if not path_parts:
#         return value
#     key = path_parts[0]
#     if len(path_parts) == 1:
#         obj[key] = value
#     else:
#         if key not in obj or not isinstance(obj[key], dict):
#             obj[key] = {}
#         set_nested(obj[key], path_parts[1:], value)
#     return obj


# def delete_nested(obj, path_parts):
#     if len(path_parts) == 1:
#         obj.pop(path_parts[0], None)
#     else:
#         head = path_parts[0]
#         if head in obj and isinstance(obj[head], dict):
#             delete_nested(obj[head], path_parts[1:])
#             if not obj[head]:
#                 obj.pop(head, None)
#     return obj


# def clean_empty_nodes(obj):
#     """Recursively remove empty dicts."""
#     if not isinstance(obj, dict):
#         return obj
#     to_delete = []
#     for k, v in obj.items():
#         if isinstance(v, dict):
#             obj[k] = clean_empty_nodes(v)
#             if not obj[k]:
#                 to_delete.append(k)
#     for k in to_delete:
#         del obj[k]
#     return obj


# def validate_typed_payload(payload):
#     """Ensure {type, value} structure is valid."""
#     allowed_types = {"int", "float", "bool", "string", "object", "list"}
#     for key, val in payload.items():
#         if not isinstance(val, dict):
#             return f"Invalid structure at '{key}'. Expected dict."
#         if "type" not in val or "value" not in val:
#             return f"Invalid node '{key}': missing 'type' or 'value'."
#         if val["type"] not in allowed_types:
#             return f"Invalid type '{val['type']}' at '{key}'."
#     return None


# def broadcast_ws(device, action, path, data):
#     """
#     Broadcast changes to WebSocket group.
#     """
#     try:
#         channel_layer = get_channel_layer()
#         async_to_sync(channel_layer.group_send)(
#             f"device_{device.device_uid}",
#             {
#                 "type": "device.update",
#                 "event": action,
#                 "path": path,
#                 "data": data,
#                 "timestamp": now().isoformat(),
#             },
#         )
#     except Exception as e:
#         print(f"⚠️ WebSocket broadcast failed: {e}")


# # ─────────────── Main Firebase-style REST API ───────────────
# @csrf_exempt
# def firebase_style_api(request, token, path=""):
#     """
#     HTTP PUSH API behaving EXACTLY like websocket realtime engine.
#     Supports: GET, PUT, PATCH, POST, DELETE
#     Enforces:
#       - typed payload validation
#       - strict parent/child hierarchical merging
#       - correct dict/list/value rules
#       - correct broadcasting identical to WS
#     """

#     # -------------------------------------------
#     # DEVICE VALIDATION
#     # -------------------------------------------
#     try:
#         device = Device.objects.get(device_token=token, is_active=True)
#     except Device.DoesNotExist:
#         return JsonResponse(
#             {"status": "error", "message": "Invalid or inactive device"}, 
#             status=403
#         )

#     path_parts = [p for p in path.strip("/").split("/") if p]
#     payload = device.payload or {}

#     # -------------------------------------------
#     # GET (IDENTICAL TO WS GET)
#     # -------------------------------------------
#     if request.method == "GET":
#         data = get_nested(payload, path_parts) if path_parts else payload
#         return JsonResponse({"status": "ok", "path": path or "/", "payload": data}, status=200)

#     # -------------------------------------------
#     # BODY PARSE
#     # -------------------------------------------
#     try:
#         body = json.loads(request.body.decode("utf-8")) if request.body else {}
#     except Exception:
#         return JsonResponse({"status": "error", "message": "Invalid JSON"}, status=400)

#     # -------------------------------------------
#     # STRICT TYPED VALIDATION (MIRRORING WS)
#     # -------------------------------------------
#     def validate_types(obj):
#         allowed = {"string","int","float","boolean","dict","list"}

#         if not isinstance(obj, dict):
#             return "Payload must be JSON object."

#         for key, value in obj.items():

#             if isinstance(value, dict) and "type" not in value:
#                 # nested branch → recursive
#                 err = validate_types(value)
#                 if err: 
#                     return err
#                 continue

#             if not isinstance(value, dict):
#                 return f"'{key}' must be an object"

#             if "type" not in value:
#                 return f"'{key}' missing 'type'"

#             if "value" not in value:
#                 return f"'{key}' missing 'value'"

#             t = value["type"]
#             v = value["value"]

#             if t not in allowed:
#                 return f"Invalid type '{t}' for '{key}'"

#             if t == "string" and not isinstance(v, str):
#                 return f"'{key}' expects string"

#             if t == "int" and not isinstance(v, int):
#                 return f"'{key}' expects int"

#             if t == "float" and not isinstance(v,(int,float)):
#                 return f"'{key}' expects float"

#             if t == "boolean" and not isinstance(v,bool):
#                 return f"'{key}' expects boolean"

#             if t == "dict" and not isinstance(v, dict):
#                 return f"'{key}' expects dict"

#             if t == "list" and not isinstance(v, list):
#                 return f"'{key}' expects list"

#         return None

#     # -------------------------------------------
#     # PUT (FULL REPLACE, EXACT MATCH WS)
#     # -------------------------------------------
#     if request.method == "PUT":

#         err = validate_types(body)
#         if err:
#             return JsonResponse({"status":"error", "message":err}, status=422)

#         if path_parts:
#             ensure_path(payload, path_parts[:-1])
#             set_nested(payload, path_parts, body)
#         else:
#             payload = body

#         payload = clean_empty_nodes(payload)
#         device.payload = payload
#         device.last_payload_update = now()
#         device.save(update_fields=["payload","last_payload_update"])

#         broadcast_ws(device, "put", "/".join(path_parts), body)

#         return JsonResponse({
#             "status": "ok",
#             "action": "put",
#             "path": path or "/",
#             "payload": body
#         })

#     # -------------------------------------------
#     # PATCH (STRICT MERGE LIKE WS PATCH)
#     # -------------------------------------------
#     elif request.method == "PATCH":

#         err = validate_types(body)
#         if err:
#             return JsonResponse({"status":"error", "message":err}, status=422)

#         ensure_path(payload, path_parts[:-1])
#         node = get_nested(payload, path_parts) if path_parts else payload

#         if not isinstance(node, dict):
#             set_nested(payload, path_parts, {})
#             node = get_nested(payload, path_parts)

#         # strict merge
#         for k,v in body.items():
#             node[k] = v

#         payload = clean_empty_nodes(payload)
#         device.payload = payload
#         device.last_payload_update = now()
#         device.save(update_fields=["payload","last_payload_update"])

#         broadcast_ws(device, "patch", "/".join(path_parts), body)

#         return JsonResponse({
#             "status":"ok",
#             "action":"patch",
#             "path": path or "/",
#             "payload": body
#         })

#     # -------------------------------------------
#     # POST (STRICT {type,value} LIKE WS POST)
#     # -------------------------------------------
#     elif request.method == "POST":

#         key = body.get("key") or request.GET.get("key")
#         data = body.get("data")

#         if not key:
#             key = f"-{uuid.uuid4().hex[:12]}"

#         if not isinstance(data, dict) or "type" not in data or "value" not in data:
#             return JsonResponse({
#                 "status":"error",
#                 "message":"POST requires { key?, data: {type,value} }"
#             }, status=422)

#         # nested validation
#         err = validate_types({key: data})
#         if err:
#             return JsonResponse({"status":"error", "message":err}, status=422)

#         target = ensure_path(payload, path_parts)
#         target[key] = data

#         payload = clean_empty_nodes(payload)
#         device.payload = payload
#         device.last_payload_update = now()
#         device.save(update_fields=["payload","last_payload_update"])

#         broadcast_ws(device, "post", "/".join(path_parts), {key: data})

#         return JsonResponse({
#             "status":"ok",
#             "action":"post",
#             "path": path or "/",
#             "key": key,
#             "payload": data
#         })

#     # -------------------------------------------
#     # DELETE
#     # -------------------------------------------
#     elif request.method == "DELETE":

#         if path_parts:
#             delete_nested(payload, path_parts)
#         else:
#             payload = {}

#         payload = clean_empty_nodes(payload)
#         device.payload = payload
#         device.last_payload_update = now()
#         device.save(update_fields=["payload","last_payload_update"])

#         broadcast_ws(device, "delete", "/".join(path_parts), {})

#         return JsonResponse({
#             "status":"ok",
#             "action":"delete",
#             "path": path or "/"
#         })

#     return JsonResponse({"status":"error","message":"Method not allowed"}, status=405)
