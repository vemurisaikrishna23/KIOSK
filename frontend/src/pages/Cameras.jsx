import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { Pager } from './Users.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'

const PROTOCOL_OPTIONS = [
  { value: 'rtsp',   label: 'RTSP'   },
  { value: 'webrtc', label: 'WebRTC' },
  { value: 'onvif',  label: 'ONVIF'  },
  { value: 'http',   label: 'HTTP'   },
  { value: 'other',  label: 'Other'  },
]

const STREAM_PATH_RE = /^[a-zA-Z0-9_-]+$/

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
    })
  } catch { return '—' }
}

const EMPTY_FORM = {
  id: null,
  camera_name: '',
  description: '',
  model_number: '',
  protocol: 'rtsp',
  url: '',
  stream_path: '',
  is_active: true,
}

export default function Cameras() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  // Permission gates — UI affordances mirror the backend's HasCustomPermission
  // rules so a user can't see buttons for actions they can't perform.
  const canView   = auth.hasPerm('camera_view')
  const canCreate = auth.hasPerm('camera_create')
  const canUpdate = auth.hasPerm('camera_update')
  const canDelete = auth.hasPerm('camera_delete')

  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Client-side pagination — backend returns the full list so we slice here.
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 8

  // The camera whose live stream is currently open in the player modal.
  // While this is set, that camera's displayed viewer count is decremented
  // by 1 (since the current admin contributes 1 to the MediaMTX viewers
  // tally), bottoming out at 0.
  const [viewingCamera, setViewingCamera] = useState(null)

  // The camera whose full description is currently shown in a popup (when
  // the user clicks "Read more" on a truncated card).
  const [descCamera, setDescCamera] = useState(null)

  // Guards background refreshes from racing with the initial load.
  const reqIdRef = useRef(0)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [formBanner, setFormBanner] = useState(null)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [toast, setToast] = useState(null)

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [query])

  // Snap back to page 1 whenever the filter set changes.
  useEffect(() => { setPage(1) }, [debouncedQuery])

  /* ----------------------- data load ----------------------- */
  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!canView) {
      // Without view permission the backend will 403 anyway — skip the
      // request entirely so the network panel doesn't fill with errors.
      setLoading(false)
      return
    }
    const myReqId = ++reqIdRef.current
    if (!silent) { setLoading(true); setError(null) }
    try {
      const resp = await api.listCameras()
      if (myReqId !== reqIdRef.current) return  // stale
      const list = resp?.cameras ?? (Array.isArray(resp) ? resp : (resp?.results || []))
      setCameras(list)
      if (silent) setError(null)
    } catch (e) {
      if (myReqId !== reqIdRef.current) return
      // Don't blow away the current list on a silent background failure —
      // just leave the previous data in place. The full-screen error only
      // fires on the initial foreground load.
      if (!silent) {
        setError(e?.network ? 'Could not reach the server.' : 'Failed to load cameras.')
      }
    } finally {
      if (!silent && myReqId === reqIdRef.current) setLoading(false)
    }
  }, [canView])

  // Initial foreground load.
  useEffect(() => { reload() }, [reload])

  // Background poll — every 10s pull fresh status + viewer counts from the
  // backend (which itself queries MediaMTX live). Paused while the browser
  // tab is hidden to avoid wasted requests + battery. Skipped entirely if
  // the user can't view cameras.
  useEffect(() => {
    if (!canView) return
    let timer = null
    function tick() { reload({ silent: true }) }
    function start() {
      if (timer) return
      timer = setInterval(tick, 10000)
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null }
    }
    function onVisibility() {
      if (document.hidden) stop()
      else { tick(); start() }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reload, canView])

  /* ----------------------- derived ----------------------- */
  // Backend doesn't support ?q= for cameras, so filter on the client. The
  // list is typically small enough that this is fine.
  const filtered = useMemo(() => {
    if (!debouncedQuery) return cameras
    return cameras.filter((c) => (
      (c.camera_name || '').toLowerCase().includes(debouncedQuery) ||
      (c.description || '').toLowerCase().includes(debouncedQuery) ||
      (c.model_number || '').toLowerCase().includes(debouncedQuery) ||
      (c.stream_path || '').toLowerCase().includes(debouncedQuery) ||
      (c.protocol || '').toLowerCase().includes(debouncedQuery)
    ))
  }, [cameras, debouncedQuery])

  // Pagination math + slice for the current page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // If the filter shrinks results so the current page is out of range, snap back.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  const pagedCameras = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])
  const fromIdx = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(page * PAGE_SIZE, filtered.length)

  const stats = useMemo(() => {
    const total = cameras.length
    const active = cameras.filter((c) => c.is_active).length
    const online = cameras.filter((c) => c.status).length
    return { total, active, online }
  }, [cameras])

  /* ----------------------- modal helpers ----------------------- */
  function openCreate() {
    setModalMode('create')
    setForm(EMPTY_FORM)
    setFormErrors({}); setFormBanner(null)
    setModalOpen(true)
  }
  function openEdit(c) {
    setModalMode('edit')
    setForm({
      id: c.id,
      camera_name: c.camera_name || '',
      description: c.description || '',
      model_number: c.model_number || '',
      protocol: c.protocol || 'rtsp',
      url: c.url || '',
      stream_path: c.stream_path || '',
      is_active: c.is_active !== false,
    })
    setFormErrors({}); setFormBanner(null)
    setModalOpen(true)
  }
  function closeModal() {
    if (saving) return
    setModalOpen(false)
  }
  function setFormField(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
    setFormErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function validate() {
    const errs = {}
    if (!form.camera_name.trim()) errs.camera_name = 'Camera name is required.'
    if (!form.protocol) errs.protocol = 'Protocol is required.'
    if (!form.url.trim()) errs.url = 'Stream URL is required.'
    if (!form.stream_path.trim()) {
      errs.stream_path = 'Stream path is required.'
    } else if (!STREAM_PATH_RE.test(form.stream_path.trim())) {
      errs.stream_path = 'Use letters, digits, "_" or "-" only (no spaces / slashes).'
    }
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setFormBanner(null)
    if (!validate()) return

    const payload = {
      camera_name: form.camera_name.trim(),
      description: form.description.trim() || null,
      model_number: form.model_number.trim() || null,
      protocol: form.protocol,
      url: form.url.trim(),
      stream_path: form.stream_path.trim(),
      is_active: !!form.is_active,
    }

    setSaving(true)
    try {
      if (modalMode === 'create') {
        const resp = await api.createCamera(payload)
        if (resp?.camera) {
          // Prepend the new camera so it shows up immediately.
          setCameras((prev) => [resp.camera, ...prev])
        }
        setToast({ type: 'success', text: resp?.message || `Camera “${payload.camera_name}” added.` })
      } else {
        const resp = await api.updateCamera(form.id, payload)
        const updated = resp?.camera
        if (updated) {
          setCameras((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        }
        setToast({ type: 'success', text: resp?.message || `Camera “${payload.camera_name}” updated.` })
      }
      setModalOpen(false)
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, [
          'camera_name', 'description', 'model_number', 'protocol',
          'url', 'stream_path', 'is_active',
        ])
        const fieldErrs = {}
        for (const k of Object.keys(parsed.fields)) {
          if (parsed.fields[k]?.length) fieldErrs[k] = parsed.fields[k][0]
        }
        setFormErrors(fieldErrs)
        // The Camera viewset returns {message, error} on 500 (YAML/MediaMTX
        // sync failure). Surface it as a banner so the admin sees what
        // happened — typical message: "YAML update failed: <details>".
        const top =
          parsed.form[0] ||
          err?.data?.error ||
          err?.data?.message ||
          err?.message
        if (Object.keys(fieldErrs).length === 0 && top) {
          setFormBanner({ type: 'error', text: top })
        } else if (parsed.form.length) {
          setFormBanner({ type: 'error', text: parsed.form[0] })
        }
      } else {
        setFormBanner({ type: 'error', text: 'Network error. Try again.' })
      }
    } finally {
      setSaving(false)
    }
  }

  /* ----------------------- delete ----------------------- */
  function onDelete(c) { setConfirmDelete(c) }
  async function confirmDeleteCamera() {
    const c = confirmDelete
    if (!c || deleting) return
    setDeleting(true)
    try {
      const resp = await api.deleteCamera(c.id)
      setCameras((prev) => prev.filter((x) => x.id !== c.id))
      setToast({ type: 'success', text: resp?.message || `Camera “${c.camera_name}” deleted.` })
      setConfirmDelete(null)
    } catch (err) {
      const detail =
        (err instanceof ApiError && (err?.data?.error || err?.data?.detail || err?.data?.message)) ||
        err?.message ||
        'Failed to delete camera.'
      setToast({ type: 'error', text: detail })
    } finally {
      setDeleting(false)
    }
  }

  /* ----------------------- render ----------------------- */
  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page"><PermissionDenied resource="cameras" /></div>
      </div>
    )
  }

  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />

      <div className="admin-page">
        <header className="admin-page-head">
          <div>
            <h1>Cameras</h1>
            <p className="lede">Register IP/RTSP/WebRTC streams. Status and viewer counts are pulled live from MediaMTX.</p>
          </div>
          <div className="admin-page-actions">
            <div className="admin-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search by name, stream path, protocol…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search cameras"
              />
              {query && (
                <button
                  type="button"
                  className="admin-search-clear"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >×</button>
              )}
            </div>
            {canCreate && (
              <button type="button" className="btn-primary" onClick={openCreate}>+ Add Camera</button>
            )}
          </div>
        </header>

        <section className="admin-stats">
          <div className="dash-stat"><div className="n">{stats.total}</div><div className="l">Total cameras</div></div>
          <div className="dash-stat"><div className="n">{stats.active}</div><div className="l">Active</div></div>
          <div className="dash-stat"><div className="n">{stats.online}</div><div className="l">Online now</div></div>
        </section>

        {error && <div className="admin-banner error">{error}</div>}

        <section className="admin-card list-card">
          <div className="card-head">
            <h3 className="card-title">Cameras</h3>
            <span className="card-count">{filtered.length}</span>
          </div>
          <div className="list-scroll">
            {!canView ? (
              <PermissionDenied resource="cameras" />
            ) : loading ? (
              <div className="camera-grid">
                {Array.from({ length: 6 }).map((_, i) => <CameraCardSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="admin-empty">
                {debouncedQuery
                  ? <>No cameras match <strong>"{debouncedQuery}"</strong>.{' '}
                      <button type="button" className="link-btn" onClick={() => setQuery('')}>Clear search</button>
                    </>
                  : (canCreate
                      ? 'No cameras registered yet. Click "+ Add Camera" to get started.'
                      : 'No cameras registered yet.')}
              </div>
            ) : (
              <div className="camera-grid">
                {pagedCameras.map((c) => (
                  <CameraCard
                    key={c.id}
                    camera={c}
                    isViewing={viewingCamera?.id === c.id}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    onOpen={() => setViewingCamera(c)}
                    onEdit={() => openEdit(c)}
                    onDelete={() => onDelete(c)}
                    onShowDesc={() => setDescCamera(c)}
                  />
                ))}
              </div>
            )}
          </div>

          {canView && filtered.length > 0 && (
            <Pager
              page={page}
              totalPages={totalPages}
              fromIdx={fromIdx}
              toIdx={toIdx}
              total={filtered.length}
              label={debouncedQuery ? `matches for "${debouncedQuery}"` : 'cameras'}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading}
            />
          )}
        </section>
      </div>

      {/* ---------- Live stream ---------- */}
      {viewingCamera && (
        <LiveStreamModal
          camera={cameras.find((c) => c.id === viewingCamera.id) || viewingCamera}
          onClose={() => setViewingCamera(null)}
        />
      )}

      {/* ---------- Full description popup ---------- */}
      {descCamera && (
        <Modal title={descCamera.camera_name} onClose={() => setDescCamera(null)}>
          <p className="camera-desc-full">
            {descCamera.description || 'No description.'}
          </p>
        </Modal>
      )}

      {/* ---------- Create / Edit modal ---------- */}
      {modalOpen && (
        <Modal title={modalMode === 'create' ? 'Add Camera' : 'Edit Camera'} onClose={closeModal}>
          <form onSubmit={submit} noValidate>
            {formBanner && <div className={'admin-banner ' + formBanner.type}>{formBanner.text}</div>}

            <div className="form-grid-2">
              <Field label="Camera name" required error={formErrors.camera_name}>
                <input
                  type="text"
                  value={form.camera_name}
                  onChange={(e) => setFormField('camera_name', e.target.value)}
                  placeholder="Front Door Cam"
                  autoFocus
                  disabled={saving}
                />
              </Field>
              <Field label="Model number" error={formErrors.model_number}>
                <input
                  type="text"
                  value={form.model_number}
                  onChange={(e) => setFormField('model_number', e.target.value)}
                  placeholder="HK-DS-2CD2"
                  disabled={saving}
                />
              </Field>
              <Field label="Description" error={formErrors.description} full>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setFormField('description', e.target.value)}
                  placeholder="Optional context — location, view angle, etc."
                  disabled={saving}
                />
              </Field>
              <Field label="Protocol" required error={formErrors.protocol}>
                <select
                  value={form.protocol}
                  onChange={(e) => setFormField('protocol', e.target.value)}
                  disabled={saving}
                >
                  {PROTOCOL_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Stream path" required error={formErrors.stream_path}>
                <input
                  type="text"
                  value={form.stream_path}
                  onChange={(e) => setFormField('stream_path', e.target.value)}
                  placeholder="kiosk_front"
                  disabled={saving}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label="Source URL" required error={formErrors.url} full>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setFormField('url', e.target.value)}
                  placeholder="rtsp://user:pass@host:554/Streaming/Channels/101"
                  disabled={saving}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>

            <label className="form-toggle">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setFormField('is_active', e.target.checked)}
                disabled={saving}
              />
              <span>Active <small>— show in dashboards and accept viewers</small></span>
            </label>

            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (modalMode === 'create' ? 'Add Camera' : 'Save Changes')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Delete confirmation ---------- */}
      {confirmDelete && (
        <Modal title="Delete camera?" onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              Delete <strong>{confirmDelete.camera_name}</strong>?
            </p>
            <p className="confirm-sub">
              The camera will be removed from MediaMTX and any dashboards that reference it.
              This action cannot be undone — re-add the camera if you need it back.
            </p>
          </div>
          <div className="modal-foot">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={confirmDeleteCamera}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete camera'}
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className={'toast toast-' + toast.type} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  )
}

