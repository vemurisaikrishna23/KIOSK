import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied } from './Cameras.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'

function formatRelative(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!then) return ''
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (sec < 5)     return 'just now'
  if (sec < 60)    return `${sec}s ago`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
function formatAbsolute(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

export default function DeviceDetail() {
  const { appId, deviceId } = useParams()
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView   = auth.hasPerm('application_view')
  const canUpdate = auth.hasPerm('application_update')
  const canDelete = auth.hasPerm('application_delete')

  const [device, setDevice]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Modals
  const [editing, setEditing]   = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast]       = useState(null)

  // WebSocket — hoisted so the polling effect and tree can both react.
  const wsRef = useRef(null)
  const [wsStatus, setWsStatus] = useState('idle') // idle | connecting | live | offline

  // Pending node-delete confirmation (replaces window.confirm). Carries
  // enough context for the modal copy: { name, path, kind: 'leaf'|'branch' }
  const [confirmNode, setConfirmNode] = useState(null)

  // Paths whose children have been fetched (depth=1) at least once.
  // Ref instead of state — we don't need to re-render on changes, the
  // tree re-renders via setDevice when the fetched data arrives.
  const loadedPathsRef = useRef(new Set([''])) // root is shallow-loaded on subscribe

  useEffect(() => {
    if (!toast) return
    // Errors stick around long enough to actually read; success toasts
    // dismiss quickly so they don't get in the way of repeated edits.
    const ms = toast.type === 'error' ? 8000 : 3500
    const t = setTimeout(() => setToast(null), ms)
    return () => clearTimeout(t)
  }, [toast])

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!canView) { setLoading(false); return }
    if (!silent) { setLoading(true); setError(null) }
    try {
      const data = await api.getDevice(deviceId)
      setDevice(data)
    } catch (e) {
      if (!silent) {
        setError(
          e?.network ? 'Could not reach the server.' :
          e?.status === 404 ? 'Device not found.' :
          'Failed to load device.'
        )
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [deviceId, canView])

  useEffect(() => { load() }, [load])

  // Background poll — fallback only. Stops the moment the WebSocket is
  // connected because the WS pushes state diffs directly (zero HTTP cost
  // per change). Resumes if the WS drops, so the page never goes stale.
  useEffect(() => {
    if (!canView) return
    if (wsStatus === 'live') return
    let timer = null
    function tick() { load({ silent: true }) }
    function start() { if (!timer) timer = setInterval(tick, 15000) }
    function stop()  { if (timer) { clearInterval(timer); timer = null } }
    function onVisibility() { if (document.hidden) stop(); else { tick(); start() } }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load, canView, wsStatus])

  const payloadStr = useMemo(() => {
    try { return JSON.stringify(device?.payload ?? {}, null, 2) }
    catch { return String(device?.payload ?? '') }
  }, [device?.payload])

  /* Apply a WS-broadcast diff to local state — no extra HTTP round-trip. */
  function applyLocalDiff(action, rawPath, value) {
    setDevice((prev) => {
      if (!prev) return prev
      const next = { ...prev, payload: applyPayloadDiff(prev.payload || {}, action, rawPath, value) }
      next.last_payload_update = new Date().toISOString()
      return next
    })
  }

  // WebSocket — single connection with exponential-backoff reconnect, that:
  //   • broadcasts state changes back to us (so we never need to poll), and
  //   • is the channel the tree sends put / patch / post / delete on.
  //
  // The reconnect loop survives network blips, daphne restarts, sleep/wake
  // cycles. Attempts back off 1s → 2s → 4s → ... capped at 30s. The loop
  // is killed when the component unmounts OR when the server closes with
  // an auth-failure code (4001 — invalid token, no point retrying).
  useEffect(() => {
    if (!canView || !device?.device_token) return

    const loc   = typeof window !== 'undefined' ? window.location : null
    const host  = loc?.hostname || 'localhost'
    const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
    const url   = `${proto}//${host}:8001/ws/applications/${device.device_token}/?type=web`

    let cancelled      = false
    let reconnectTimer = null
    let attempt        = 0
    let currentWs      = null

    function scheduleReconnect() {
      if (cancelled) return
      attempt += 1
      // 1, 2, 4, 8, 16, 30, 30, ... (jittered by ±20% so a herd of clients
      // doesn't pile back onto the server in lock-step after an outage).
      const base   = Math.min(30000, 1000 * Math.pow(2, attempt - 1))
      const jitter = base * (0.8 + Math.random() * 0.4)
      reconnectTimer = setTimeout(connect, jitter)
    }

    function connect() {
      if (cancelled) return
      setWsStatus(attempt === 0 ? 'connecting' : 'reconnecting')

      let ws
      try { ws = new WebSocket(url) }
      catch { setWsStatus('offline'); scheduleReconnect(); return }
      currentWs    = ws
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) { try { ws.close() } catch {} ; return }
        attempt = 0
        setWsStatus('live')
        // Subscribe shallow — only the root's immediate children.
        // Branches lazy-load when the user expands them.
        try { ws.send(JSON.stringify({ action: 'subscribe', paths: ['/'], depth: 1 })) } catch {}
        // The root counts as "loaded" after this subscribe response —
        // root keys are returned immediately. Nested branches start
        // empty and are populated on demand.
        loadedPathsRef.current = new Set([''])
      }

      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null
        currentWs = null
        if (cancelled) return
        setWsStatus('offline')
        // 4001 = invalid token. The server told us our credential is bad —
        // looping reconnect would just fail forever, burn CPU, and spam
        // the access log. Stop the loop in that case.
        if (event && event.code === 4001) return
        scheduleReconnect()
      }

      // onerror always fires before onclose, but we let onclose drive the
      // reconnect so we don't double-schedule.
      ws.onerror = () => {}

      ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      // Server-side validation / processing errors — surface them as a
      // toast so the user sees WHY their click did nothing. Includes the
      // action + path of the most recent command so the message is
      // self-explanatory ("PATCH /Device1 — Field 'x' expects boolean").
      if (msg?.status === 'error') {
        const last = lastCommandRef.current
        const prefix = last ? `${last.action.toUpperCase()} /${last.path || ''} — ` : ''
        setToast({
          type: 'error',
          text: prefix + (msg?.message || 'Server rejected the operation.'),
        })
        return
      }

      // Hardware connection flipped — update the device's is_connected
      // locally so the Online/Offline pill changes without a refresh.
      if (msg?.type === 'device_event' && msg?.event === 'device_status') {
        const isConnected = !!msg?.payload?.is_connected
        setDevice((d) => d ? { ...d, is_connected: isConnected } : d)
        return
      }

      // State changes (put / patch / delete / post) — apply the diff to
      // local state directly. No HTTP round-trip.
      if (msg?.type === 'device_event' && ['put', 'patch', 'delete', 'post'].includes(msg?.action)) {
        // POSTs also write to the live tree as an auto-keyed child, so
        // they're applied the same way as a put.
        applyLocalDiff(msg.action === 'post' ? 'put' : msg.action, msg.path || '', msg.payload)
        return
      }

      // Snapshot when (re)subscribing — replace local payload with the
      // server's authoritative copy.
      if (msg?.status === 'ok' && msg?.action === 'subscribed' && Array.isArray(msg?.snapshots)) {
        const root = msg.snapshots.find((s) => s.path === '/' || s.path === '')
        if (root && root.payload && typeof root.payload === 'object') {
          setDevice((d) => d ? { ...d, payload: root.payload } : d)
          // Anything that came back with children in the snapshot is
          // already populated — no point fetching it again on expand.
          markBranchesLoaded('', root.payload, loadedPathsRef.current)
        }
        return
      }

      // Lazy-loaded branch fetched via `get` (depth=1) — merge its
      // children into local state at the requested path. Deeper data
      // we may already have stays put.
      if (msg?.status === 'ok' && msg?.action === 'get' && msg?.payload !== undefined) {
        const p = msg.path === '/' ? '' : (msg.path || '')
        setDevice((d) => d ? {
          ...d,
          payload: applyShallowMerge(d.payload || {}, p, msg.payload),
        } : d)
        markBranchesLoaded(p, msg.payload, loadedPathsRef.current)
        return
      }
      }
    }  // end connect()

    connect()

    // Bring the socket back up promptly when the tab is woken — closed
    // sockets while backgrounded don't always fire onclose immediately.
    function onVisibility() {
      if (document.hidden) return
      const ws = wsRef.current
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
        attempt = 0
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (currentWs) { try { currentWs.close() } catch {} }
      if (wsRef.current === currentWs) wsRef.current = null
    }
  }, [canView, device?.device_token, device?.id, load])

  /* ---------------- Command dispatcher ----------------
   * Tracks the in-flight action so when the server replies with
   * { status: "error", message: ... } we can show "PATCH /Device1 — <reason>"
   * instead of a context-free toast. */
  const lastCommandRef = useRef(null)

  function sendWsCommand(action, path, payload) {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected. Reload the page.')
    }
    const msg = { action, path: path || '' }
    if (action !== 'delete') msg.payload = payload
    lastCommandRef.current = { action, path }
    ws.send(JSON.stringify(msg))
  }

  /* Lazy-fetch the children of a branch the user is opening. No-op if
     we already pulled this path's level — local state will continue to
     update via the live broadcast stream. */
  function expandPath(path) {
    if (loadedPathsRef.current.has(path)) return
    loadedPathsRef.current.add(path)
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try { ws.send(JSON.stringify({ action: 'get', path, depth: 1 })) } catch {}
  }


  async function deleteDevice() {
    if (!confirming) return
    try {
      await api.deleteDevice(deviceId)
      setToast({ type: 'success', text: 'Device deleted.' })
      // Bounce back to the parent application.
      setTimeout(() => navigate(`/applications/${appId}`, { replace: true }), 400)
    } catch (err) {
      const detail =
        (err instanceof ApiError && (err?.data?.error || err?.data?.detail || err?.data?.message)) ||
        err?.message || 'Failed to delete device.'
      setToast({ type: 'error', text: detail })
      setConfirming(false)
    }
  }

  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page"><PermissionDenied resource="this device" /></div>
      </div>
    )
  }

  return (
    <div className="kiosk-app">
      <TopBar />

      <div className="admin-page app-detail-page">
        <Link to={`/applications/${appId}`} className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Application
        </Link>

        {loading ? (
          <div className="admin-empty admin-loading">
            <span className="admin-spinner" aria-hidden="true" />
            <span>Loading device…</span>
          </div>
        ) : error ? (
          <div className="admin-banner error">{error}</div>
        ) : !device ? null : (
          <>
            {/* ---------- Header ---------- */}
            <header className="device-page-head">
              <div className="device-page-head-id">
                <span className={'connection-dot' + (device.is_connected ? ' is-on' : '')} aria-hidden="true" />
                <div>
                  <h1>{device.device_name}</h1>
                  <div className="device-page-head-sub">
                    <code>{device.device_uid}</code>
                    {device.firmware_version && <span>· fw {device.firmware_version}</span>}
                  </div>
                </div>
              </div>
              <div className="device-page-head-actions">
                <span className={'soft-pill' + (device.is_connected ? ' is-pos' : ' is-neutral')}>
                  {device.is_connected ? 'Online' : 'Offline'}
                </span>
                {!device.is_active && <span className="soft-pill is-warn">Disabled</span>}
                {canUpdate && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button type="button" className="btn-danger btn-sm" onClick={() => setConfirming(true)}>
                    Delete
                  </button>
                )}
              </div>
            </header>

            {/* ---------- Meta ---------- */}
            <section className="admin-card detail-section">
              <div className="card-head">
                <h3 className="card-title">Device info</h3>
              </div>
              <div className="device-detail-body">
                <dl className="device-meta-grid">
                  <div><dt>Device UID</dt><dd><code>{device.device_uid || '—'}</code></dd></div>
                  <div><dt>Protocol</dt><dd>{device.protocol || '—'}</dd></div>
                  <div><dt>Firmware</dt><dd>{device.firmware_version || '—'}</dd></div>
                  <div><dt>Last payload</dt><dd title={formatAbsolute(device.last_payload_update)}>{device.last_payload_update ? formatRelative(device.last_payload_update) : 'never'}</dd></div>
                  <div><dt>Created</dt><dd>{formatAbsolute(device.created_at)}</dd></div>
                  <div><dt>Updated</dt><dd>{formatAbsolute(device.updated_at)}</dd></div>
                </dl>
                {device.description && <p className="device-desc">{device.description}</p>}
              </div>
            </section>

            {/* ---------- Integration ---------- */}
            <section className="admin-card detail-section">
              <div className="card-head">
                <h3 className="card-title">Integration endpoints</h3>
              </div>
              <div className="device-detail-body">
                <CopyRow label="HTTP push URL"     value={device.http_url} />
                <CopyRow label="WebSocket URL"     value={device.websocket_url} />
                <CopyRow label="Device auth token" value={device.device_token} secret />
              </div>
            </section>

            {/* ---------- Payload tree (live, inline-editable) ---------- */}
            <section className="admin-card detail-section">
              <div className="card-head">
                <h3 className="card-title">Payload</h3>
                <div className="card-head-actions">
                  <span className={'ws-status ws-' + wsStatus}>
                    <span className="ws-dot" aria-hidden="true" />
                    {wsStatus === 'live'         ? 'Live' :
                     wsStatus === 'connecting'   ? 'Connecting…' :
                     wsStatus === 'reconnecting' ? 'Reconnecting…' :
                     'Offline'}
                  </span>
                  <span className="card-count">{device.last_payload_update ? formatRelative(device.last_payload_update) : 'never'}</span>
                </div>
              </div>
              <div className="device-detail-body">
                <PayloadTreeRoot
                  data={device.payload || {}}
                  canUpdate={canUpdate}
                  wsLive={wsStatus === 'live'}
                  onError={(text) => setToast({ type: 'error', text })}
                  onRequestDelete={(target) => setConfirmNode(target)}
                  onExpand={expandPath}
                  onCommand={(action, path, value) => {
                    try {
                      sendWsCommand(action, path, value)
                      setToast({ type: 'success', text: `${action.toUpperCase()} ${path ? '/' + path : '/'} sent.` })
                    } catch (err) {
                      setToast({ type: 'error', text: err.message })
                    }
                  }}
                />
              </div>
            </section>

          </>
        )}
      </div>

      {/* ---------- Edit modal ---------- */}
      {editing && device && (
        <DeviceEditModal
          device={device}
          appId={appId}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setDevice(updated)
            setEditing(false)
            setToast({ type: 'success', text: 'Device updated.' })
          }}
        />
      )}

      {/* ---------- Payload node delete confirm ---------- */}
      {confirmNode && (
        <div className="modal-overlay" onMouseDown={() => setConfirmNode(null)}>
          <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{confirmNode.kind === 'branch' ? 'Delete branch?' : 'Delete key?'}</h2>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setConfirmNode(null)}>×</button>
            </header>
            <div className="modal-body">
              <div className="confirm-body">
                <div className="confirm-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="confirm-lead">
                  Delete <strong>{confirmNode.name}</strong>
                  {confirmNode.kind === 'branch' ? ' and everything under it?' : '?'}
                </p>
                <p className="confirm-sub">
                  Path: <code>/{confirmNode.path}</code>
                  {confirmNode.kind === 'branch'
                    ? '. All child keys and any POSTed events under this branch will be removed.'
                    : '.'}
                </p>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn-secondary" onClick={() => setConfirmNode(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    try {
                      sendWsCommand('delete', confirmNode.path)
                      setToast({ type: 'success', text: `DELETE /${confirmNode.path} sent.` })
                    } catch (err) {
                      setToast({ type: 'error', text: err.message })
                    }
                    setConfirmNode(null)
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Delete confirm ---------- */}
      {confirming && device && (
        <div className="modal-overlay" onMouseDown={() => setConfirming(false)}>
          <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Delete device?</h2>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setConfirming(false)}>×</button>
            </header>
            <div className="modal-body">
              <div className="confirm-body">
                <p className="confirm-lead">Delete <strong>{device.device_name}</strong>?</p>
                <p className="confirm-sub">The device and all its payload data will be permanently removed.</p>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className="btn-danger" onClick={deleteDevice}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={'toast toast-' + toast.type}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.type === 'error' ? '⚠' : toast.type === 'success' ? '✓' : '·'}
          </span>
          <span className="toast-text">{toast.text}</span>
          <button
            type="button"
            className="toast-x"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      <footer className="kiosk-foot">© 2026 myaccess Inc. · KIOSK IoT Platform</footer>
    </div>
  )
}

