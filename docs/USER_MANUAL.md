<div align="center">

# 📘 Smart Kiosk Control Dashboard
## Administrator User Manual

**Enterprise Platform · by MYACCESS PRIVATE LIMITED**

*A complete, start-to-finish guide to operating the admin portal — signing in,
creating applications, registering devices, building real-time dashboards,
managing cameras, users, roles, and certificates.*

`Version 1.0`

</div>

---

> ### 📸 About the screenshots in this manual
> Each page in this manual has a screenshot placeholder like
> `![...](images/01-signin.png)`. To complete the manual, capture each page in
> your browser and save the image at the indicated path under
> `docs/images/`. The filename and a precise caption are given at every
> placeholder so the images line up with the text. Until then, each section also
> contains a **layout map** and **example data** so the manual is fully usable
> on its own.

---

## 📑 Table of contents

| Ch. | Chapter | What you'll learn |
|-----|---------|-------------------|
| — | [Before you begin](#before-you-begin) | Conventions, roles, and the navigation bar |
| 1 | [Signing in](#chapter-1--signing-in) | Logging in, Remember Me |
| 2 | [Resetting your password](#chapter-2--resetting-your-password) | Forgot-password flow |
| 3 | [Applications](#chapter-3--applications) | Creating & managing kiosk applications |
| 4 | [Inside an application](#chapter-4--inside-an-application) | Devices, dashboards & cameras of one app |
| 5 | [Devices & the payload tree](#chapter-5--devices--the-payload-tree) | Registering a device, editing live payload |
| 6 | [Building a dashboard](#chapter-6--building-a-dashboard) | The widget editor, every widget & config |
| 7 | [Cameras](#chapter-7--cameras) | Registering streams, viewing live feeds |
| 8 | [Users](#chapter-8--users) | Creating users & assigning roles |
| 9 | [Roles & permissions](#chapter-9--roles--permissions) | Defining roles, the permission catalog |
| 10 | [SSL certificates](#chapter-10--ssl-certificates) | Uploading the cert hardware trusts |
| 11 | [Your profile](#chapter-11--your-profile) | Account details & changing your password |
| — | [Appendix A — Permission reference](#appendix-a--permission-reference) | Every permission and what it unlocks |
| — | [Appendix B — Widget catalog](#appendix-b--widget-catalog) | Every dashboard widget at a glance |

---

## Before you begin

### Who this manual is for

This manual covers the **admin portal** — the internal side used by staff to
configure and operate kiosks. (The public-facing kiosk portal is documented
separately and is not covered here.)

### Conventions used

| Symbol | Meaning |
|--------|---------|
| **Bold** | A button, label, or field name exactly as it appears on screen |
| `code` | A value you type, a URL, or a payload key |
| 📸 | A screenshot placeholder |
| 🧭 | "How to get there" — the navigation path |
| ⭐ | A tip or best practice |
| ⚠️ | A warning |
| *(required)* | The field must be filled in (shown with `*` on screen) |

### The top navigation bar

Every admin page shares the same top bar. The menu items you see depend on your
permissions.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  MYACCESS•   Dashboard  Users  Roles  Cameras  Applications  SSL Cert      │
│                                              Sai (Super Admin) ▾   LOG OUT │
└──────────────────────────────────────────────────────────────────────────┘
```

| Menu item | Goes to | Needs permission |
|-----------|---------|------------------|
| **Dashboard** | Home overview | — |
| **Users** | User management | `user_view` |
| **Roles** | Roles & permissions | `role_view` |
| **Cameras** | Camera registry | `camera_view` |
| **Applications** | Application list | `application_view` |
| **SSL Cert** | Certificate management | `ssl_certificate_view` |
| **{Your name} ▾** | Profile menu | — |
| **LOG OUT** | Ends your session | — |

⭐ If a menu item is missing, your role doesn't include the permission for it.
See [Chapter 9](#chapter-9--roles--permissions).

---

## Chapter 1 · Signing in

🧭 Open the application URL — you'll land on the **Login** page.

📸 `![Login page with email and password fields](images/01-signin.png)`
*Caption: The split-screen login. Form on the left, brand illustration on the right.*

```
┌─────────────────────────────┐ ┌────────────────────────┐
│  MYACCESS•                  │ │                        │
│                             │ │    [ illustration ]    │
│  Welcome back               │ │                        │
│                             │ │                        │
│  Email or Mobile            │ │                        │
│  ┌───────────────────────┐  │ │                        │
│  │                       │  │ │                        │
│  └───────────────────────┘  │ │                        │
│  Password                   │ │                        │
│  ┌──────────────────── 👁 ┐ │ │                        │
│  │ ••••••••••••••••       │  │ │                        │
│  └───────────────────────┘  │ │                        │
│  ☑ Remember Me   Forgot Password? │                    │
│  ┌───────────────────────┐  │ │                        │
│  │        LOG IN         │  │ │                        │
│  └───────────────────────┘  │ │                        │
└─────────────────────────────┘ └────────────────────────┘
```

### Steps

1. In **Email or Mobile**, type your registered email (e.g. `naveen@myaccessio.com`)
   or mobile number.
2. In **Password**, type your password. Tap the 👁 eye icon to reveal it.
3. *(Optional)* Tick **Remember Me** to stay signed in after closing the browser.
4. Click **LOG IN**. The button shows **Logging in…** while it works.

### Field reference

| Field | Required | Example | Notes |
|-------|----------|---------|-------|
| Email or Mobile | ✅ | `naveen@myaccessio.com` | Accepts a valid email **or** mobile number |
| Password | ✅ | `••••••••` | 👁 toggle to show/hide |
| Remember Me | — | ☑ | Keeps you signed in across browser restarts |

### If something's wrong

| Message | Meaning |
|---------|---------|
| *Email or Mobile is required.* | The field was left blank |
| *Enter a valid email address.* / *…mobile number.* | The format isn't recognised |
| *Password is required.* | Password left blank |

---

## Chapter 2 · Resetting your password

🧭 On the Login page, click **Forgot Password?**

This is a **two-step** flow: request a code, then set a new password.

### Step 1 — Request a reset code

📸 `![Forgot password — request code](images/02-forgot-request.png)`

1. Enter your **Email or Mobile**.
2. Click **SEND RESET CODE** (shows **SENDING…**).
3. You'll receive a reset code. *(In developer/DEBUG mode a green banner shows
   the code directly: "Dev token: …".)*

### Step 2 — Reset your password

📸 `![Forgot password — set new password](images/03-forgot-reset.png)`

| Field | Required | Example | Rule |
|-------|----------|---------|------|
| Reset Code | ✅ | `483920` | The code you received |
| New Password | ✅ | `••••••••` | At least 8 characters |
| Confirm Password | ✅ | `••••••••` | Must match New Password |

1. Enter the **Reset Code**.
2. Type a **New Password** (minimum 8 characters) and **Confirm Password**.
3. Click **RESET PASSWORD** (shows **RESETTING…**).
4. Use **← Back to Login** to return and sign in.

⭐ The **Resend Code** button has a 60-second cooldown — it shows
"Resend in {N}s" while counting down.

---

## Chapter 3 · Applications

An **application** represents a kiosk deployment. It is the parent of devices,
dashboards, and linked cameras.

🧭 Top bar → **Applications**

📸 `![Applications grid with stats and search](images/04-applications-list.png)`
*Caption: Stats row, search, "+ Add Application", and the card grid.*

```
┌────────────────────────────────────────────────────────────────────────┐
│  Applications                                                            │
│  Register apps deployed across kiosks. Toggle publish to expose them…    │
│                                                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     🔍 Search…      [+ Add Application]│
│  │   12    │ │   10    │ │    4    │                                     │
│  │Total apps│ │ Active  │ │Published│                                    │
│  └─────────┘ └─────────┘ └─────────┘                                     │
│                                                                          │
│  Applications  (12)                                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                           │
│  │ [hero img] │ │ [hero img] │ │ [hero img] │                           │
│  │ ● Published│ │ ● Draft    │ │ ● Published│                           │
│  │ Lobby Disp.│ │ EMS Room   │ │ Reception  │                           │
│  │ desc…      │ │ desc…      │ │ desc…      │                           │
│  │ 👤 Sai · 4 Jun  │ …       │ │ …          │                           │
│  │ [Edit][Delete] │         │ │            │                           │
│  └────────────┘ └────────────┘ └────────────┘                           │
└────────────────────────────────────────────────────────────────────────┘
```

### The stats row

| Counter | Meaning |
|---------|---------|
| **Total apps** | All applications you can see |
| **Active** | Applications with **Active** on |
| **Published** | Applications visible on the public portal |

### Creating an application

1. Click **+ Add Application**. The **Add Application** modal opens.

📸 `![Add Application modal](images/05-application-add-modal.png)`

2. Fill the form:

| Field | Required | Example |
|-------|----------|---------|
| **Application name** | ✅ | `Front Desk Display` |
| **Description** | — | `Lobby check-in & wayfinding kiosk` |
| **Icon / image** | — | Upload a PNG/JPG/SVG (max 5 MB) |
| **Publish** | — | ☐ off — turn on to expose publicly |
| **Active** | — | ☑ on — show in dashboards |

3. If you add an image, the **Position your image** crop tool appears — drag to
   frame the 16:9 hero, use the **zoom slider** (or **Reset**), then **Use this
   crop**.
4. Click **Add Application** (shows **Saving…**).

⭐ **Publish vs Active:** *Active* controls whether the app appears in your admin
dashboards. *Publish* controls whether end-users can see it on the public kiosk
portal. An app can be Active but not Published.

### Editing / deleting

- **Edit** a card → same modal pre-filled → **Save Changes**.
- **Delete** a card → confirmation: *"Delete **{name}**? … This action cannot be
  undone."* → **Delete application**.

### Searching & paging

- Type in **Search by name or description…** to filter; an **×** clears it.
- The pager shows *"Showing 1–9 of 12 applications"* with **← Prev / Next →**.

---

## Chapter 4 · Inside an application

Click any application card (or **Edit → open**) to enter its detail page.

🧭 **Applications → {app name}**

📸 `![Application detail with 4 stat cards and sections](images/06-application-detail.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Back to Applications                                                  │
│  Lobby Display                                                           │
│  ┌────────┐ ┌────────┐ ┌───────────┐ ┌──────────┐                       │
│  │   3    │ │   2    │ │     2     │ │    1     │                       │
│  │Devices │ │Cameras │ │Online dev.│ │Dashboards│                       │
│  └────────┘ └────────┘ └───────────┘ └──────────┘                       │
│                                                                          │
│  Devices (3)                                       [+ Add Device]        │
│  ● Lobby controller   fgdhfhjgkhkjk · last update 5d ago  [Edit][Delete]│
│  …                                                                       │
│                                                                          │
│  Dashboards (1)                                    [+ Add Dashboard]     │
│  ▦ Lobby overview   by Sai · updated 2h ago        [Edit][Delete]       │
│                                                                          │
│  Linked Cameras (2)                                [+ Assign Camera]     │
│  📷 Front Door Cam  RTSP  viewers 0  ● Online  Primary  [View Live][Edit][Unlink]│
└────────────────────────────────────────────────────────────────────────┘
```

The four counters are **Devices**, **Cameras**, **Online devices**, and
**Dashboards**. Below them sit three sections.

### 4.1 Devices section

| Action | Result |
|--------|--------|
| **+ Add Device** | Opens the **Add Device** modal (see [Chapter 5](#chapter-5--devices--the-payload-tree)) |
| **Edit** | Edit device name, UID, firmware, description, active |
| **Delete** | *"Delete **{device}**? The device and all its payload data will be permanently removed."* |
| Click a device row | Opens the **Device detail** page (payload tree) |

**Add / Edit Device fields**

| Field | Required | Example |
|-------|----------|---------|
| **Device name** | ✅ | `Lobby controller` |
| **Device UID** | ✅ | `ESP32-AB12` (MAC / Serial / UUID) |
| **Firmware version** | — | `v1.0.3` |
| **Description** | — | `Mounted behind the desk` |
| **Active** | — | ☑ |

### 4.2 Dashboards section

| Action | Result |
|--------|--------|
| **+ Add Dashboard** | Opens the **Add Dashboard** modal |
| **Edit** | Opens the **dashboard editor** ([Chapter 6](#chapter-6--building-a-dashboard)) |
| **Delete** | *"Delete **{dashboard}**? … Device payloads are not affected."* |

**Add / Edit Dashboard fields**

| Field | Required | Example |
|-------|----------|---------|
| **Dashboard name** | ✅ | `Lobby overview` |
| **Description** | — | `Live room status + camera` |
| **Published** | — | ☑ — makes it available to end-users |

### 4.3 Linked Cameras section

| Action | Result |
|--------|--------|
| **+ Assign Camera** | Link an existing camera to this app |
| **View Live** | Opens a live WebRTC stream modal |
| **Edit** | Edit the link's note / primary flag |
| **Unlink** | Removes the link (camera itself stays in the registry) |

**Assign Camera fields**

| Field | Required | Example |
|-------|----------|---------|
| **Camera** | ✅ | Select from the dropdown — `Front Door Cam (kiosk_front)` |
| **Note** | — | `Faces the entrance` |
| **Primary camera** | — | ☑ — main display for this application |

⭐ Only one camera per application can be **Primary**. Assigning a new primary
demotes the previous one automatically.

---

## Chapter 5 · Devices & the payload tree

The device detail page is where you inspect a device's live data, copy its
integration endpoints, and (with permission) edit the payload directly.

🧭 **Applications → {app} → {device}**

📸 `![Device detail: info, integration, payload tree](images/07-device-detail.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  Lobby controller                            ● Online    [Edit] [Delete] │
│                                                                          │
│  Device info                                                             │
│   Device UID  ESP32-AB12      Last payload  5d ago                       │
│   Firmware    v1.0.3          Created  May 29, 2026, 04:40 PM            │
│                               Updated  May 29, 2026, 04:40 PM            │
│                                                                          │
│  Integration endpoints                                                   │
│   HTTPS URL   https://…/applications/push/<token>/        [Copy]         │
│   WSS URL     wss://…/ws/applications/<token>/            [Copy]         │
│   SSL CERTIFICATE                            [Preview] [Download certificate]│
│                                                                          │
│  Payload                                  ● Live · updated just now      │
│   Click a value to edit · click + to add a child      [+ Add root key]   │
│   ▸ motor            (branch)                                            │
│     temperature: 24.7 float                                              │
│     online: true boolean                                                 │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Device info

A read-only summary: **Device UID**, **Firmware**, **Last payload** (relative
time), **Created**, **Updated**.

### 5.2 Integration endpoints

Copy these into your firmware (see the *Hardware Integration Guide*):

| Row | Example | Action |
|-----|---------|--------|
| **HTTPS URL** | `https://your-server/applications/push/<token>/` | **Copy** |
| **WSS URL** | `wss://your-server/ws/applications/<token>/` | **Copy** |
| **SSL certificate** | — | **Preview** the cert text, or **Download certificate** |

⭐ The **Download certificate** button fetches the currently **active** SSL
certificate (managed in [Chapter 10](#chapter-10--ssl-certificates)). If none is
active you'll see *"No active certificate to download."*

### 5.3 The payload tree (live editor)

The payload is the device's live JSON document, shown as an expandable tree. A
status pill shows the WebSocket state: **Live**, **Connecting…**,
**Reconnecting…**, or **Offline**.

**Reading it**
- **Leaf** rows show `key: value type` (e.g. `temperature: 24.7 float`).
- **Branch** rows show just the `key` and can be expanded ▸.
- On mobile the tree scrolls **horizontally** so deep nesting never gets crushed.

**Adding a key** (needs `application_update` and a Live socket)

1. Click **+ Add root key** (or the **+** on any branch). The **New node** form
   opens, showing the parent path (e.g. `/motor`).
2. Fill it in:

| Field | Example | Notes |
|-------|---------|-------|
| **Key** | `rpm` | The field name |
| **Type** | `Integer` | One of: String, Integer, Float, Boolean, Object (dict), Array (list), Branch (empty container) |
| **Value** | `1450` | Input adapts to the type (Boolean → dropdown true/false) |

3. Click **Add**.

**Type → input cheatsheet**

| Type | Value input | Example |
|------|-------------|---------|
| String | text | `running` |
| Integer | text → `0` | `1450` |
| Float | text → `0.0` | `24.7` |
| Boolean | dropdown | `true` / `false` |
| Object (dict) | text → `{ "key": value }` | `{"units":"metric"}` |
| Array (list) | text → `[ 1, 2, 3 ]` | `[24.3, 24.5]` |
| Branch | *(no value — creates an empty container)* | — |

**Editing a value** — click any leaf row. An inline editor lets you change the
**key**, **type**, and **value**, then **Save** or **Cancel**.

**Deleting** — the row's trash icon opens *"Delete key?"* / *"Delete branch?"*
showing the path. Deleting a branch removes everything under it.

⭐ Every edit you make here is sent to the device over the same realtime channel
the hardware uses, so dashboards update instantly.

---

## Chapter 6 · Building a dashboard

The dashboard editor is a drag-and-drop canvas of three containers. You drop
**widgets** onto a cell grid and bind each one to a device payload path.

🧭 **Applications → {app} → Dashboards → {dashboard} → Edit**

📸 `![Dashboard editor with 3 containers and theme picker](images/08-dashboard-editor.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Back to Application      Theme ●●●●●●●●●        [ Preview ]            │
│  ┌──────────────────────────┐ ┌─────────────────────────────────────┐   │
│  │  CAMERA (Container 1)     │ │  WIDGET GRID (Container 2)      [+] │   │
│  │  ● LIVE                   │ │  ▢ ▢ ▢ ▢ ▢ ▢ …  (vertical scroll)  │   │
│  └──────────────────────────┘ └─────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐ [+]   │
│  │  BOTTOM STRIP (Container 3)   ▢ ▢ ▢ …   (horizontal scroll)   │       │
│  └──────────────────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 The three containers

| Container | Role | Scroll |
|-----------|------|--------|
| **1 — Camera** | The application's primary camera feed | — |
| **2 — Widget grid** | Main widget area | Vertical |
| **3 — Bottom strip** | A wide secondary strip | Horizontal |

Each grid container has a **+** button to add a widget there. Widgets snap to a
cell grid; drag to move, drag a corner to resize. Positions are saved
automatically, per container.

### 6.2 Choosing a theme

Use the **Theme** swatch row in the header to recolor the whole dashboard. Nine
light gradient themes are available; every widget border, accent, and gauge
re-tints to match:

`Peach` · `Ocean` · `Mint` · `Lavender` · `Slate` · `Sunset` · `Frost` · `Honey` · `Mustard`

### 6.3 Adding a widget

1. Click the **+** on the container you want to fill. The **Add Widget** picker
   opens.

📸 `![Add Widget picker — categories on the left, gallery on the right](images/09-widget-picker.png)`

2. Pick a **category** on the left, then a **variant** style from the gallery.
3. The **Configure Widget** form appears with a **live preview** on the left and
   fields on the right. Fill it in and click **Add Widget**.

The categories are:

| Category | What it shows | Example variants |
|----------|---------------|------------------|
| **Cards** | Read-only value displays | Simple Value, Comparison, Multi-value grid, Trend, Progress |
| **Controls** | Write-back controls | Toggle, Press Switch, Action button, Multi-action, Stepper, Level Control (slider), Text/Number/List/JSON Entry |
| **Custom Fill** | Level visualisations | Battery, Level Tank 1, Level Tank 2 |
| **Dials** | Gauges | Semi Dial, Full Dial, Progress Dial, Solid Gauge, Threshold Dial, Vehicle Speed |
| **Logs** | Read-only log displays | Log Feed, Console Log, Event Timeline |

> A full list is in [Appendix B](#appendix-b--widget-catalog).

### 6.4 Configuring a widget — the common fields

Most widgets share these configuration sections:

**Widget**
| Field | Required | Example |
|-------|----------|---------|
| **Widget name** | ✅ | `lobby_temp` (internal id) |
| **Title** | — | `Temperature` |
| **Description (subtitle)** | — | `Living room` |

**Appearance**
| Field | Choice |
|-------|--------|
| **Card color** | A swatch from the light palette (Peach, Mint, Sky, Lavender, Honey, …) |
| **Icon / Accent / Fill color** | A solid accent color (Orange, Blue, Green, …) |
| **Icon** *(some variants)* | Pick an icon from the icon search |

**Data binding**
| Field | Example | Notes |
|-------|---------|-------|
| **Device** | `Lobby controller` | The device that holds the value |
| **Payload path** | `sensors/temperature` | Path into the payload tree |
| **Type filter** | auto | Many fields restrict to a type (e.g. a Stepper needs `int`/`float`) |

**Range / unit** *(value & fill & dial widgets)*
| Field | Example |
|-------|---------|
| **Min** | `0` |
| **Max** | `100` |
| **Unit** | `°C`, `%`, `Mbps` |

Click **Add Widget** to place it (or **Save Changes** when editing).

### 6.5 Worked example — a live Temperature dial

1. **+** on Container 2 → **Dials** → **Semi Dial**.
2. **Widget name** `room_temp`, **Title** `Room Temperature`.
3. **Card color** Peach, **Accent** Orange.
4. **Device** `Lobby controller`, **Payload path** `sensors/temperature`.
5. **Min** `0`, **Max** `50`, **Unit** `°C`.
6. **Add Widget**. The gauge now tracks the live value and animates as it
   changes.

### 6.6 Worked example — a Toggle control

1. **+** → **Controls** → **Toggle Card**.
2. **Widget name** `lobby_light`, **Title** `Lobby Light`.
3. **Device** `Lobby controller`, **Target binding** `controls/light`.
4. Set the on/off values (e.g. on → `true`, off → `false`).
5. **Add Widget**. Tapping the toggle writes the value straight to the device.

### 6.7 Worked example — a Logs widget

1. **+** → **Logs** → **Log Feed**.
2. **Widget name** `device_log`, **Title** `Activity Log`, **Rows to show** `50`.
3. **Device** `Lobby controller`, **Log source (list)** `events`.
4. **Add Widget**. The feed renders the device's event list, color-coding
   `info` / `ok` / `warn` / `error` entries.

> The device should append entries with **POST** to that path — see the
> *Hardware Integration Guide* §12.3.

### 6.8 Editing, moving & deleting widgets

- Hover a widget → **✎ Edit** reopens its Configure form (the widget keeps its
  container and position).
- Drag the widget body to move; drag a corner handle to resize.
- **🗑 Delete** removes it after a confirmation.

### 6.9 Preview mode

Click **Preview** (top-right) to see the dashboard exactly as an end-user
would — the cell grid and edit chrome disappear, leaving the polished result.
Press **Esc** or **Exit preview** to return to editing.

---

## Chapter 7 · Cameras

The camera registry holds every stream. Cameras are registered once here, then
**linked** to applications (Chapter 4).

🧭 Top bar → **Cameras**

📸 `![Cameras list with stats and cards](images/10-cameras-list.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  Cameras                                                                 │
│  Register IP/RTSP/WebRTC streams. Status and viewer counts are live.     │
│  ┌──────────┐ ┌────────┐ ┌──────────┐   🔍 Search…       [+ Add Camera]  │
│  │    8     │ │   7    │ │    5     │                                    │
│  │Total cam.│ │ Active │ │Online now│                                    │
│  └──────────┘ └────────┘ └──────────┘                                    │
│  📷 Front Door Cam   ● Online   RTSP  kiosk_front  HK-DS-2CD2            │
│      viewers 0 · Added 4 Jun           [Edit] [Delete]                   │
└────────────────────────────────────────────────────────────────────────┘
```

### Stats

**Total cameras**, **Active**, **Online now** (pulled live from the media
server).

### Registering a camera

1. **+ Add Camera** → the **Add Camera** modal.

📸 `![Add Camera modal](images/11-camera-add-modal.png)`

| Field | Required | Example |
|-------|----------|---------|
| **Camera name** | ✅ | `Front Door Cam` |
| **Model number** | — | `HK-DS-2CD2` |
| **Description** | — | `Faces the main entrance` |
| **Protocol** | ✅ | `RTSP` (also: WebRTC, ONVIF, HTTP, Other) |
| **Stream path** | ✅ | `kiosk_front` (letters, digits, `_`, `-` only) |
| **Source URL** | ✅ | `rtsp://user:pass@host:554/Streaming/Channels/101` |
| **Active** | — | ☑ — show in dashboards and accept viewers |

2. Click **Add Camera**.

### Viewing & managing

- **View Live** (from an application's linked camera, Chapter 4) opens a live
  WebRTC modal with a **Live/Offline** pill and stream metadata.
- **Edit** updates any field (except you can't change the link mode mid-edit).
- **Delete** → *"Delete **{camera}**? The camera will be removed from the media
  server and any dashboards that reference it…"* → **Delete camera**.

### Validation messages

| Message | Fix |
|---------|-----|
| *Camera name is required.* | Fill the name |
| *Protocol is required.* | Choose a protocol |
| *Stream URL is required.* | Provide the source URL |
| *Use letters, digits, "\_" or "-" only…* | Fix the **Stream path** (no spaces/slashes) |

---

## Chapter 8 · Users

🧭 Top bar → **Users**

📸 `![Users table with stats](images/12-users-list.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  Users                                                                   │
│  Create, edit and assign roles to people in your organisation.           │
│  ┌──────────┐ ┌────────┐ ┌──────────┐  🔍 Search… ☐ Show deleted [+ Add User]│
│  │    24    │ │   22   │ │    2     │                                    │
│  │Total users│ │ Active │ │ Deleted  │                                   │
│  └──────────┘ └────────┘ └──────────┘                                    │
│  User            Contact              Roles        Created     Actions   │
│  👤 Sai (you)    sai@…  · 99999 99999 SuperAdmin   29 May      [Edit][Delete]│
└────────────────────────────────────────────────────────────────────────┘
```

### The table

Columns: **User** (avatar + name, "you" chip for yourself), **Contact**
(email + mobile), **Roles** (chips), **Created**, **Actions**.

Toggle **Show deleted** to view soft-deleted users (who can be **Restored**).

### Creating a user

1. **+ Add User** → the **Add User** modal.

📸 `![Add User modal with role picker](images/13-user-add-modal.png)`

| Field | Required | Example |
|-------|----------|---------|
| **Name** | ✅ | `Anita Rao` |
| **Email** | ✅ | `anita@myaccessio.com` |
| **Country code** | — | `+91` |
| **Mobile** | ✅ | `99999 99999` |
| **Password** | ✅ | Choose **Auto-generate** *or* **Set custom** (≥ 8 chars) |
| **Roles** | ✅ | Click role chips to assign (at least one) |

2. Click **Create User**.

⭐ **Auto-generate** creates a secure password for you; switch to **Set custom**
to type your own. In **Edit User**, the password field becomes *"New password
(leave blank to keep)"*.

### Editing / deleting / restoring

- **Edit** → same form (password optional) → **Save Changes**.
- **Delete** → *soft-delete*: *"The user is soft-deleted — they can be restored
  from the 'Show deleted' list later."* You **cannot delete yourself**.
- **Restore** (on a deleted row) brings the user back.

---

## Chapter 9 · Roles & permissions

Roles bundle permissions. Every user has one or more roles; the union of their
permissions decides what they can do.

🧭 Top bar → **Roles**

📸 `![Roles & permissions — roles list + permission catalog](images/14-roles.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  Roles & Permissions                                                     │
│  Define roles and choose what each one can do across the platform.       │
│  ┌────────┐ ┌────────────┐ ┌──────────┐  🔍 Search…       [+ Add Role]   │
│  │   3    │ │     23     │ │    6     │                                  │
│  │ Roles  │ │Permissions │ │ Policies │                                  │
│  └────────┘ └────────────┘ └──────────┘                                  │
│  ┌───────────────── Roles ──────────────┐ ┌──── Permission catalog ────┐ │
│  │ 🛡 SuperAdmin   20 perms · 6 policies ▾│ │ USER                       │ │
│  │    Full system access.   SYSTEM [Edit]│ │  View User  Create User …  │ │
│  │ 🛡 Default      4 perms  SYSTEM  [Edit]│ │ APPLICATION                │ │
│  │ 🛡 Test Role    6 perms        [Edit][Delete]│  View Application …     │ │
│  └──────────────────────────────────────┘ └────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### The layout

- **Left — Roles**: each role expands (▾) to show its permissions grouped by
  policy. System roles carry a **SYSTEM** chip and can't be deleted.
- **Right — Permission catalog**: the master list of every permission, grouped
  by policy.

Both panels scroll independently and have their own paging.

### Creating a role

1. **+ Add Role** → the **Add Role** modal.

📸 `![Add Role modal with permission picker](images/15-role-add-modal.png)`

| Field | Required | Example |
|-------|----------|---------|
| **Name** | ✅ | `Kiosk Operator` |
| **Description** | — | `Can view apps & control dashboards` |
| **Permissions** | ✅ | Tick permission chips, grouped by policy. Each group has **Select all** / **Clear** |

2. The label shows a live count: *"Permissions (5 selected)"*.
3. Click **Create Role**.

### Editing / deleting

- **Edit** → same modal → **Save Changes**.
- **Delete** → *"…Any user who currently holds only this role will be reassigned
  to the **Default** role…"* → **Delete role**.
- System roles (e.g. **SuperAdmin**, **Default**) show *"…is a system role and
  cannot be deleted."*

> The full permission list is in [Appendix A](#appendix-a--permission-reference).

---

## Chapter 10 · SSL certificates

This page manages the SSL certificate that kiosk hardware downloads to trust the
backend over HTTPS/WSS. **Only one certificate is active at a time** — uploading
a new one (or reactivating an old one) moves the previous active certificate to
**Expired**.

🧭 Top bar → **SSL Cert** *(needs `ssl_certificate_view`)*

📸 `![SSL Certificate page — upload bar + records](images/16-ssl-certificate.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  SSL Certificate                                                         │
│  Upload new certificate  [Choose File] [Label (optional)] [Upload as active]│
│                                            replaces server.crt           │
│                                                                          │
│  Certificate records (3)                                                 │
│  ● server.crt   Active    server.crt · 1.4 KB · uploaded 4 Jun  [Preview][Download]│
│  ○ alice.crt    Expired   alice.crt  · 1.4 KB · uploaded 1 Jun           │
│                                       [Preview][Download][Reactivate][Delete]│
│  Showing 1–3 of 3 certificates        ← Prev   Page 1 of 1   Next →      │
└────────────────────────────────────────────────────────────────────────┘
```

### Uploading

1. In the upload bar, click **Choose File** and pick a `.crt` / `.pem` / `.cer`
   / `.der` file.
2. *(Optional)* type a **Label** (defaults to the file name).
3. Click **Upload as active**. The new file becomes active; a toast confirms
   *"… moved to expired. New certificate is now active."*

### Records list

Each row shows a status dot, **name**, an **Active** (green) / **Expired** (gray)
pill, and meta (filename · size · upload time · uploaded-by).

| Action | Available on | Effect |
|--------|--------------|--------|
| **Preview** | any | Opens the cert text in a modal (with **Copy**) |
| **Download** | any | Downloads the file |
| **Reactivate** | expired rows | Makes it active (asks to confirm; demotes the current active to expired) |
| **Delete** | expired rows | Removes it (the active cert can't be deleted) |

⚠️ You can't delete the **active** certificate — upload a replacement first.

---

## Chapter 11 · Your profile

🧭 Top bar → **{Your name} ▾ → Profile**

📸 `![Profile — identity, account details, change password, permissions](images/17-profile.png)`

```
┌────────────────────────────────────────────────────────────────────────┐
│  Your Profile                                                            │
│  View your account, update your details and change your password.        │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 👤  Sai                                                             │ │
│  │     sai@myaccessio.com · +91 99999 99999     [SuperAdmin]          │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  Account details  (Read only)        Change password                     │
│   Name   Sai                          Current password  [……… 👁]         │
│   Email  sai@…                        New password      [……… 👁]         │
│   Mobile +91 99999 99999              Confirm new pass  [……… 👁]         │
│   Member since  Jan 2026              [ Change password ]                │
│  Permissions (23)                                                        │
│   USER  View User  Create User …                                         │
└────────────────────────────────────────────────────────────────────────┘
```

### Sections

- **Identity card** — your avatar, name, email · mobile, and role chips.
- **Account details** *(read-only)* — Name, Email, Country code, Mobile, Member
  since. *To change these, contact an administrator.*
- **Change password** — Current / New / Confirm (each with a 👁 toggle).
- **Permissions** *(read-only)* — every permission your roles grant, grouped by
  policy.

### Changing your password

| Field | Required | Rule |
|-------|----------|------|
| **Current password** | ✅ | Your existing password |
| **New password** | ✅ | At least 8 characters; must differ from current |
| **Confirm new password** | ✅ | Must match New password |

Click **Change password** (shows **Updating…**). On success a toast reads
*"Password changed successfully."*

---

## Appendix A · Permission reference

Permissions are grouped by **policy**. Assign them to roles in
[Chapter 9](#chapter-9--roles--permissions).

| Policy | Permission (short name) | Unlocks |
|--------|-------------------------|---------|
| **User** | `user_view` | See the Users page & list |
| | `user_create` | Add users |
| | `user_update` | Edit users |
| | `user_delete` | Soft-delete users |
| | `user_restore` | Restore deleted users |
| **Role** | `role_view` | See the Roles page |
| | `role_create` | Add roles |
| | `role_update` | Edit roles |
| | `role_delete` | Delete roles |
| **Camera** | `camera_view` | See the Cameras page |
| | `camera_create` | Add cameras |
| | `camera_update` | Edit cameras |
| | `camera_delete` | Delete cameras |
| **Application** | `application_view` | See applications, devices, dashboards |
| | `application_create` | Add applications |
| | `application_update` | Edit apps/devices/dashboards, build dashboards, edit payloads, link cameras |
| | `application_delete` | Delete applications |
| **SSLCertificate** | `ssl_certificate_view` | See the SSL Certificate page |
| | `ssl_certificate_upload` | Upload / reactivate certificates |
| | `ssl_certificate_delete` | Delete expired certificates |

⭐ A device's payload editing and dashboard building both fall under
`application_update`.

---

## Appendix B · Widget catalog

Every widget you can drop on a dashboard ([Chapter 6](#chapter-6--building-a-dashboard)).

### Cards (read-only values)
| Variant | Shows |
|---------|-------|
| Simple Value | One big number + title |
| Simple Icon | Value with an icon |
| Comparison | Two values side by side |
| Multi-value grid | A 2×2 grid of values |
| Multi-value row | Several values in a row |
| Trend | Value + sparkline |
| Progress | Value with a progress bar |

### Controls (write back to the device)
| Variant | Action |
|---------|--------|
| Toggle Card | On/off switch |
| Dual Toggle | Two independent switches |
| Press Switch | Momentary push |
| Action Card | Single action button |
| Multi Action | Several action buttons |
| Stepper | − / + numeric stepper |
| Level Control | − / + with a level bar (slider) |
| Text Entry | Type + send a string |
| Number Entry | Type + send a number (with unit) |
| List Entry | Edit a JSON array + send |
| JSON Entry | Edit a JSON object + send |

### Custom Fill
| Variant | Shows |
|---------|-------|
| Battery | Battery fill level |
| Level Tank 1 | Rectangular tank fill |
| Level Tank 2 | Spherical tank fill |

### Dials / gauges
| Variant | Shows |
|---------|-------|
| Semi Dial | 180° needle gauge |
| Full Dial | 270° dot gauge |
| Progress Dial | 270° with color zones |
| Solid Gauge | Filled arc |
| Threshold Dial | Gauge that adapts to data |
| Vehicle Speed | Speedometer style |

### Logs (read-only)
| Variant | Shows |
|---------|-------|
| Log Feed | A list of log lines with level dots + timestamps |
| Console Log | Terminal-style monospace log |
| Event Timeline | Vertical timeline with markers |

---

<div align="center">

**Smart Kiosk Control Dashboard — Administrator User Manual · v1.0**
*by MYACCESS PRIVATE LIMITED*

To finish the manual, capture each page and save it to the `images/` path shown
at every 📸 placeholder.

</div>