/* ----------------------- loading skeleton ----------------------- */
// Shimmer placeholder block (reuses the global `.sk` shimmer).
const Sk = ({ w = '100%', h = 12, r = 6, style }) => (
  <span className="sk" aria-hidden="true"
    style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
)

// Mirrors a CameraCard's sections so the grid keeps its shape while loading.
function CameraCardSkeleton() {
  return (
    <article className="camera-card is-skeleton" aria-hidden="true">
      <header className="camera-card-head">
        <div className="camera-card-id">
          <Sk w={36} h={36} r={10} style={{ flexShrink: 0 }} />
          <div className="camera-card-title" style={{ flex: 1, minWidth: 0 }}>
            <Sk w="62%" h={14} style={{ marginBottom: 8 }} />
            <Sk w="88%" h={11} />
          </div>
        </div>
        <Sk w={72} h={22} r={999} />
      </header>

      <div className="camera-meta">
        <Sk w={64} h={22} r={999} />
        <Sk w={120} h={22} r={999} />
        <Sk w={54} h={22} r={999} />
      </div>

      <dl className="camera-stats">
        <div><Sk w={46} h={9} style={{ marginBottom: 6 }} /><Sk w={30} h={13} /></div>
        <div><Sk w={46} h={9} style={{ marginBottom: 6 }} /><Sk w={64} h={13} /></div>
      </dl>

      <div className="camera-url">
        <Sk w={52} h={11} />
        <Sk w="60%" h={11} />
      </div>

      <div className="camera-actions">
        <Sk w={56} h={30} r={8} />
        <Sk w={56} h={30} r={8} />
      </div>
    </article>
  )
}