/* ----------------------- copy-row (URL / token) ----------------------- */
function CopyRow({ label, value, secret }) {
  const [shown, setShown] = useState(!secret)
  const [copied, setCopied] = useState(false)
  const display = !value ? '—' : (secret && !shown ? '•'.repeat(Math.min(24, value.length)) : value)

  function copy() {
    if (!value) return
    try {
      navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }

  return (
    <div className="copy-row">
      <div className="copy-row-label">{label}</div>
      <div className="copy-row-value">
        <code title={value || ''}>{display}</code>
        <div className="copy-row-actions">
          {secret && (
            <button
              type="button"
              className="row-btn ghost"
              onClick={() => setShown((s) => !s)}
              disabled={!value}
            >
              {shown ? 'Hide' : 'Show'}
            </button>
          )}
          <button
            type="button"
            className={'row-btn' + (copied ? ' is-success' : '')}
            onClick={copy}
            disabled={!value}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- edit modal ----------------------- */
function DeviceEditModal({ device, appId, onClose, onSaved }) {
  const [form, setForm] = useState({
    device_name: device.device_name || '',
    device_uid: device.device_uid || '',
    description: device.description || '',
    firmware_version: device.firmware_version || '',
    is_active: device.is_active !== false,
  })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((er) => (er[k] ? { ...er, [k]: undefined } : er))
  }

  async function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!form.device_name.trim()) fes.device_name = 'Device name is required.'
    if (!form.device_uid.trim())  fes.device_uid  = 'Device UID is required.'
    setErrors(fes)
    if (Object.keys(fes).length > 0) return
    setSaving(true)
    try {
      const resp = await api.updateDevice(device.id, {
        application: parseInt(appId, 10),
        device_name: form.device_name.trim(),
        device_uid: form.device_uid.trim(),
        description: form.description.trim() || null,
        firmware_version: form.firmware_version.trim() || null,
        is_active: !!form.is_active,
      })
      const updated = resp?.device || resp?.data || resp
      onSaved(updated || device)
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['device_name', 'device_uid', 'description', 'firmware_version', 'is_active'])
        const fes = {}
        for (const k of Object.keys(parsed.fields)) if (parsed.fields[k]?.length) fes[k] = parsed.fields[k][0]
        setErrors(fes)
        const top = parsed.form[0] || err?.data?.error || err?.message
        if (Object.keys(fes).length === 0 && top) setBanner({ type: 'error', text: top })
        else if (parsed.form.length) setBanner({ type: 'error', text: parsed.form[0] })
      } else {
        setBanner({ type: 'error', text: 'Network error.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Edit Device</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="modal-body">
          <form onSubmit={submit} noValidate>
            {banner && <div className={'admin-banner ' + banner.type}>{banner.text}</div>}
            <div className="form-grid-2">
              <Field label="Device name" required error={errors.device_name}>
                <input type="text" value={form.device_name} disabled={saving} autoFocus
                  onChange={(e) => set('device_name', e.target.value)} />
              </Field>
              <Field label="Device UID" required error={errors.device_uid}>
                <input type="text" value={form.device_uid} disabled={saving}
                  onChange={(e) => set('device_uid', e.target.value)}
                  autoCapitalize="off" autoComplete="off" spellCheck={false} />
              </Field>
              <Field label="Firmware version" error={errors.firmware_version}>
                <input type="text" value={form.firmware_version} disabled={saving}
                  onChange={(e) => set('firmware_version', e.target.value)} />
              </Field>
              <Field label="Description" error={errors.description} full>
                <textarea rows={2} value={form.description} disabled={saving}
                  onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
            <label className="form-toggle">
              <input type="checkbox" checked={form.is_active} disabled={saving}
                onChange={(e) => set('is_active', e.target.checked)} />
              <span>Active</span>
            </label>
            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Payload diff applier — keeps local state in sync with the
   WS-broadcast event so we never need an HTTP round-trip after a
   change. Mirrors the consumer's PUT / PATCH / DELETE semantics.
   ============================================================ */
/* Walk a fetched payload tree and add every branch that has children
   to the `loaded` Set. Lets POSTed entries (which the server returns
   inline with their full data) skip the lazy-fetch on expand. */
function markBranchesLoaded(rootPath, data, loaded) {
  if (!data || typeof data !== 'object') return
  if ('type' in data && 'value' in data) return  // leaf
  // A branch with one or more children is "loaded" — adding it to the
  // set means expandPath() will short-circuit when the user opens it.
  if (Object.keys(data).length > 0) loaded.add(rootPath)
  for (const [k, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue
    if ('type' in v && 'value' in v) continue
    const childPath = rootPath ? `${rootPath}/${k}` : k
    markBranchesLoaded(childPath, v, loaded)
  }
}

/* Merge the shallow `fetched` (a depth=1 response) into the local
   payload at `rawPath` without clobbering deeper data we may already
   have. Leaves arrive fresh and overwrite. Branch placeholders {} only
   fill in keys we didn't already know about — existing nested data
   beats a placeholder. */
function applyShallowMerge(payload, rawPath, fetched) {
  const parts = String(rawPath || '').split('/').filter(Boolean)
  const root = { ...(payload && typeof payload === 'object' ? payload : {}) }

  if (!fetched || typeof fetched !== 'object') return root

  // Walk / clone down to the target dict at `rawPath`.
  let cursor = root
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i]
    cursor[k] = cursor[k] && typeof cursor[k] === 'object' && !Array.isArray(cursor[k])
      ? { ...cursor[k] }
      : {}
    cursor = cursor[k]
  }

  function isLeafVal(v) {
    return v && typeof v === 'object' && !Array.isArray(v) && 'type' in v && 'value' in v
  }

  for (const [k, fv] of Object.entries(fetched)) {
    const existing = cursor[k]
    if (isLeafVal(fv)) {
      // Fresh leaf — always take the new value.
      cursor[k] = fv
    } else if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      // Local has nothing here — accept the placeholder/branch.
      cursor[k] = fv
    }
    // else: existing branch with deeper data, keep it intact.
  }
  return root
}

function applyPayloadDiff(payload, action, rawPath, value) {
  const parts = String(rawPath || '').split('/').filter(Boolean)
  // Returning a fresh top-level object keeps React state immutable.
  const root = { ...(payload && typeof payload === 'object' ? payload : {}) }

  if (parts.length === 0) {
    if (action === 'delete') return {}
    if (action === 'put')    return value && typeof value === 'object' ? { ...value } : root
    if (action === 'patch')  return { ...root, ...(value && typeof value === 'object' ? value : {}) }
    return root
  }

  // Walk to the parent, cloning each step so we don't mutate the prior state.
  let cursor = root
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    const child = cursor[k]
    cursor[k] = child && typeof child === 'object' && !Array.isArray(child) ? { ...child } : {}
    cursor = cursor[k]
  }
  const last = parts[parts.length - 1]

  if (action === 'put') {
    cursor[last] = value
  } else if (action === 'patch') {
    const existing = cursor[last]
    const isObj = existing && typeof existing === 'object' && !Array.isArray(existing)
    cursor[last] = isObj
      ? { ...existing, ...(value && typeof value === 'object' ? value : {}) }
      : value
  } else if (action === 'delete') {
    delete cursor[last]
  }
  return root
}

/* ============================================================
   Tree editor
   ============================================================ */
const LEAF_TYPES = ['string', 'int', 'float', 'boolean', 'dict', 'list']

function isLeafNode(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && 'type' in v && 'value' in v
}

function PayloadTreeRoot({ data, canUpdate, wsLive, onCommand, onError, onRequestDelete, onExpand }) {
  const [adding, setAdding] = useState(false)
  const isEmpty = !data || (typeof data === 'object' && Object.keys(data).length === 0)
  const childProps = { canUpdate, wsLive, onCommand, onError, onRequestDelete, onExpand }

  return (
    <div className="tree-root">
      <div className="tree-toolbar">
        <span className="tree-toolbar-hint">Click a value to edit · click <kbd>+</kbd> to add a child</span>
        {canUpdate && (
          <button
            type="button"
            className="tree-add-btn"
            onClick={() => setAdding(true)}
            disabled={!wsLive}
            title={wsLive ? 'Add a child at the root' : 'WebSocket offline — wait for live'}
          >
            + Add root key
          </button>
        )}
      </div>

      {adding && (
        <AddNodeForm
          parentPath=""
          onError={onError}
          onCancel={() => setAdding(false)}
          onSubmit={(key, val) => { onCommand('put', key, val); setAdding(false) }}
        />
      )}

      {isEmpty && !adding && (
        <div className="tree-empty">
          No payload yet. {canUpdate ? 'Click + Add to create the first key.' : 'Waiting for hardware to push data.'}
        </div>
      )}

      {!isEmpty && (
        <PayloadTree data={data} path="" {...childProps} />
      )}
    </div>
  )
}

function PayloadTree({ data, path, canUpdate, wsLive, onCommand, onError, onRequestDelete, onExpand }) {
  if (!data || typeof data !== 'object') return null
  const entries = Object.entries(data)
  const childProps = { canUpdate, wsLive, onCommand, onError, onRequestDelete, onExpand }
  return (
    <ul className="tree-list">
      {entries.map(([key, value]) => {
        const childPath = path ? `${path}/${key}` : key
        return isLeafNode(value)
          ? <LeafNode    key={key} name={key} node={value} path={childPath} {...childProps} />
          : <BranchNode  key={key} name={key} value={value} path={childPath} {...childProps} />
      })}
    </ul>
  )
}

function BranchNode({ name, value, path, canUpdate, wsLive, onCommand, onError, onRequestDelete, onExpand }) {
  const [open, setOpen] = useState(false)   // collapsed by default — lazy load
  const [adding, setAdding] = useState(false)

  function deleteSelf() {
    onRequestDelete?.({ name, path, kind: 'branch' })
  }

  function toggleOpen() {
    if (!open) onExpand?.(path)   // first open triggers a depth=1 fetch
    setOpen((o) => !o)
  }

  return (
    <li className="tree-branch">
      <div className="tree-row">
        <button
          type="button"
          className={'tree-caret' + (open ? ' is-open' : '')}
          onClick={toggleOpen}
          aria-label={open ? 'Collapse' : 'Expand'}
        >▸</button>
        <span className="tree-key tree-key-branch">{name}</span>
        {canUpdate && (
          <span className="tree-row-actions">
            <button type="button" className="tree-icon-btn" onClick={() => setAdding(true)} disabled={!wsLive} aria-label="Add child" title="Add child">
              <IconPlus />
            </button>
            <button type="button" className="tree-icon-btn is-danger" onClick={deleteSelf} disabled={!wsLive} aria-label="Delete branch" title="Delete branch">
              <IconTrash />
            </button>
          </span>
        )}
      </div>

      {adding && (
        <div className="tree-children">
          <AddNodeForm
            parentPath={path}
            onError={onError}
            onCancel={() => setAdding(false)}
            onSubmit={(key, val) => { onCommand('put', `${path}/${key}`, val); setAdding(false) }}
          />
        </div>
      )}

      {open && (
        <div className="tree-children">
          <PayloadTree data={value} path={path} canUpdate={canUpdate} wsLive={wsLive} onCommand={onCommand} onError={onError} onRequestDelete={onRequestDelete} onExpand={onExpand} />
        </div>
      )}
    </li>
  )
}

function LeafNode({ name, node, path, canUpdate, wsLive, onCommand, onError, onRequestDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => stringifyLeafValue(node.value, node.type))
  const [bumpKey, setBumpKey] = useState(0)
  const [fieldError, setFieldError] = useState(null)

  // Re-render with a key change when the leaf's value changes externally
  // (hardware push) — gives us a subtle flash via CSS.
  useEffect(() => { setBumpKey((k) => k + 1) }, [node.value])

  function save() {
    let parsed
    try { parsed = parseLeafValue(draft, node.type) }
    catch (e) {
      const msg = `Invalid ${node.type}: ${e.message}`
      setFieldError(msg)
      onError?.(msg)
      return
    }
    setFieldError(null)
    onCommand('put', path, { type: node.type, value: parsed })
    setEditing(false)
  }

  function cancel() {
    setDraft(stringifyLeafValue(node.value, node.type))
    setEditing(false)
  }

  function deleteSelf() {
    onRequestDelete?.({ name, path, kind: 'leaf' })
  }

  return (
    <li className="tree-leaf">
      <div className="tree-row" key={bumpKey}>
        <span className="tree-caret-spacer" aria-hidden="true" />
        <span className="tree-key">{name}:</span>
        {editing ? (
          <>
            <span className={'tree-edit-cluster' + (fieldError ? ' has-error' : '')}>
              {node.type === 'boolean' ? (
                <select className="tree-input" value={draft} onChange={(e) => { setDraft(e.target.value); setFieldError(null) }}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  className="tree-input"
                  type={node.type === 'int' || node.type === 'float' ? 'number' : 'text'}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setFieldError(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); save() }
                    if (e.key === 'Escape') { e.preventDefault(); cancel() }
                  }}
                  autoFocus
                  spellCheck={false}
                />
              )}
              {fieldError && <span className="tree-inline-err">{fieldError}</span>}
            </span>
            <span className="tree-row-actions">
              <button type="button" className="tree-mini-btn is-primary" onClick={save} disabled={!wsLive}>Save</button>
              <button type="button" className="tree-mini-btn" onClick={() => { setFieldError(null); cancel() }}>Cancel</button>
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className={'tree-value tree-value-' + node.type}
              onClick={canUpdate ? () => setEditing(true) : undefined}
              disabled={!canUpdate || !wsLive}
              title={fullLeafText(node.value, node.type) + (canUpdate ? ' — click to edit' : '')}
            >
              {renderLeafValue(node.value, node.type)}
            </button>
            <span className="tree-type">{node.type}</span>
            {canUpdate && (
              <span className="tree-row-actions">
                <button type="button" className="tree-icon-btn is-danger" onClick={deleteSelf} disabled={!wsLive} aria-label="Delete" title="Delete">
                  <IconTrash />
                </button>
              </span>
            )}
          </>
        )}
      </div>
    </li>
  )
}

