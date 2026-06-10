<div align="center">

# 🛰️ Hardware Integration Guide
### Pushing Payloads to the Smart Kiosk Control Dashboard

**by MYACCESS PRIVATE LIMITED**

`REST` &nbsp;•&nbsp; `WebSocket` &nbsp;•&nbsp; `JSON` &nbsp;•&nbsp; `Realtime`

</div>


## 🧭 Table of contents

| # | Section | What's inside |
|---|---------|---------------|
| 1 | [The big picture](#1--the-big-picture) | How devices, payloads and dashboards fit together |
| 2 | [Your first push in 60 seconds](#2--your-first-push-in-60-seconds) | The fastest possible start |
| 3 | [Mental model: the payload tree](#3--mental-model-the-payload-tree) | The one idea everything is built on |
| 4 | [Your device credentials](#4--your-device-credentials) | Token + URLs |
| 5 | [The payload format](#5--the-payload-format) | Typed fields & nesting |
| 6 | [Supported data types](#6--supported-data-types) | The six types and their rules |
| 7 | [Type rules & auto-coercion](#7--type-rules--auto-coercion) | What's accepted, what's fixed for you |
| 8 | [Transport A — REST (HTTP)](#8--transport-a--rest-http) | GET/PUT/PATCH/POST/DELETE |
| 9 | [Transport B — WebSocket](#9--transport-b--websocket-realtime) | Realtime + staying Online |
| 10 | [Paths & nesting in depth](#10--paths--nesting-in-depth) | Addressing any field |
| 11 | [Complete error reference](#11--complete-error-reference) | Every code & message |
| 12 | [Complex real-world examples](#12--complex-real-world-examples) | Multi-sensor, control loops, batching |
| 13 | [Full device sketches](#13--full-device-sketches) | ESP32 HTTP **and** WebSocket, Python, Node |
| 14 | [Troubleshooting flow](#14--troubleshooting-flow) | "It's not working" → fix |
| 15 | [Best practices & FAQ](#15--best-practices--faq) | Do's, don'ts, gotchas |

---

## 1 · 🌍 The big picture

Every **device** owns one JSON document — its **payload**. Your hardware writes
into it; dashboards read from it and update **live** the instant anything
changes.

```
   ┌──────────────┐        push (HTTP or WS)        ┌───────────────────┐
   │   YOUR        │  ───────────────────────────▶  │                   │
   │  HARDWARE     │      {type, value} payload      │   KIOSK BACKEND   │
   │ (ESP32, Pi…)  │  ◀───────────────────────────  │  (validates +     │
   └──────────────┘      live commands (WS)          │   stores payload) │
                                                      └─────────┬─────────┘
                                                                │ broadcast
                                                                ▼
                                                      ┌───────────────────┐
                                                      │   DASHBOARD(S)    │
                                                      │  update instantly │
                                                      └───────────────────┘
```

Three ideas power everything:

1. **Every value is typed.** You never send a bare number. You send
   `{ "type": "int", "value": 42 }`. The server can then validate it and the
   dashboard knows how to draw it.
2. **The payload is a tree.** Fields live in named branches, like folders. You
   address any field by its **path** — `motor/live/rpm`.
3. **Two transports, identical behaviour.** Plain **HTTP (REST)** or a
   **WebSocket** — both speak the same payload format and the same five actions
   (`get`, `put`, `patch`, `post`, `delete`). Use whichever your hardware
   supports.

> **🤔 REST or WebSocket?**
> | Use **REST** when… | Use **WebSocket** when… |
> |---|---|
> | You report every few seconds/minutes | You stream many updates per second |
> | Your device only has an HTTP client | You need the lowest latency |
> | You want the simplest possible code | You want the device shown **Online** |
> | Fire-and-forget updates | Two-way: receive dashboard commands live |

---

## 2 · ⚡ Your first push in 60 seconds

You need two things: your **device token** and your **server host** (copy both
from the device's *Integration endpoints* panel in the admin portal).

```bash
curl -X PUT https://your-server/applications/push/<YOUR_TOKEN>/temperature/ \
  -H "Content-Type: application/json" \
  -d '{ "type": "float", "value": 23.5 }'
```

✅ Success looks like:

```json
{ "status": "ok", "action": "put", "path": "temperature", "payload": { "type": "float", "value": 23.5 } }
```

That's it — open the dashboard and you'll see `temperature` update live. The
rest of this guide explains everything you can do from here.

---

## 3 · 🌳 Mental model: the payload tree

Think of the payload exactly like a **file system**:

```
/                              ← root (the whole document)
├── temperature  = 23.5        ← a "leaf" (a real value)
├── online       = true        ← a leaf
└── motor/                     ← a "branch" (a folder)
    ├── status   = "running"   ← a leaf inside motor
    └── live/                  ← a branch inside motor
        ├── rpm   = 1450        ← leaf at path  motor/live/rpm
        └── temp  = 67.2        ← leaf at path  motor/live/temp
```

- A **leaf** is a field with a real value. It is **always** written as
  `{ "type": "...", "value": ... }`.
- A **branch** is a folder that groups fields. It is a plain object **without**
  `type`/`value`.

> **🔑 The single rule that decides everything**
> - Object has **`type` AND `value`** → it's a **leaf** → the server validates it.
> - Object has **no `type`** → it's a **branch** → the server walks into it.

You'll see this rule referenced again and again. Once it clicks, the whole API
makes sense.

---

## 4 · 🔐 Your device credentials

When an admin creates your device, the server generates these — copy them from
the device page → *Integration endpoints*:

| Field | Example | What it is |
|-------|---------|-----------|
| **Device token** | `9f2c1ab4d7e60835aa19c4b2f8e7d310` | 32 hex chars. **Your secret *and* your identity** — there is no separate login. |
| **HTTP URL** | `https://your-server/applications/push/<token>/` | REST base endpoint. |
| **WebSocket URL** | `wss://your-server/ws/applications/<token>/` | Realtime endpoint. |

> **⚠️ Two things that will block a connection**
> 1. **Wrong token** → `403` (REST) / close `4001` (WS).
> 2. **Disabled device** (`is_active = false`) → `403` (REST) / close `4002` (WS).
> Ask an admin to enable the device, and double-check the token.

> **🔒 TLS / certificates.** Production uses HTTPS/WSS. If your server uses a
> private or self-signed certificate, download it from the device page
> (*SSL certificate → Download*) and install it on your device's trust store so
> the TLS handshake succeeds. For quick lab testing you can skip verification
> (`client.setInsecure()` on ESP32) — **never** in production.

---

## 5 · 🧩 The payload format

### One field (a leaf)

```json
{ "type": "int", "value": 42 }
```

### A document with several fields

```json
{
  "temperature": { "type": "float",   "value": 23.5 },
  "humidity":    { "type": "int",     "value": 48 },
  "online":      { "type": "boolean", "value": true },
  "label":       { "type": "string",  "value": "Lobby sensor" }
}
```

### Nesting with branches

```json
{
  "motor": {
    "status": { "type": "string", "value": "running" },
    "live": {
      "rpm":  { "type": "int",   "value": 1450 },
      "temp": { "type": "float", "value": 67.2 }
    }
  }
}
```

`motor` and `motor/live` are branches. Everything with `type`/`value` is a leaf.

---

## 6 · 🎛️ Supported data types

Exactly **six** types are allowed. Anything else is rejected.

| `type` | Accepts | Example | Typical use |
|--------|---------|---------|-------------|
| 🔤 `string`  | a JSON string | `{ "type":"string",  "value":"open" }` | status text, names, modes |
| 🔢 `int`     | a JSON **integer** (no decimal) | `{ "type":"int",     "value":12 }` | counts, RPM, raw ADC |
| 📐 `float`   | a JSON number (int **or** decimal) | `{ "type":"float",   "value":12.5 }` | temperature, voltage |
| 🔘 `boolean` | `true` / `false` | `{ "type":"boolean", "value":true }` | on/off, online, fault |
| 📦 `dict`    | a JSON object | `{ "type":"dict",    "value":{"x":1} }` | opaque config blobs |
| 📚 `list`    | a JSON array | `{ "type":"list",    "value":[1,2,3] }` | log lines, sample buffers |

> **💡 `dict` leaf vs branch — the common confusion**
> - A **`dict` leaf** stores a whole object as **one opaque value**. The server
>   does **not** look inside it. Good for "here's a config blob, store it".
> - A **branch** is structure the server walks into, so each child becomes its
>   own addressable, validated field. Good for "I want to read/update
>   `motor/live/rpm` on its own".
>
> Rule of thumb: if you'll ever want to address a child field by path, use a
> **branch**, not a `dict` leaf.

---

## 7 · ✅ Type rules & auto-coercion

### What gets rejected

For each leaf the server checks the value matches the declared `type`:

| `type` | Rejected when… | Error message |
|--------|----------------|---------------|
| `string` | value isn't a string | `'<key>' expects string` |
| `int` | value isn't an integer | `'<key>' expects int` |
| `float` | value isn't a number | `'<key>' expects float` |
| `boolean` | value isn't `true`/`false` | `'<key>' expects boolean` |
| `dict` | value isn't an object | `'<key>' expects dict` |
| `list` | value isn't an array | `'<key>' expects list` |

Structural errors: `'<key>' missing 'type'`, `'<key>' missing 'value'`,
`'<key>' must be an object`, `Invalid type '<t>' at '<key>'`.

### Auto-coercion — the server meets you halfway

On `put` and `patch`, numbers are auto-converted to match the field's **existing
declared type** *before* validation:

```
Field already exists as float, you send int  →  90   becomes  90.0   ✅
Field already exists as int,   you send float →  90.6 becomes  91     ✅ (rounded)
```

Then values are **normalized** so a float field always stores a real float and
an int field a real int. This is why a dashboard bound to a float field always
shows `90.0`, even though databases love to drop the trailing `.0`.

> **🎯 Golden rule:** keep a path's `type` consistent across pushes. Decide
> `temperature` is `float` once and keep sending it as `float`. Don't flip the
> same path between unrelated types like `string` ↔ `int`.

---

## 8 · 📡 Transport A — REST (HTTP)

### Endpoint shape

```
{METHOD}  {scheme}://{host}/applications/push/{token}/{path}/
```

- `{path}` is optional — omit it to target the **root**.
- Body is JSON with `Content-Type: application/json`.
- **No auth header** — the token in the URL is the credential.

### Methods at a glance

| Method | Action | Body | Effect |
|--------|--------|------|--------|
| `GET` | read | — | Returns the subtree at `path`. |
| `PUT` | replace | payload object *or* a single leaf | **Replaces** what's at `path`. |
| `PATCH` | merge | payload object | **Merges** keys into the object at `path`. |
| `POST` | append | `{ "key"?, "data": {type,value} }` | Appends a keyed child (event/log style). |
| `DELETE` | remove | — | Deletes the field/branch at `path`. |

<details>
<summary><b>📥 GET — read current values</b></summary>

```bash
curl https://your-server/applications/push/<token>/motor/live/
```
```json
{
  "status": "ok", "action": "get", "path": "motor/live",
  "payload": {
    "rpm":  { "type": "int",   "value": 1450 },
    "temp": { "type": "float", "value": 67.2 }
  }
}
```
</details>

<details>
<summary><b>📤 PUT — replace at a path</b></summary>

Replace a whole document at root:
```bash
curl -X PUT https://your-server/applications/push/<token>/ \
  -H "Content-Type: application/json" \
  -d '{ "temperature": {"type":"float","value":23.5},
        "online":      {"type":"boolean","value":true} }'
```
Write a single field (you may PUT a bare leaf):
```bash
curl -X PUT https://your-server/applications/push/<token>/temperature/ \
  -H "Content-Type: application/json" \
  -d '{ "type": "float", "value": 24.1 }'
```
</details>

<details>
<summary><b>🩹 PATCH — merge into an object</b></summary>

Only the keys you send change; siblings stay intact.
```bash
curl -X PATCH https://your-server/applications/push/<token>/motor/live/ \
  -H "Content-Type: application/json" \
  -d '{ "rpm": { "type": "int", "value": 1500 } }'
```
`motor/live/temp` is untouched — only `rpm` updates.
</details>

<details>
<summary><b>➕ POST — append a keyed child (events / logs)</b></summary>

Body must be `{ "key"?, "data": {type,value} }`. Omit `key` for an auto key.
```bash
curl -X POST https://your-server/applications/push/<token>/events/ \
  -H "Content-Type: application/json" \
  -d '{ "data": { "type": "string", "value": "door opened" } }'
```
```json
{ "status":"ok","action":"post","path":"events","key":"-a1b2c3d4e5",
  "payload":{ "type":"string","value":"door opened" } }
```
Use POST for append-only streams (events, alarms, log lines) — stored
efficiently and read back as a recent-N list (perfect for the **Logs** widgets).
</details>

<details>
<summary><b>🗑️ DELETE — remove a field or branch</b></summary>

```bash
curl -X DELETE https://your-server/applications/push/<token>/motor/live/rpm/
```
Deleting a branch removes everything under it. DELETE at root empties the whole
payload.
</details>

### REST status codes

| Code | Meaning |
|------|---------|
| `200` | Success. |
| `400` | Body wasn't valid JSON. |
| `403` | Invalid token (or device not active). |
| `405` | Method not allowed. |
| `422` | Payload failed type validation — read the `message`. |

---

## 9 · 🔌 Transport B — WebSocket (realtime)

### Connect

```
wss://{host}/ws/applications/{token}/?type=hardware
```

> **🟢 Always add `?type=hardware`.** This marks the device **Online** while the
> socket is connected and **Offline** when it drops, and routes events
> correctly. Without it the connection defaults to `type=web` (a passive
> observer that does **not** affect online status).

On success the server sends:
```json
{ "status":"ok", "action":"connected", "device_uid":"ESP32-AB12",
  "client_type":"hardware", "is_connected":true }
```

### Message format

Send JSON text frames:
```json
{ "action": "<action>", "path": "<path>", "payload": { ... } }
```

| Field | Required | Notes |
|-------|----------|-------|
| `action` | yes | `subscribe`, `unsubscribe`, `get`, `put`, `patch`, `post`, `delete` |
| `path` | for read/write | slash path; empty/`"/"` = root |
| `payload` | for writes | same typed format as REST |

### Actions

```json
// replace
{ "action":"put",   "path":"temperature", "payload":{ "type":"float","value":24.1 } }

// merge
{ "action":"patch", "path":"motor/live",  "payload":{ "rpm":{ "type":"int","value":1500 } } }

// append (event/log)
{ "action":"post",  "path":"events",      "payload":{ "data":{ "type":"string","value":"door opened" } } }

// delete
{ "action":"delete","path":"motor/live/rpm" }

// read (optional depth to limit how deep the tree returns)
{ "action":"get",   "path":"motor/live",  "depth":1 }

// listen for changes / dashboard commands
{ "action":"subscribe", "paths":["controls"] }
```

### Live events you receive

Any change (from you, another client, or the dashboard) is pushed to
subscribers:
```json
{
  "type":"device_event", "event":"value_changed", "action":"put",
  "source":"hardware", "device_id":17, "path":"temperature",
  "payload":{ "type":"float","value":24.1 },
  "timestamp":"2026-06-04T10:21:55.013Z"
}
```
This is how dashboards react instantly — and how **your device can receive
commands**: subscribe to a control path and act on the events you get.

---

## 10 · 🧱 Paths & nesting in depth

- A path is branch names joined by `/`, ending at a field: `motor/live/rpm`.
- Leading/trailing slashes are ignored: `/motor/live/` == `motor/live`.
- Empty path (or `/`) = the **root**.
- Missing parent branches are **created automatically** when you write deep.
- Empty branches left after a delete are **pruned** automatically.

| Action at `path` | Result |
|------------------|--------|
| `PUT` | replaces the node at `path` |
| `PATCH` | merges your keys into the object at `path` |
| `POST` | appends a child **under** `path` |
| `DELETE` | removes the node at `path` |

These build the same tree:
```jsonc
// one PUT at root
PUT /              { "motor": { "live": { "rpm": {"type":"int","value":1450} } } }
// or piece by piece (parents auto-created)
PUT /motor/live/rpm   { "type":"int", "value":1450 }
```

---

## 11 · 🚨 Complete error reference

Every error has `"status":"error"` and a `"message"`. REST adds an HTTP code; WS
adds a numeric `"code"`.

### Connection / authentication
| Where | Code | Message | Fix |
|-------|------|---------|-----|
| REST | `403` | `Invalid device token` | Token wrong or device not active. |
| WS | `4001` (close) | `Device not found. The provided token doesn't match any device on this server.` | Wrong token in WS URL. |
| WS | `4002` (close) | `Device '<name>' is disabled. Enable it from the admin panel to connect.` | Ask admin to enable the device. |

### Request / body
| Where | Code | Message | Fix |
|-------|------|---------|-----|
| REST | `400` | `Invalid JSON` | Check quoting/commas & `Content-Type`. |
| WS | `400` | `Invalid JSON` | Frame wasn't valid JSON. |
| WS | `400` | `Missing 'action'` | Every WS message needs an `action`. |
| WS | `400` | `Unknown action '<x>'` | Use a valid action. |
| REST | `405` | `Method not allowed` | Use GET/PUT/PATCH/POST/DELETE. |

### Payload type validation — REST `422` / WS `400`
| Message | Meaning |
|---------|---------|
| `Payload must be JSON object` | Top-level body wasn't an object. |
| `'<key>' must be an object` | Field's value wasn't `{type,value}` or a branch. |
| `'<key>' missing 'type'` | A leaf is missing `type`. |
| `'<key>' missing 'value'` | A leaf is missing `value`. |
| `Invalid type '<t>' at '<key>'` | `type` not one of the six. |
| `'<key>' expects string/int/float/boolean/dict/list` | Value didn't match the type. |

> WebSocket phrases these as `Field '<key>' missing required 'type'`,
> `Field '<key>' expects integer`, etc. — same meaning, slightly longer wording.

### POST-specific
| Where | Code | Message | Fix |
|-------|------|---------|-----|
| REST | `422` | `POST requires { key?, data:{type,value} }` | Wrap value as `{"data":{...}}`. |
| WS | `400` | `An entry with this key already exists at this path.` | Use a new `key` or omit it. |

### Server-side (rare)
| Where | Code | Message | Fix |
|-------|------|---------|-----|
| WS | `400` | `Database constraint violation.` | Retry; report if persistent. |
| WS | `400` | `Internal server error` | Retry with backoff; report if persistent. |

---

## 12 · 🧪 Complex real-world examples

### 12.1 A full multi-sensor device snapshot (single PUT)

One write that publishes an entire device state — nested branches + every type:

```json
{
  "meta": {
    "firmware": { "type": "string",  "value": "v2.4.1" },
    "uptime_s": { "type": "int",     "value": 86432 }
  },
  "sensors": {
    "temperature": { "type": "float",   "value": 24.7 },
    "humidity":    { "type": "int",     "value": 51 },
    "door_open":   { "type": "boolean", "value": false }
  },
  "network": {
    "rssi_dbm":  { "type": "int",  "value": -58 },
    "ip":        { "type": "string","value": "192.168.1.42" }
  },
  "config": {
    "type": "dict",
    "value": { "report_interval": 5, "units": "metric" }
  },
  "recent_samples": {
    "type": "list",
    "value": [24.3, 24.5, 24.6, 24.7]
  }
}
```

```bash
curl -X PUT https://your-server/applications/push/<token>/ \
  -H "Content-Type: application/json" \
  --data-binary @snapshot.json
```

> Notice `config` is a **`dict` leaf** (stored opaque) while `sensors` is a
> **branch** (each child is addressable, e.g. `sensors/temperature`). Pick
> intentionally.

### 12.2 High-frequency telemetry — update only what changed (PATCH)

Re-sending the whole snapshot every loop is wasteful. After the initial PUT,
stream **only the changed leaf** with PATCH at its parent:

```bash
# every cycle — tiny, cheap
curl -X PATCH https://your-server/applications/push/<token>/sensors/ \
  -H "Content-Type: application/json" \
  -d '{ "temperature": { "type": "float", "value": 24.9 } }'
```

`humidity` and `door_open` stay exactly as they were.

### 12.3 An append-only event log (POST → Logs widget)

Each event becomes a recent-N entry that the dashboard's **Log Feed / Console /
Timeline** widgets render:

```bash
# door event
curl -X POST https://your-server/applications/push/<token>/events/ \
  -H "Content-Type: application/json" \
  -d '{ "data": { "type": "dict", "value": {
          "time": "14:32:08", "level": "info", "message": "Door opened"
       } } }'

# fault event
curl -X POST https://your-server/applications/push/<token>/events/ \
  -H "Content-Type: application/json" \
  -d '{ "data": { "type": "dict", "value": {
          "time": "14:35:47", "level": "error", "message": "Motor stalled"
       } } }'
```

> A Logs widget understands entries that are plain strings **or** objects with
> `time`, `level`, and `message`. Levels `info` / `ok` / `warn` / `error` get
> color-coded automatically.

### 12.4 A two-way control loop (WebSocket)

The dashboard writes a command to `controls/fan_speed`; your device subscribes,
reacts, and reports back the actual value it achieved — a closed loop:

```
DASHBOARD ──put controls/fan_speed = 3──▶ BACKEND ──event──▶ DEVICE
DEVICE sets PWM, then ──put sensors/fan_actual = 3──▶ BACKEND ──event──▶ DASHBOARD
```

Device side (pseudocode):
```python
ws.send({"action": "subscribe", "paths": ["controls"]})
for msg in ws:
    if msg["event"] == "value_changed" and msg["path"] == "controls/fan_speed":
        target = msg["payload"]["value"]      # e.g. 3
        actual = apply_fan_pwm(target)        # drive the hardware
        ws.send({"action": "put", "path": "sensors/fan_actual",
                 "payload": {"type": "int", "value": actual}})
```

### 12.5 Resilient pushing — retry with backoff (concept)

Networks fail. Wrap every push so transient errors retry, but **don't** retry a
`4xx` (your payload is wrong — fix it, don't spam it):

```python
def push_with_retry(fn, max_tries=5):
    delay = 0.5
    for attempt in range(max_tries):
        r = fn()
        if r.status_code < 400:
            return r                      # success
        if 400 <= r.status_code < 500:
            raise RuntimeError(r.json())  # our payload is wrong — stop
        time.sleep(delay); delay *= 2     # 5xx/network — back off and retry
    raise RuntimeError("giving up after retries")
```

---

## 13 · 🔧 Full device sketches

### 13.1 ESP32 / Arduino — HTTP (HTTPS PUT)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-pass";
const char* HOST  = "https://your-server";
const char* TOKEN = "9f2c1ab4d7e60835aa19c4b2f8e7d310";

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println("\nWiFi connected");
}

void pushFloat(const char* path, float v) {
  WiFiClientSecure client;
  client.setInsecure();   // lab only — install the server cert in production

  HTTPClient http;
  String url = String(HOST) + "/applications/push/" + TOKEN + "/" + path + "/";
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String body = String("{\"type\":\"float\",\"value\":") + String(v, 2) + "}";
  int code = http.PUT(body);
  Serial.printf("PUT %s -> %d  %s\n", path, code, http.getString().c_str());
  http.end();
}

void loop() {
  float celsius = 20.0 + (millis() % 1000) / 100.0;   // fake reading
  pushFloat("sensors/temperature", celsius);
  delay(5000);
}
```

### 13.2 ESP32 / Arduino — WebSocket (stays Online, two-way)

> Library: **WebSockets by Markus Sattler** (`Links2004/arduinoWebSockets`) —
> install via the Arduino Library Manager ("WebSockets").

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>   // by Markus Sattler (arduinoWebSockets)
#include <ArduinoJson.h>        // by Benoît Blanchon

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-pass";
const char* WS_HOST   = "your-server";        // host only, no scheme
const int   WS_PORT   = 443;                   // 443 for wss
const char* TOKEN     = "9f2c1ab4d7e60835aa19c4b2f8e7d310";

WebSocketsClient ws;
unsigned long lastSend = 0;

// Build "/ws/applications/<token>/?type=hardware"
String wsPath() {
  return String("/ws/applications/") + TOKEN + "/?type=hardware";
}

// Send a single typed field with PUT
void putFloat(const char* path, float v) {
  StaticJsonDocument<256> doc;
  doc["action"] = "put";
  doc["path"]   = path;
  JsonObject p  = doc.createNestedObject("payload");
  p["type"]  = "float";
  p["value"] = v;
  String out; serializeJson(doc, out);
  ws.sendTXT(out);
}

// Handle incoming frames (acks, connect message, dashboard commands)
void onWsEvent(WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WS connected");
      // subscribe to control commands written by the dashboard
      ws.sendTXT("{\"action\":\"subscribe\",\"paths\":[\"controls\"]}");
      break;

    case WStype_TEXT: {
      Serial.printf("WS << %.*s\n", (int)len, payload);

      // React to a dashboard command on controls/fan_speed
      StaticJsonDocument<512> doc;
      if (deserializeJson(doc, payload, len) == DeserializationError::Ok) {
        const char* evt  = doc["event"]  | "";
        const char* path = doc["path"]   | "";
        if (String(evt) == "value_changed" && String(path) == "controls/fan_speed") {
          int target = doc["payload"]["value"] | 0;
          // …drive your hardware here (e.g. analogWrite a PWM pin)…
          // then report the achieved value back:
          StaticJsonDocument<256> rep;
          rep["action"] = "put";
          rep["path"]   = "sensors/fan_actual";
          JsonObject rp = rep.createNestedObject("payload");
          rp["type"] = "int"; rp["value"] = target;
          String out; serializeJson(rep, out);
          ws.sendTXT(out);
        }
      }
      break;
    }

    case WStype_DISCONNECTED:
      Serial.println("WS disconnected");
      break;

    default: break;
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println("\nWiFi connected");

  ws.beginSSL(WS_HOST, WS_PORT, wsPath().c_str());  // wss://
  // For ws:// (no TLS) during local testing use:  ws.begin(WS_HOST, 80, wsPath().c_str());
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(3000);   // auto-reconnect every 3s if dropped
}

void loop() {
  ws.loop();   // MUST be called continuously

  // stream a reading every 5s
  if (millis() - lastSend > 5000) {
    lastSend = millis();
    float celsius = 20.0 + (millis() % 1000) / 100.0;
    putFloat("sensors/temperature", celsius);
  }
}
```

> **Why WebSocket on ESP32?** The device stays **Online** in the dashboard while
> connected, updates have lower latency, and you can **receive commands** from
> the dashboard in real time (the `controls/fan_speed` example above).

### 13.3 Python — REST

```python
import requests
BASE  = "https://your-server/applications/push"
TOKEN = "9f2c1ab4d7e60835aa19c4b2f8e7d310"

def put(path, payload):
    r = requests.put(f"{BASE}/{TOKEN}/{path}/", json=payload)
    print(r.status_code, r.json()); return r

put("", {                                   # snapshot at root
    "temperature": {"type": "float",   "value": 23.5},
    "online":      {"type": "boolean", "value": True},
})
requests.patch(f"{BASE}/{TOKEN}/motor/live/",     # incremental update
               json={"rpm": {"type": "int", "value": 1500}})
requests.post(f"{BASE}/{TOKEN}/events/",          # append an event
              json={"data": {"type": "string", "value": "door opened"}})
```

### 13.4 Python — WebSocket (realtime + commands)

```python
import json, websocket   # pip install websocket-client
TOKEN = "9f2c1ab4d7e60835aa19c4b2f8e7d310"
URL = f"wss://your-server/ws/applications/{TOKEN}/?type=hardware"

ws = websocket.create_connection(URL)
print(ws.recv())                                  # connected ack

ws.send(json.dumps({"action": "put", "path": "temperature",
                    "payload": {"type": "float", "value": 24.1}}))
print(ws.recv())                                  # put ack

ws.send(json.dumps({"action": "subscribe", "paths": ["controls"]}))
while True:                                        # react to commands
    msg = json.loads(ws.recv())
    if msg.get("event") == "value_changed" and msg.get("path","").startswith("controls"):
        print("command:", msg["payload"])
```

### 13.5 Node.js — WebSocket

```js
const WebSocket = require("ws");
const TOKEN = "9f2c1ab4d7e60835aa19c4b2f8e7d310";
const ws = new WebSocket(`wss://your-server/ws/applications/${TOKEN}/?type=hardware`);

ws.on("open", () => ws.send(JSON.stringify({
  action: "patch", path: "motor/live",
  payload: { rpm: { type: "int", value: 1500 } }
})));
ws.on("message", (d) => console.log(d.toString()));
```

---

## 14 · 🩺 Troubleshooting flow

```
Push failing?
│
├─ 403 / close 4001  ──▶ Wrong token. Re-copy it from the device page.
│
├─ close 4002        ──▶ Device disabled. Ask an admin to enable it.
│
├─ 400 Invalid JSON  ──▶ Your body isn't valid JSON. Check quotes/commas,
│                        and that Content-Type is application/json.
│
├─ 422 '<key>' expects <type>
│                    ──▶ The value doesn't match the declared type.
│                        e.g. you sent "12" (string) to an int field.
│
├─ 422 '<key>' missing 'type'/'value'
│                    ──▶ A leaf isn't wrapped as {type, value}.
│
├─ 405 Method not allowed
│                    ──▶ Use GET/PUT/PATCH/POST/DELETE only.
│
├─ Device shows Offline even though pushes work
│                    ──▶ You're using REST (or WS without ?type=hardware).
│                        Connect a WebSocket with ?type=hardware to go Online.
│
└─ TLS handshake fails on ESP32
                     ──▶ Install the server certificate, or use setInsecure()
                        for lab testing only.
```

---

## 15 · 📌 Best practices & FAQ

**✅ Keep a path's type stable.** Decide it once; auto-coercion only fixes
int/float, not string↔number.

**✅ Prefer `patch` for incremental updates** so you never wipe sibling fields.
Use `put` only when you mean to replace a whole node.

**✅ Use `post` for append-only streams** (events, alarms, logs) — they feed the
Logs widgets and are stored efficiently.

**✅ Match transport to cadence.** Many updates/second → WebSocket. Every few
seconds → REST is simpler.

**✅ Online status = a hardware WebSocket.** Only a `?type=hardware` WS marks the
device Online. REST updates data + "last update" time but not connection state.

**✅ Batch when you can.** One write with several fields beats many single-field
calls.

**✅ Handle errors properly.** Read the response. `4xx` → fix the payload (retry
won't help). `5xx`/network → retry with backoff.

---

<details>
<summary><b>❓ Do I need an Authorization header?</b></summary>
No. The token in the URL is the credential for both REST and WebSocket.
</details>

<details>
<summary><b>❓ What's the difference between a <code>dict</code> leaf and a branch?</b></summary>
A <code>dict</code> leaf stores an opaque object as one value (server doesn't
look inside). A branch is structure the server walks into, so each child is its
own addressable, validated field.
</details>

<details>
<summary><b>❓ How do I delete a field?</b></summary>
<code>DELETE</code> at its path (REST) or
<code>{"action":"delete","path":"..."}</code> (WebSocket).
</details>

<details>
<summary><b>❓ Why did my float show up as an integer?</b></summary>
It won't — float fields are normalized to real floats, so <code>90</code> sent
to a float field stores and shows as <code>90.0</code>. Just keep the field's
<code>type</code> as <code>float</code>.
</details>

<details>
<summary><b>❓ Can my device receive commands from the dashboard?</b></summary>
Yes — connect a WebSocket, <code>subscribe</code> to a control path (e.g.
<code>controls</code>), and act on the <code>value_changed</code> events you
receive. See the two-way control loop (§12.4) and the ESP32 WS sketch (§13.2).
</details>

---

<div align="center">

**Document v2.0** · Smart Kiosk Control Dashboard

If your deployment's host or paths differ, copy the exact HTTP and WebSocket
URLs from the device's **Integration endpoints** panel in the admin portal.

</div>