/* ----------------------- camera card ----------------------- */
function CameraCard({ camera, isViewing, canUpdate, canDelete, onOpen, onEdit, onDelete, onShowDesc }) {
  const protocolLabel = (PROTOCOL_OPTIONS.find((p) => p.value === camera.protocol)?.label) || camera.protocol?.toUpperCase()

  // Detect whether the description is being visually clamped (more text
  // than fits in the 2-line box). Re-evaluated on resize so a wider card
  // can hide the "Read more" once everything fits.
  const descRef = useRef(null)
  const [descOverflows, setDescOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) { setDescOverflows(false); return }
    const check = () => setDescOverflows(el.scrollHeight - 1 > el.clientHeight)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [camera.description])

  // MediaMTX's viewer count includes the kiosk's own HLS/WebRTC probe,
  // so we always show one less than the raw figure — except when the
  // raw count is already 0, where we leave it at 0 rather than dipping
  // negative. Disabled cameras don't stream at all, so they show "—".
  const rawViewers = camera.viewers ?? 0
  const shownViewers = !camera.is_active
    ? '—'
    : Math.max(0, rawViewers - 1)

  // Clicking anywhere on the card opens the live stream — except for the
  // edit/delete buttons, which stop the click from bubbling up. Disabled
  // cameras are not openable (we wouldn't be streaming them anyway).
  const canOpen = !!camera.is_active
  function handleCardClick() { if (canOpen) onOpen?.() }
  function handleCardKey(e) {
    if (!canOpen) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() }
  }

  return (
    <article
      className={
        'camera-card'
        + (camera.is_active ? '' : ' is-inactive')
        + (isViewing ? ' is-viewing' : '')
      }
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? handleCardClick : undefined}
      onKeyDown={canOpen ? handleCardKey : undefined}
      aria-label={canOpen
        ? `Open live stream for ${camera.camera_name}`
        : `${camera.camera_name} is disabled — enable it to stream`}
      aria-disabled={canOpen ? undefined : true}
    >
      <header className="camera-card-head">
        <div className="camera-card-id">
          <div className="camera-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="7" width="14" height="11" rx="2" stroke="#F36A1E" strokeWidth="1.7" />
              <path d="M17 11 L21 8.5 V16.5 L17 14" stroke="#F36A1E" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="camera-card-title">
            <h4 title={camera.camera_name}>{camera.camera_name}</h4>
            <p
              ref={descRef}
              className={'camera-card-desc' + (descOverflows ? ' is-clickable' : '')}
              title={descOverflows ? camera.description : undefined}
              onClick={descOverflows ? (e) => { e.stopPropagation(); onShowDesc?.() } : undefined}
            >
              {camera.description || <span className="muted">No description</span>}
            </p>
          </div>
        </div>
        <div className={'camera-status' + (camera.status ? ' is-online' : ' is-offline')} title={camera.status ? 'Online — reachable via MediaMTX' : 'Offline — not currently reachable'}>
          <span className="camera-status-dot" aria-hidden="true" />
          {camera.status ? 'Online' : 'Offline'}
        </div>
      </header>

      <div className="camera-meta">
        <span className="camera-chip">{protocolLabel}</span>
        <span className="camera-chip is-mono">{camera.stream_path}</span>
        {camera.model_number && <span className="camera-chip is-soft">{camera.model_number}</span>}
        {!camera.is_active && <span className="camera-chip is-warn">DISABLED</span>}
      </div>

      <dl className="camera-stats">
        <div><dt>Viewers</dt><dd>{shownViewers}</dd></div>
        <div><dt>Added</dt><dd>{formatDate(camera.created_at)}</dd></div>
      </dl>

      <div
        className={'camera-url' + (camera.webrtc_url ? '' : ' is-empty')}
        data-url={camera.webrtc_url || undefined}
      >
        {camera.webrtc_url ? (
          <>
            <span className="camera-url-label">WebRTC</span>
            <code className="camera-url-value">{camera.webrtc_url}</code>
          </>
        ) : null}
      </div>

      <div className="camera-actions" onClick={(e) => e.stopPropagation()}>
        {canUpdate && (
          <button type="button" className="row-btn" onClick={onEdit}>Edit</button>
        )}
        {canDelete && (
          <button type="button" className="row-btn danger" onClick={onDelete}>Delete</button>
        )}
        {!canUpdate && !canDelete && (
          <span className="row-actions-none">View only</span>
        )}
      </div>
    </article>
  )
}

