/**
 * Resolve the backend base URL at runtime so the app works whether you open
 * it on localhost or on a phone hitting the dev machine's LAN IP.
 *
 *   - VITE_API_BASE_URL is honored if set (build-time override).
 *   - Otherwise: if the page itself is on localhost/127.0.0.1, we call the
 *     backend on localhost. If it's any other host (a LAN IP, *.local,
 *     ngrok subdomain), we reuse the same host on the backend port so the
 *     phone never tries to reach the developer's own loopback.
 *   - Page protocol (http/https) is preserved.
 */
const BACKEND_PORT = '8001'

function resolveApiBase() {
  const override = import.meta.env.VITE_API_BASE_URL
  if (override) return override.replace(/\/$/, '')

  const loc = typeof window !== 'undefined' ? window.location : null
  const host = loc?.hostname || 'localhost'
  const protocol = loc?.protocol === 'https:' ? 'https:' : 'http:'

  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  const apiHost = isLoopback ? 'localhost' : host

  return `${protocol}//${apiHost}:${BACKEND_PORT}/api`
}

const API_BASE = resolveApiBase()
// Cameras live under a sibling URL prefix (/cameraapi/) instead of /api/,
// but on the same host/port. Compute it from API_BASE so it tracks the
// runtime host (localhost vs LAN IP).
const CAMERAS_BASE = API_BASE.replace(/\/api\/?$/, '/cameraapi')
// Applications are mounted at /applications/ on the same host.
const APPS_BASE = API_BASE.replace(/\/api\/?$/, '/applications')

const ACCESS_KEY = 'kiosk_access'
const REFRESH_KEY = 'kiosk_refresh'
const USER_KEY = 'kiosk_user'
const REMEMBER_KEY = 'kiosk_remember_id'   // identifier saved across browser closes
const REMEMBER_FLAG = 'kiosk_remember'     // '1' if user picked Remember Me