function AddNodeForm({ parentPath, onCancel, onSubmit, onError }) {
  // 'branch' is the UI-only kind for an empty container ({}); everything
  // else maps 1:1 to a backend type.
  const [key, setKey]   = useState('')
  const [kind, setKind] = useState('string')
  const [value, setValue] = useState('')
  const [keyError, setKeyError] = useState(null)
  const [valueError, setValueError] = useState(null)
  const isBranch = kind === 'branch'

  // When the type changes, drop the value so a previous string doesn't
  // leak into a number / json field.
  useEffect(() => { setValue(''); setValueError(null) }, [kind])

  function submit(e) {
    e.preventDefault()
    setKeyError(null); setValueError(null)

    const k = key.trim()
    if (!k) { setKeyError('Key is required.'); return }
    if (k.includes('/')) { setKeyError("Key can't contain '/'."); return }

    if (isBranch) {
      onSubmit(k, {})
      return
    }
    let parsed
    try { parsed = parseLeafValue(value, kind) }
    catch (err) {
      const msg = `Invalid ${kind}: ${err.message}`
      setValueError(msg)
      onError?.(msg)
      return
    }
    onSubmit(k, { type: kind, value: parsed })
  }

  return (
    <form className="tree-add-form" onSubmit={submit}>
      <div className="tree-add-head">
        <span className="tree-add-title">New node</span>
        <span className="tree-add-path">
          /<span className="tree-add-path-prefix">{parentPath || ''}</span>
        </span>
      </div>

      <div className="tree-add-grid">
        <label className={'tree-add-field' + (keyError ? ' has-error' : '')}>
          <span className="tree-add-label">Key</span>
          <input
            className="tree-input"
            placeholder="e.g. switchstate"
            value={key}
            onChange={(e) => { setKey(e.target.value); setKeyError(null) }}
            autoFocus
            spellCheck={false}
          />
          {keyError && <span className="tree-inline-err">{keyError}</span>}
        </label>

        <label className="tree-add-field">
          <span className="tree-add-label">Type</span>
          <select
            className="tree-input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="string">String</option>
            <option value="int">Integer</option>
            <option value="float">Float</option>
            <option value="boolean">Boolean</option>
            <option value="dict">Object (dict)</option>
            <option value="list">Array (list)</option>
            <option value="branch">Branch (empty container)</option>
          </select>
        </label>

        {!isBranch && (
          <label className={'tree-add-field tree-add-field-full' + (valueError ? ' has-error' : '')}>
            <span className="tree-add-label">Value</span>
            {kind === 'boolean' ? (
              <select className="tree-input" value={value || 'false'} onChange={(e) => { setValue(e.target.value); setValueError(null) }}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                className="tree-input"
                type={kind === 'int' || kind === 'float' ? 'number' : 'text'}
                placeholder={
                  kind === 'dict' ? '{ "key": value }' :
                  kind === 'list' ? '[ 1, 2, 3 ]' :
                  kind === 'int' || kind === 'float' ? '0' :
                  'value'
                }
                value={value}
                onChange={(e) => { setValue(e.target.value); setValueError(null) }}
                spellCheck={false}
              />
            )}
            {valueError && <span className="tree-inline-err">{valueError}</span>}
          </label>
        )}
      </div>

      <div className="tree-add-foot">
        <button type="button" className="tree-mini-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="tree-mini-btn is-primary">Add</button>
      </div>
    </form>
  )
}