/* ----------------------- live-stream modal ----------------------- */
export function LiveStreamModal({ camera, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const url = camera?.webrtc_url
  const isOnline = !!camera?.status

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-card modal-wide modal-stream"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="stream-head-id">
            <h2>{camera?.camera_name || 'Live stream'}</h2>
            <span className={'camera-status ' + (isOnline ? 'is-online' : 'is-offline')}>
              <span className="camera-status-dot" aria-hidden="true" />
              {isOnline ? 'Live' : 'Offline'}
            </span>
          </div>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="modal-body stream-body">
          {url ? (
            <div className="stream-frame-wrap">
              <iframe
                className="stream-frame"
                src={url}
                title={`Live stream — ${camera?.camera_name}`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="admin-empty">No stream URL is set for this camera.</div>
          )}

          <dl className="stream-meta">
            <div><dt>Stream path</dt><dd className="mono">{camera?.stream_path || '—'}</dd></div>
            <div><dt>Model</dt><dd>{camera?.model_number || '—'}</dd></div>
            <div><dt>Added</dt><dd>{formatDate(camera?.created_at)}</dd></div>
            <div><dt>Viewers</dt><dd>{Math.max(0, (camera?.viewers ?? 0) - 1)}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- shared bits ----------------------- */
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

export function Modal({ title, children, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function PermissionDenied({ resource }) {
  return (
    <div className="admin-empty perm-denied">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#B5500F" strokeWidth="1.6" />
        <path d="M5.5 5.5 18.5 18.5" stroke="#B5500F" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <div className="perm-denied-title">You don't have permission to view {resource}.</div>
      <div className="perm-denied-sub">Ask an administrator to grant you the relevant permission.</div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="#6b6258" strokeWidth="1.7" />
      <path d="m16 16 4 4" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