export class ApiError extends Error {
  constructor(message, { status, data, network = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.network = network
  }
}

/* ============================================================
   Token + user storage helpers

   Remember Me semantics:
   - remember=true  → tokens go to localStorage    (survives browser close)
                       + identifier saved to localStorage so the login form
                         pre-fills next visit.
   - remember=false → tokens go to sessionStorage  (cleared on browser close)
                       + identifier wiped from localStorage.
   ============================================================ */
function readFromBoth(key) {
  return sessionStorage.getItem(key) ?? localStorage.getItem(key)
}

export const auth = {
  setSession({ access, refresh, user, remember = false }) {
    const store = remember ? localStorage : sessionStorage
    const other = remember ? sessionStorage : localStorage
    // Always wipe the other store first so we never leak across modes.
    other.removeItem(ACCESS_KEY)
    other.removeItem(REFRESH_KEY)
    other.removeItem(USER_KEY)
    if (access) store.setItem(ACCESS_KEY, access)
    if (refresh) store.setItem(REFRESH_KEY, refresh)
    if (user) store.setItem(USER_KEY, JSON.stringify(user))
    if (remember) {
      localStorage.setItem(REMEMBER_FLAG, '1')
    } else {
      localStorage.removeItem(REMEMBER_FLAG)
    }
  },

  clear() {
    for (const s of [localStorage, sessionStorage]) {
      s.removeItem(ACCESS_KEY)
      s.removeItem(REFRESH_KEY)
      s.removeItem(USER_KEY)
    }
    // Note: REMEMBER_KEY (identifier) is intentionally NOT cleared on logout,
    // so the user's email/mobile remains pre-filled until they uncheck the box.
  },

  getAccess: () => readFromBoth(ACCESS_KEY),
  getRefresh: () => readFromBoth(REFRESH_KEY),
  getUser: () => {
    try { return JSON.parse(readFromBoth(USER_KEY) || 'null') }
    catch { return null }
  },
  isAuthenticated: () => !!readFromBoth(ACCESS_KEY),

  /** Remember-Me identifier (email / mobile) — only the username, never the password. */
  setRememberedId: (id) => {
    if (id) localStorage.setItem(REMEMBER_KEY, id)
    else localStorage.removeItem(REMEMBER_KEY)
  },
  getRememberedId: () => localStorage.getItem(REMEMBER_KEY) || '',
  hasRememberFlag: () => localStorage.getItem(REMEMBER_FLAG) === '1',

  /**
   * Permission helpers — backed by the user.roles[].permissions[] tree that
   * the login + /me/ endpoints return. The backend is the source of truth;
   * these are only used to hide / disable UI controls the user couldn't act
   * on anyway. A user who has *any* role granting the named permission
   * passes the check.
   *
   *   auth.hasPerm('camera_create')
   *   auth.hasAnyPerm(['user_update', 'user_delete'])
   *   auth.permSet()  // Set of all short_names the current user holds
   */
  permSet: () => {
    const user = (() => { try { return JSON.parse(readFromBoth(USER_KEY) || 'null') } catch { return null } })()
    const set = new Set()
    if (!user || !Array.isArray(user.roles)) return set
    for (const role of user.roles) {
      for (const p of (role?.permissions || [])) {
        if (p?.short_name) set.add(p.short_name)
      }
    }
    return set
  },
  hasPerm: (shortName) => auth.permSet().has(shortName),
  hasAnyPerm: (shortNames) => {
    const s = auth.permSet()
    return shortNames.some((n) => s.has(n))
  },
}

/* ============================================================
   Core fetch wrapper
   ============================================================ */
async function request(path, { json, headers = {}, withAuth = false, ...rest } = {}) {
  const finalHeaders = { Accept: 'application/json', ...headers }
  if (json !== undefined) finalHeaders['Content-Type'] = 'application/json'
  if (withAuth) {
    const token = auth.getAccess()
    if (token) finalHeaders.Authorization = `Bearer ${token}`
  }

  // Absolute URLs (e.g. for /cameraapi/ which lives outside API_BASE) are
  // used verbatim; relative paths are prefixed with API_BASE.
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`

  let resp
  try {
    resp = await fetch(url, {
      ...rest,
      headers: finalHeaders,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch (e) {
    throw new ApiError(
      "Couldn't reach the server. Is the backend running on " + API_BASE + '?',
      { network: true }
    )
  }

  const text = await resp.text()
  const data = text ? safeParse(text) : null

  if (!resp.ok) {
    throw new ApiError(
      typeof data === 'object' && data && 'detail' in data ? String(data.detail) : 'Request failed',
      { status: resp.status, data }
    )
  }
  return data
}

function safeParse(text) {
  try { return JSON.parse(text) } catch { return text }
}

/* ============================================================
   Error helpers
   ============================================================ */
/**
 * Turn a DRF error response into structured field + form errors.
 *
 * DRF shapes we handle:
 *   {"detail": "..."}                  → form
 *   {"detail": ["..."]}                → form
 *   {"email": ["..."], ...}            → fields
 *   {"non_field_errors": ["..."]}      → form
 *
 * `fieldMap` lets you remap server field names to UI field names,
 * e.g. { email_or_mobile: 'email' }.
 */
export function parseApiErrors(err, knownFields = [], fieldMap = {}) {
  const fields = Object.fromEntries(knownFields.map((f) => [f, []]))
  const form = []

  if (err?.network) {
    form.push(err.message)
    return { fields, form }
  }

  const data = err?.data
  if (data == null) {
    form.push(err?.message || 'Something went wrong.')
    return { fields, form }
  }

  if (typeof data === 'string') {
    form.push(data)
    return { fields, form }
  }

  for (const [rawKey, value] of Object.entries(data)) {
    const key = fieldMap[rawKey] || rawKey
    const msgs = Array.isArray(value) ? value.map(String) : [String(value)]
    if (key === 'detail' || key === 'non_field_errors') {
      form.push(...msgs)
    } else if (key in fields) {
      fields[key].push(...msgs)
    } else {
      form.push(`${humanise(rawKey)}: ${msgs.join(' ')}`)
    }
  }
  return { fields, form }
}

function humanise(key) {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/* ============================================================
   Endpoints
   ============================================================ */
export const api = {
  login: ({ email, password }) =>
    request('/login/', {
      method: 'POST',
      json: { email_or_mobile: email, password },
    }),

  refresh: (refresh) =>
    request('/token/refresh/', { method: 'POST', json: { refresh } }),

  verify: (token) =>
    request('/token/verify/', { method: 'POST', json: { token } }),

  forgotPassword: ({ email }) =>
    request('/forgot-password/', {
      method: 'POST',
      json: { email_or_mobile: email },
    }),

  resetPassword: ({ token, newPassword }) =>
    request('/reset-password/', {
      method: 'POST',
      json: { token, new_password: newPassword },
    }),

  /* -------- Self ("me") -------- */
  me: () =>
    request('/me/', { withAuth: true }),
  updateMe: (data) =>
    request('/me/', { method: 'PATCH', json: data, withAuth: true }),
  changeMyPassword: ({ currentPassword, newPassword }) =>
    request('/me/password/', {
      method: 'POST',
      withAuth: true,
      json: { current_password: currentPassword, new_password: newPassword },
    }),

  /* -------- Users -------- */
  listUsers: ({ showDeleted = false, page = 1, pageSize = 10, q = '' } = {}) => {
    const params = new URLSearchParams()
    if (showDeleted) params.set('show_deleted', 'true')
    if (page) params.set('page', page)
    if (pageSize) params.set('page_size', pageSize)
    if (q) params.set('q', q)
    const qs = params.toString()
    return request(`/users/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getUser: (id) =>
    request(`/users/${id}/`, { withAuth: true }),
  createUser: (data) =>
    request('/users/', { method: 'POST', json: data, withAuth: true }),
  updateUser: (id, data) =>
    request(`/users/${id}/`, { method: 'PATCH', json: data, withAuth: true }),
  deleteUser: (id) =>
    request(`/users/${id}/`, { method: 'DELETE', withAuth: true }),
  restoreUser: (id) =>
    request(`/users/${id}/restore/`, { method: 'POST', withAuth: true }),
  changeUserPassword: (id, { currentPassword, newPassword }) =>
    request(`/users/${id}/change-password/`, {
      method: 'POST',
      withAuth: true,
      json: { current_password: currentPassword, new_password: newPassword },
    }),

  /* -------- Roles -------- */
  listRoles: ({ page = 1, pageSize = 10, q = '' } = {}) => {
    const params = new URLSearchParams()
    if (page) params.set('page', page)
    if (pageSize) params.set('page_size', pageSize)
    if (q) params.set('q', q)
    const qs = params.toString()
    return request(`/roles/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getRole: (id) =>
    request(`/roles/${id}/`, { withAuth: true }),
  createRole: (data) =>
    request('/roles/', { method: 'POST', json: data, withAuth: true }),
  updateRole: (id, data) =>
    request(`/roles/${id}/`, { method: 'PATCH', json: data, withAuth: true }),
  deleteRole: (id) =>
    request(`/roles/${id}/`, { method: 'DELETE', withAuth: true }),

  /* -------- Permissions (read-only catalog) -------- */
  listPermissions: () =>
    request('/permissions/', { withAuth: true }),

  /* -------- Applications (mounted at /applications/ — not /api/) --------
     Application image upload uses multipart/form-data, so the helpers accept
     either a plain object (JSON body) or a FormData instance (multipart).
     The request() wrapper leaves Content-Type unset for FormData so the
     browser sets the right multipart boundary. */
  listApplications: ({ isActive } = {}) => {
    const params = new URLSearchParams()
    if (isActive === true)  params.set('is_active', 'true')
    if (isActive === false) params.set('is_active', 'false')
    const qs = params.toString()
    return request(`${APPS_BASE}/applications/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getApplication: (id) =>
    request(`${APPS_BASE}/applications/${id}/`, { withAuth: true }),
  createApplication: (body) => {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    return request(`${APPS_BASE}/applications/`, {
      method: 'POST',
      withAuth: true,
      ...(isForm ? { body } : { json: body }),
    })
  },
  updateApplication: (id, body) => {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    return request(`${APPS_BASE}/applications/${id}/`, {
      method: 'PATCH',
      withAuth: true,
      ...(isForm ? { body } : { json: body }),
    })
  },
  deleteApplication: (id) =>
    request(`${APPS_BASE}/applications/${id}/`, { method: 'DELETE', withAuth: true }),

  /* -------- Devices (under an Application) -------- */
  listDevices: ({ application } = {}) => {
    const params = new URLSearchParams()
    if (application != null) params.set('application', application)
    const qs = params.toString()
    return request(`${APPS_BASE}/devices/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getDevice: (id) =>
    request(`${APPS_BASE}/devices/${id}/`, { withAuth: true }),
  createDevice: (data) =>
    request(`${APPS_BASE}/devices/`, { method: 'POST', json: data, withAuth: true }),
  updateDevice: (id, data) =>
    request(`${APPS_BASE}/devices/${id}/`, { method: 'PATCH', json: data, withAuth: true }),
  deleteDevice: (id) =>
    request(`${APPS_BASE}/devices/${id}/`, { method: 'DELETE', withAuth: true }),

  /** Paginated POST history for a device (the Firebase-RTDB "child node"
   *  store). Cursor-based — pass `cursor` from the previous response's
   *  next_cursor to walk older pages. */
  listDeviceEvents: ({ device, path, limit, cursor, since } = {}) => {
    const params = new URLSearchParams()
    if (device != null) params.set('device', device)
    if (path != null)   params.set('path', path)
    if (limit != null)  params.set('limit', limit)
    if (cursor != null) params.set('cursor', cursor)
    if (since != null)  params.set('since', since)
    const qs = params.toString()
    return request(`${APPS_BASE}/device-events/${qs ? '?' + qs : ''}`, { withAuth: true })
  },

  /* -------- Dashboards (per Application) -------- */
  listDashboards: ({ application } = {}) => {
    const params = new URLSearchParams()
    if (application != null) params.set('application', application)
    const qs = params.toString()
    return request(`${APPS_BASE}/dashboards/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getDashboard: (id) =>
    request(`${APPS_BASE}/dashboards/${id}/`, { withAuth: true }),
  createDashboard: (body) => {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    return request(`${APPS_BASE}/dashboards/`, {
      method: 'POST',
      withAuth: true,
      ...(isForm ? { body } : { json: body }),
    })
  },
  updateDashboard: (id, body) => {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    return request(`${APPS_BASE}/dashboards/${id}/`, {
      method: 'PATCH',
      withAuth: true,
      ...(isForm ? { body } : { json: body }),
    })
  },
  deleteDashboard: (id) =>
    request(`${APPS_BASE}/dashboards/${id}/`, { method: 'DELETE', withAuth: true }),

  /* -------- Dashboard widgets (DashboardComponent rows) --------
     A widget's `config` is a free-form JSON blob shaped like:
       {
         "title": "…",
         "bindings": [{ "device_id": 12, "payload_path": "sensors/temp" }, …],
         "static":   { "unit": "°C", "min": 0, "max": 100, "write_value": true, … },
         "ui":       { "icon": "thermometer", "color": "orange" }
       }
     Each widget binds to one or more devices/payload paths — the renderer
     subscribes to each device's WebSocket and reads / writes the path. */
  listDashboardComponents: ({ dashboard } = {}) => {
    const params = new URLSearchParams()
    if (dashboard != null) params.set('dashboard', dashboard)
    const qs = params.toString()
    return request(`${APPS_BASE}/dashboard-components/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getDashboardComponent: (id) =>
    request(`${APPS_BASE}/dashboard-components/${id}/`, { withAuth: true }),
  createDashboardComponent: (data) =>
    request(`${APPS_BASE}/dashboard-components/`, { method: 'POST', json: data, withAuth: true }),
  updateDashboardComponent: (id, data) =>
    request(`${APPS_BASE}/dashboard-components/${id}/`, { method: 'PATCH', json: data, withAuth: true }),
  deleteDashboardComponent: (id) =>
    request(`${APPS_BASE}/dashboard-components/${id}/`, { method: 'DELETE', withAuth: true }),

  /* -------- Application ↔ Camera links -------- */
  listAppCameras: ({ application } = {}) => {
    const params = new URLSearchParams()
    if (application != null) params.set('application', application)
    const qs = params.toString()
    return request(`${APPS_BASE}/application-cameras/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  createAppCamera: (data) =>
    request(`${APPS_BASE}/application-cameras/`, { method: 'POST', json: data, withAuth: true }),
  updateAppCamera: (id, data) =>
    request(`${APPS_BASE}/application-cameras/${id}/`, { method: 'PATCH', json: data, withAuth: true }),
  deleteAppCamera: (id) =>
    request(`${APPS_BASE}/application-cameras/${id}/`, { method: 'DELETE', withAuth: true }),

  /* -------- Cameras (mounted at /cameraapi/ — not /api/) -------- */
  listCameras: ({ isActive } = {}) => {
    const params = new URLSearchParams()
    if (isActive === true) params.set('is_active', 'true')
    if (isActive === false) params.set('is_active', 'false')
    const qs = params.toString()
    return request(`${CAMERAS_BASE}/cameras/${qs ? '?' + qs : ''}`, { withAuth: true })
  },
  getCamera: (id) =>
    request(`${CAMERAS_BASE}/cameras/${id}/`, { withAuth: true }),
  createCamera: (data) =>
    request(`${CAMERAS_BASE}/cameras/`, { method: 'POST', json: data, withAuth: true }),
  updateCamera: (id, data) =>
    request(`${CAMERAS_BASE}/cameras/${id}/`, { method: 'PATCH', json: data, withAuth: true }),
  deleteCamera: (id) =>
    request(`${CAMERAS_BASE}/cameras/${id}/`, { method: 'DELETE', withAuth: true }),

  /* -------- Public (no auth) endpoints --------
     These hit `applications/api/public/...` which the backend serves
     without an Authorization header. Used by /public landing page and
     the public dashboard view-only page. */
  publicListApplications: () =>
    request(`${APPS_BASE}/public/applications/`),
  publicGetApplication: (id) =>
    request(`${APPS_BASE}/public/applications/${id}/`),
  publicListDashboards: ({ application } = {}) => {
    const params = new URLSearchParams()
    if (application != null) params.set('application', application)
    const qs = params.toString()
    return request(`${APPS_BASE}/public/dashboards/${qs ? '?' + qs : ''}`)
  },
  // One-shot loader: returns { dashboard, application, cameras, components, devices }
  publicLoadDashboard: (dashboardId) =>
    request(`${APPS_BASE}/public/dashboards/${dashboardId}/load/`),
  // Aggregate stats for the /public analytics overview:
  //   { totals: {...}, applications: [{id, name, dashboards, devices, cameras, ...}] }
  publicAnalytics: () =>
    request(`${APPS_BASE}/public/analytics/`),

  /* -------- SSL Certificate management (admin) -------- */
  listSSLCertificates: () =>
    request(`${APPS_BASE}/ssl-certificates/`, { withAuth: true }),
  uploadSSLCertificate: ({ name, description, file, isActive = true }) => {
    const fd = new FormData()
    fd.append('name', name)
    if (description) fd.append('description', description)
    fd.append('file', file)
    fd.append('is_active', isActive ? 'true' : 'false')
    return request(`${APPS_BASE}/ssl-certificates/`, {
      method: 'POST',
      body: fd,
      withAuth: true,
    })
  },
  deleteSSLCertificate: (id) =>
    request(`${APPS_BASE}/ssl-certificates/${id}/`, { method: 'DELETE', withAuth: true }),
  setActiveSSLCertificate: (id) =>
    request(`${APPS_BASE}/ssl-certificates/${id}/`, {
      method: 'PATCH',
      json: { is_active: true },
      withAuth: true,
    }),
}