/* Helpers to convert between the typed leaf representation and the
   string form we show / accept in inputs. */
function stringifyLeafValue(value, type) {
  if (value === null || value === undefined) return ''
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'dict' || type === 'list') {
    try { return JSON.stringify(value) } catch { return '' }
  }
  return String(value)
}

function parseLeafValue(str, type) {
  const s = String(str ?? '').trim()
  switch (type) {
    case 'string':  return s
    case 'int': {
      if (s === '') throw new Error('required')
      const n = Number(s)
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('expected integer')
      return n
    }
    case 'float': {
      if (s === '') throw new Error('required')
      const n = Number(s)
      if (!Number.isFinite(n)) throw new Error('expected number')
      return n
    }
    case 'boolean': return s === 'true'
    case 'dict': {
      const v = JSON.parse(s || '{}')
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('expected object')
      return v
    }
    case 'list': {
      const v = JSON.parse(s || '[]')
      if (!Array.isArray(v)) throw new Error('expected array')
      return v
    }
    default: return s
  }
}

function fullLeafText(value, type) {
  if (value === null || value === undefined) return 'null'
  if (type === 'dict' || type === 'list') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function renderLeafValue(value, type) {
  if (value === null || value === undefined) return <em className="muted">null</em>
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'string') return value === '' ? <em className="muted">""</em> : `"${value}"`
  if (type === 'dict' || type === 'list') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

/* Small inline icons used by the tree row actions. */
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Field({ label, error, children, full, required }) {
  return (
    <label className={'form-field' + (full ? ' full' : '') + (error ? ' has-error' : '')}>
      <span className="form-label">
        {label}
        {required && <span className="required-star" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && <span className="form-err">{error}</span>}
    </label>
  )
}
