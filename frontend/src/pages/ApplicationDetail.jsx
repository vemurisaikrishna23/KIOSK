import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied, LiveStreamModal } from './Cameras.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'

const PALETTES = [
  ['#F36A1E', '#FFB082'],
  ['#1FAE6B', '#9CE3B6'],
  ['#4A7BFF', '#A4BEFF'],
  ['#A65EB8', '#E5BBF0'],
  ['#E0463D', '#F0978F'],
  ['#C77A14', '#F0C977'],
  ['#1B998B', '#7FD4C8'],
  ['#D63384', '#F0A3CB'],
]
function djb2(str) {
  let h = 5381
  for (let i = 0; i < (str || '').length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
    })
  } catch { return '—' }
}

const EMPTY_DEVICE = {
  id: null,
  device_name: '',
  device_uid: '',
  description: '',
  firmware_version: '',
  is_active: true,
}

const EMPTY_CAM_LINK = {
  id: null,
  camera: '',          // camera id
  description: '',
  is_primary: false,
}

const EMPTY_DASHBOARD = {
  id: null,
  name: '',
  description: '',
  publish: false,
  queue_enabled: false,
  queue_control_seconds: 60,
}

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  // Permission gates — re-use the existing application_* perms for the
  // outer page; device / camera-link CRUD lives under the same umbrella
  // since they're sub-resources of an application.
  const canView   = auth.hasPerm('application_view')
  const canUpdate = auth.hasPerm('application_update')
  const canDelete = auth.hasPerm('application_delete')

  const [app, setApp] = useState(null)
  const [appLoading, setAppLoading] = useState(true)
  const [appError, setAppError] = useState(null)

  const [devices, setDevices] = useState([])
  const [devicesLoading, setDevicesLoading] = useState(true)

  const [appCameras, setAppCameras] = useState([])
  const [camerasLoading, setCamerasLoading] = useState(true)

  const [dashboards, setDashboards] = useState([])
  const [dashboardsLoading, setDashboardsLoading] = useState(true)

  // Full camera catalog (used by the "Assign Camera" picker).
  const [allCameras, setAllCameras] = useState([])

  // Modals
  const [deviceModal, setDeviceModal] = useState(null)   // { mode: 'create'|'edit', form }
  const [camLinkModal, setCamLinkModal] = useState(null) // { mode: 'create'|'edit', form }
  const [dashboardModal, setDashboardModal] = useState(null) // { mode: 'create'|'edit', form }
  const [confirmDelete, setConfirmDelete] = useState(null) // { kind: 'device'|'cameraLink'|'dashboard', item }
  const [liveCamera, setLiveCamera]   = useState(null)  // a Camera object to stream
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  /* ---------------------- loaders ---------------------- */
  const loadApp = useCallback(async () => {
    if (!canView) { setAppLoading(false); return }
    setAppLoading(true); setAppError(null)
    try {
      const data = await api.getApplication(id)
      setApp(data)
    } catch (e) {
      setAppError(e?.network ? 'Could not reach the server.' : (e?.status === 404 ? 'Application not found.' : 'Failed to load application.'))
    } finally {
      setAppLoading(false)
    }
  }, [id, canView])

  const loadDevices = useCallback(async () => {
    if (!canView) { setDevicesLoading(false); return }
    setDevicesLoading(true)
    try {
      const resp = await api.listDevices({ application: id })
      const list = resp?.devices ?? (Array.isArray(resp) ? resp : [])
      setDevices(list)
    } catch {
      setDevices([])
    } finally {
      setDevicesLoading(false)
    }
  }, [id, canView])

  const loadAppCameras = useCallback(async ({ silent = false } = {}) => {
    if (!canView) { setCamerasLoading(false); return }
    if (!silent) setCamerasLoading(true)
    try {
      const resp = await api.listAppCameras({ application: id })
      const list = resp?.links ?? (Array.isArray(resp) ? resp : [])
      setAppCameras(list)
    } catch {
      if (!silent) setAppCameras([])
    } finally {
      if (!silent) setCamerasLoading(false)
    }
  }, [id, canView])

  const loadDashboards = useCallback(async () => {
    if (!canView) { setDashboardsLoading(false); return }
    setDashboardsLoading(true)
    try {
      const resp = await api.listDashboards({ application: id })
      const list = resp?.dashboards ?? (Array.isArray(resp) ? resp : [])
      setDashboards(list)
    } catch {
      setDashboards([])
    } finally {
      setDashboardsLoading(false)
    }
  }, [id, canView])

  const loadAllCameras = useCallback(async () => {
    try {
      const resp = await api.listCameras()
      const list = resp?.cameras ?? (Array.isArray(resp) ? resp : (resp?.results || []))
      setAllCameras(list)
    } catch {
      setAllCameras([])
    }
  }, [])

  useEffect(() => { loadApp() }, [loadApp])
  useEffect(() => { loadDevices() }, [loadDevices])
  useEffect(() => { loadAppCameras() }, [loadAppCameras])
  useEffect(() => { loadAllCameras() }, [loadAllCameras])
  useEffect(() => { loadDashboards() }, [loadDashboards])

  // Background poll — only the camera CATALOG, not the link list. The link
  // structure (which cameras are tied to which app) is changed via the
  // explicit Assign / Unlink buttons on this page, so re-fetching it on a
  // timer would just cause the rows to visibly flicker without changing
  // anything. The catalog endpoint queries MediaMTX, so polling it keeps
  // each linked row's Online / viewers / etc. fresh via camerasById.
  // Paused while the tab is hidden.
  useEffect(() => {
    if (!canView) return
    let timer = null
    function tick() { loadAllCameras() }
    function start() { if (!timer) timer = setInterval(tick, 10000) }
    function stop()  { if (timer) { clearInterval(timer); timer = null } }
    function onVisibility() { if (document.hidden) stop(); else { tick(); start() } }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [canView, loadAllCameras])

  // Build a fast lookup so a linked row can show the latest catalog data
  // (status, viewers) even if the link payload itself is stale.
  const camerasById = useMemo(() => {
    const m = new Map()
    for (const c of allCameras) m.set(c.id, c)
    return m
  }, [allCameras])

  /* ---------------------- derived ---------------------- */
  const [c1, c2] = useMemo(() => {
    const seed = String(app?.id ?? app?.name ?? id)
    return PALETTES[djb2(seed) % PALETTES.length]
  }, [app, id])
  const heroStyle = app?.application_image ? undefined : {
    background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
  }
  const initial = (app?.name || '?').trim().charAt(0).toUpperCase() || '?'

  // Camera IDs already linked to this app — used to exclude them from the
  // "Assign Camera" picker so the same camera can't be linked twice.
  const linkedCameraIds = useMemo(
    () => new Set(appCameras.map((l) => l.camera?.id ?? l.camera).filter(Boolean)),
    [appCameras],
  )
  const cameraPickerOptions = useMemo(
    () => allCameras.filter((c) => !linkedCameraIds.has(c.id)),
    [allCameras, linkedCameraIds],
  )

  /* ---------------------- device CRUD ---------------------- */
  function openDeviceCreate() {
    setDeviceModal({ mode: 'create', form: { ...EMPTY_DEVICE } })
  }
  function openDeviceEdit(d) {
    setDeviceModal({
      mode: 'edit',
      form: {
        id: d.id,
        device_name: d.device_name || '',
        device_uid: d.device_uid || '',
        description: d.description || '',
        firmware_version: d.firmware_version || '',
        is_active: d.is_active !== false,
      },
    })
  }
  async function saveDevice(form, setSaving, setErrors, setBanner, close) {
    const payload = {
      application: parseInt(id, 10),
      device_name: form.device_name.trim(),
      device_uid: form.device_uid.trim(),
      description: form.description.trim() || null,
      firmware_version: form.firmware_version.trim() || null,
      is_active: !!form.is_active,
    }
    setSaving(true)
    try {
      let resp, updated, created
      if (form.id) {
        resp = await api.updateDevice(form.id, payload)
        updated = resp?.device || resp?.data
        if (updated) setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
      } else {
        resp = await api.createDevice(payload)
        created = resp?.data ?? resp
        if (created?.id) setDevices((prev) => [created, ...prev])
        else await loadDevices()
      }
      setToast({ type: 'success', text: resp?.message || (form.id ? 'Device updated.' : 'Device added.') })
      close()
      // After a successful create, jump to that device's detail page so
      // the admin can immediately copy the http_url / ws_url / token they
      // need to integrate the hardware.
      if (created?.id) navigate(`/applications/${id}/devices/${created.id}`)
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

  /* ---------------------- camera-link CRUD ---------------------- */
  function openCamLinkCreate() {
    setCamLinkModal({ mode: 'create', form: { ...EMPTY_CAM_LINK } })
  }
  function openCamLinkEdit(link) {
    setCamLinkModal({
      mode: 'edit',
      form: {
        id: link.id,
        camera: link.camera?.id ?? link.camera ?? '',
        description: link.description || '',
        is_primary: !!link.is_primary,
      },
    })
  }
  async function saveCamLink(form, setSaving, setErrors, setBanner, close) {
    const payload = {
      application: parseInt(id, 10),
      camera: parseInt(form.camera, 10),
      description: form.description.trim() || null,
      is_primary: !!form.is_primary,
    }
    if (!payload.camera) { setErrors({ camera: 'Pick a camera.' }); return }
    setSaving(true)
    try {
      let resp, updated
      if (form.id) {
        resp = await api.updateAppCamera(form.id, payload)
        updated = resp?.data
        if (updated) setAppCameras((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
      } else {
        resp = await api.createAppCamera(payload)
        const created = resp?.data ?? resp
        if (created?.id) setAppCameras((prev) => [created, ...prev])
        else await loadAppCameras()
      }
      setToast({ type: 'success', text: resp?.message || (form.id ? 'Camera link updated.' : 'Camera assigned.') })
      close()
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['camera', 'description', 'is_primary'])
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

  /* ---------------------- dashboard CRUD ---------------------- */
  function openDashboardCreate() {
    setDashboardModal({ mode: 'create', form: { ...EMPTY_DASHBOARD } })
  }
  function openDashboardEdit(d) {
    setDashboardModal({
      mode: 'edit',
      form: {
        id: d.id,
        name: d.name || '',
        description: d.description || '',
        publish: !!d.publish,
        queue_enabled: !!d.queue_enabled,
        queue_control_seconds: d.queue_control_seconds ?? 60,
      },
    })
  }
  async function saveDashboard(form, setSaving, setErrors, setBanner, close) {
    const payload = {
      application: parseInt(id, 10),
      name: form.name.trim(),
      description: form.description.trim() || null,
      publish: !!form.publish,
      queue_enabled: !!form.queue_enabled,
      queue_control_seconds: Math.max(5, parseInt(form.queue_control_seconds, 10) || 60),
    }
    setSaving(true)
    try {
      let resp, updated, created
      if (form.id) {
        resp = await api.updateDashboard(form.id, payload)
        updated = resp?.dashboard
        if (updated) setDashboards((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
      } else {
        resp = await api.createDashboard(payload)
        created = resp?.dashboard ?? resp?.data ?? resp
        if (created?.id) setDashboards((prev) => [created, ...prev])
        else await loadDashboards()
      }
      setToast({ type: 'success', text: resp?.message || (form.id ? 'Dashboard updated.' : 'Dashboard created.') })
      close()
      // Jump straight into the new dashboard so the admin can start adding
      // widgets immediately.
      if (created?.id) navigate(`/applications/${id}/dashboards/${created.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['name', 'description', 'publish'])
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

  /* ---------------------- delete ---------------------- */
  async function performDelete() {
    const target = confirmDelete
    if (!target) return
    try {
      if (target.kind === 'device') {
        await api.deleteDevice(target.item.id)
        setDevices((prev) => prev.filter((d) => d.id !== target.item.id))
        setToast({ type: 'success', text: `Device "${target.item.device_name}" deleted.` })
      } else if (target.kind === 'cameraLink') {
        await api.deleteAppCamera(target.item.id)
        setAppCameras((prev) => prev.filter((l) => l.id !== target.item.id))
        const camName = target.item.camera_details?.camera_name || 'Camera'
        setToast({ type: 'success', text: `${camName} unlinked.` })
      } else if (target.kind === 'dashboard') {
        await api.deleteDashboard(target.item.id)
        setDashboards((prev) => prev.filter((d) => d.id !== target.item.id))
        setToast({ type: 'success', text: `Dashboard "${target.item.name}" deleted.` })
      }
      setConfirmDelete(null)
    } catch (err) {
      setToast({
        type: 'error',
        text: (err instanceof ApiError && (err?.data?.error || err?.data?.detail)) || 'Delete failed.',
      })
    }
  }

  /* ---------------------- render ---------------------- */
  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page"><PermissionDenied resource="this application" /></div>
      </div>
    )
  }

  return (
    <div className="kiosk-app">
      <TopBar />

      <div className="admin-page app-detail-page">
        <Link to="/applications" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Applications
        </Link>

        {appLoading ? (
          <>
            <header className="app-detail-title"><Sk w={220} h={26} r={8} /></header>
            <section className="admin-stats">
              {Array.from({ length: 4 }).map((_, i) => (
                <div className="dash-stat" key={i}>
                  <Sk w={48} h={24} style={{ marginBottom: 8 }} />
                  <Sk w={72} h={11} />
                </div>
              ))}
            </section>
            {[0, 1].map((s) => (
              <section className="admin-card list-card detail-section" key={s}>
                <div className="card-head"><Sk w={130} h={16} /></div>
                <DetailListSkeleton rows={3} />
              </section>
            ))}
          </>
        ) : appError ? (
          <div className="admin-banner error">{appError}</div>
        ) : !app ? null : (
          <>
            {/* ---------- Minimal page title — just "which app am I in?" ---------- */}
            <header className="app-detail-title">
              <h1>{app.name}</h1>
            </header>

            {/* ---------- Stats ---------- */}
            <section className="admin-stats">
              <div className="dash-stat"><div className="n">{devices.length}</div><div className="l">Devices</div></div>
              <div className="dash-stat"><div className="n">{appCameras.length}</div><div className="l">Cameras</div></div>
              <div className="dash-stat"><div className="n">{devices.filter((d) => d.is_connected).length}</div><div className="l">Online devices</div></div>
              <div className="dash-stat"><div className="n">{dashboards.length}</div><div className="l">Dashboards</div></div>
            </section>

            {/* ---------- Devices ---------- */}
            <section className="admin-card list-card detail-section">
              <div className="card-head">
                <h3 className="card-title">Devices</h3>
                <div className="card-head-actions">
                  <span className="card-count">{devices.length}</span>
                  {canUpdate && (
                    <button type="button" className="btn-primary btn-sm" onClick={openDeviceCreate}>
                      + Add Device
                    </button>
                  )}
                </div>
              </div>
              {devicesLoading ? (
                <DetailListSkeleton rows={3} />
              ) : devices.length === 0 ? (
                <div className="admin-empty">
                  {canUpdate ? 'No devices yet. Click "+ Add Device" to register one.' : 'No devices yet.'}
                </div>
              ) : (
                <ul className="detail-list">
                  {devices.map((d) => (
                    <DeviceRow
                      key={d.id}
                      device={d}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      onOpen={() => navigate(`/applications/${id}/devices/${d.id}`)}
                      onEdit={() => openDeviceEdit(d)}
                      onDelete={() => setConfirmDelete({ kind: 'device', item: d })}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* ---------- Dashboards ---------- */}
            <section className="admin-card list-card detail-section">
              <div className="card-head">
                <h3 className="card-title">Dashboards</h3>
                <div className="card-head-actions">
                  <span className="card-count">{dashboards.length}</span>
                  {canUpdate && (
                    <button type="button" className="btn-primary btn-sm" onClick={openDashboardCreate}>
                      + Add Dashboard
                    </button>
                  )}
                </div>
              </div>
              {dashboardsLoading ? (
                <DetailListSkeleton rows={2} />
              ) : dashboards.length === 0 ? (
                <div className="admin-empty">
                  {canUpdate ? 'No dashboards yet. Click "+ Add Dashboard" to build one.' : 'No dashboards yet.'}
                </div>
              ) : (
                <ul className="detail-list">
                  {dashboards.map((d) => (
                    <DashboardRow
                      key={d.id}
                      dashboard={d}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      onOpen={() => navigate(`/applications/${id}/dashboards/${d.id}`)}
                      onEdit={() => openDashboardEdit(d)}
                      onDelete={() => setConfirmDelete({ kind: 'dashboard', item: d })}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* ---------- Cameras ---------- */}
            <section className="admin-card list-card detail-section">
              <div className="card-head">
                <h3 className="card-title">Linked Cameras</h3>
                <div className="card-head-actions">
                  <span className="card-count">{appCameras.length}</span>
                  {canUpdate && (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={openCamLinkCreate}
                      disabled={cameraPickerOptions.length === 0}
                      title={cameraPickerOptions.length === 0 ? 'All cameras are already linked' : ''}
                    >
                      + Assign Camera
                    </button>
                  )}
                </div>
              </div>
              {camerasLoading ? (
                <DetailListSkeleton rows={2} />
              ) : appCameras.length === 0 ? (
                <div className="admin-empty">
                  {canUpdate ? 'No cameras linked yet. Use "+ Assign Camera" to add one.' : 'No cameras linked yet.'}
                </div>
              ) : (
                <ul className="detail-list">
                  {appCameras.map((link) => (
                    <CameraLinkRow
                      key={link.id}
                      link={link}
                      liveCamera={camerasById.get(link.camera_details?.id ?? link.camera)}
                      isViewing={liveCamera?.id === (link.camera_details?.id ?? link.camera)}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      onView={(cam) => setLiveCamera(cam)}
                      onEdit={() => openCamLinkEdit(link)}
                      onDelete={() => setConfirmDelete({ kind: 'cameraLink', item: link })}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* ---------- 3D Scene (Spline) ---------- */}
            <SplineSection
              app={app}
              canUpdate={canUpdate}
              onSaved={(vals) => setApp((a) => ({ ...a, ...vals }))}
              setToast={setToast}
            />
          </>
        )}
      </div>

      {/* ---------- Modals ---------- */}
      {deviceModal && (
        <DeviceModal
          initial={deviceModal.form}
          onClose={() => setDeviceModal(null)}
          onSubmit={(form, setSaving, setErrors, setBanner) =>
            saveDevice(form, setSaving, setErrors, setBanner, () => setDeviceModal(null))
          }
        />
      )}
      {liveCamera && (
        <LiveStreamModal
          camera={camerasById.get(liveCamera.id) || liveCamera}
          onClose={() => setLiveCamera(null)}
        />
      )}
      {dashboardModal && (
        <DashboardModal
          initial={dashboardModal.form}
          onClose={() => setDashboardModal(null)}
          onSubmit={(form, setSaving, setErrors, setBanner) =>
            saveDashboard(form, setSaving, setErrors, setBanner, () => setDashboardModal(null))
          }
        />
      )}
      {camLinkModal && (
        <CameraLinkModal
          initial={camLinkModal.form}
          mode={camLinkModal.mode}
          cameraOptions={camLinkModal.mode === 'edit'
            ? allCameras  // include the current link's camera so it shows in the select
            : cameraPickerOptions}
          onClose={() => setCamLinkModal(null)}
          onSubmit={(form, setSaving, setErrors, setBanner) =>
            saveCamLink(form, setSaving, setErrors, setBanner, () => setCamLinkModal(null))
          }
        />
      )}
      {confirmDelete && (
        <DeleteConfirm
          kind={confirmDelete.kind}
          item={confirmDelete.item}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={performDelete}
        />
      )}

      {toast && (
        <div className={'toast toast-' + toast.type} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  )
}

/* ----------------------- loading skeletons ----------------------- */
// Shimmer placeholder block (reuses the global `.sk` shimmer).
const Sk = ({ w = '100%', h = 12, r = 6, style }) => (
  <span className="sk" aria-hidden="true"
    style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
)

// One generic .detail-row placeholder — used for the Devices, Dashboards
// and Linked-Cameras lists (they all share the .detail-list row layout).
function DetailRowSkeleton() {
  return (
    <li className="detail-row" aria-hidden="true">
      <div className="detail-row-id">
        <Sk w={10} h={10} r={999} style={{ marginTop: 5, flexShrink: 0 }} />
        <div className="detail-row-text" style={{ flex: 1, minWidth: 0 }}>
          <Sk w={170} h={14} />
          <Sk w="52%" h={11} style={{ marginTop: 10 }} />
        </div>
      </div>
      <div className="detail-row-actions">
        <Sk w={56} h={30} r={8} />
        <Sk w={64} h={30} r={8} />
      </div>
    </li>
  )
}
const DetailListSkeleton = ({ rows = 3 }) => (
  <ul className="detail-list">
    {Array.from({ length: rows }).map((_, i) => <DetailRowSkeleton key={i} />)}
  </ul>
)

/* ----------------------- device row ----------------------- */
function DeviceRow({ device, canUpdate, canDelete, onOpen, onEdit, onDelete }) {
  // The entire row is the affordance for navigating to the device's
  // dedicated detail page. Edit / Delete buttons stop propagation so they
  // keep their own actions.
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() }
  }
  return (
    <li
      className={'detail-row is-clickable' + (device.is_active ? '' : ' is-inactive')}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      aria-label={`Open ${device.device_name}`}
    >
      <div className="detail-row-id">
        <div className={'connection-dot' + (device.is_connected ? ' is-on' : '')} aria-hidden="true" />
        <div className="detail-row-text">
          <div className="detail-row-name">{device.device_name}</div>
          <div className="detail-row-sub">
            <code>{device.device_uid}</code>
            {device.firmware_version && <span>· fw {device.firmware_version}</span>}
            {device.last_payload_update && (
              <span>· last update {formatRelative(device.last_payload_update)}</span>
            )}
          </div>
          {device.description && <div className="detail-row-desc">{device.description}</div>}
        </div>
      </div>
      <div className="detail-row-pills">
        {device.is_connected && <span className="soft-pill is-pos">Online</span>}
        {!device.is_active && <span className="soft-pill is-warn">Disabled</span>}
      </div>
      <div className="detail-row-actions" onClick={(e) => e.stopPropagation()}>
        {canUpdate && <button type="button" className="row-btn" onClick={onEdit}>Edit</button>}
        {canDelete && <button type="button" className="row-btn danger" onClick={onDelete}>Delete</button>}
        {!canUpdate && !canDelete && <span className="row-actions-none">View only</span>}
      </div>
    </li>
  )
}

/* Human-friendly elapsed-time formatter for "last update" timestamps. */
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

/* ----------------------- camera link row ----------------------- */
/* Mirrors the main Cameras page: shows live online/offline status, a
   viewers count (with the kiosk's own pull subtracted), and a "View Live"
   button that opens the same WebRTC modal as /cameras. Falls back to
   whatever the link payload includes when the catalog hasn't arrived yet. */
function CameraLinkRow({ link, liveCamera, isViewing, canUpdate, canDelete, onView, onEdit, onDelete }) {
  // Prefer the freshly-polled catalog object (status / viewers from MediaMTX);
  // fall back to camera_details from the link payload.
  const cam = liveCamera || link.camera_details || (typeof link.camera === 'object' ? link.camera : {}) || {}
  const canOpen = !!cam.is_active && !!cam.id
  const rawViewers = cam.viewers ?? 0
  const shownViewers = !cam.is_active ? '—' : Math.max(0, rawViewers - 1)

  function open() { if (canOpen) onView?.(cam) }

  return (
    <li className={'detail-row' + (cam.is_active === false ? ' is-inactive' : '') + (isViewing ? ' is-viewing' : '')}>
      <div className="detail-row-id">
        <div className="cam-thumb" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="7" width="14" height="11" rx="2" stroke="#F36A1E" strokeWidth="1.7" />
            <path d="M17 11 L21 8.5 V16.5 L17 14" stroke="#F36A1E" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="detail-row-text">
          <div className="detail-row-name">{cam.camera_name || `Camera #${link.camera}`}</div>
          <div className="detail-row-sub">
            {cam.protocol && <span className="muted-strong">{cam.protocol.toUpperCase()}</span>}
            {cam.stream_path && <code>{cam.stream_path}</code>}
            <span>· viewers {shownViewers}</span>
          </div>
          {link.description && <div className="detail-row-desc">{link.description}</div>}
        </div>
      </div>
      <div className="detail-row-pills">
        <span className={'soft-pill' + (cam.status ? ' is-pos' : ' is-neutral')}>
          {cam.status ? 'Online' : 'Offline'}
        </span>
        {link.is_primary && <span className="soft-pill is-pos">Primary</span>}
        {cam.is_active === false && <span className="soft-pill is-warn">Disabled</span>}
      </div>
      <div className="detail-row-actions">
        <button
          type="button"
          className="row-btn"
          onClick={open}
          disabled={!canOpen}
          title={!canOpen ? 'Camera is disabled' : 'Open live stream'}
        >
          View Live
        </button>
        {canUpdate && <button type="button" className="row-btn" onClick={onEdit}>Edit</button>}
        {canDelete && <button type="button" className="row-btn danger" onClick={onDelete}>Unlink</button>}
      </div>
    </li>
  )
}

/* ----------------------- device modal ----------------------- */
function DeviceModal({ initial, onClose, onSubmit }) {
  const [form, setForm] = useState(initial)
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
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!form.device_name.trim()) fes.device_name = 'Device name is required.'
    if (!form.device_uid.trim()) fes.device_uid = 'Device UID is required.'
    setErrors(fes)
    if (Object.keys(fes).length > 0) return
    onSubmit(form, setSaving, setErrors, setBanner)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{form.id ? 'Edit Device' : 'Add Device'}</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="modal-body">
          <form onSubmit={submit} noValidate>
            {banner && <div className={'admin-banner ' + banner.type}>{banner.text}</div>}
            <div className="form-grid-2">
              <DField label="Device name" required error={errors.device_name}>
                <input type="text" value={form.device_name} disabled={saving} autoFocus
                  onChange={(e) => set('device_name', e.target.value)} placeholder="Lobby controller" />
              </DField>
              <DField label="Device UID" required error={errors.device_uid}>
                <input type="text" value={form.device_uid} disabled={saving}
                  onChange={(e) => set('device_uid', e.target.value)}
                  placeholder="MAC / Serial / UUID"
                  autoCapitalize="off" autoComplete="off" spellCheck={false} />
              </DField>
              <DField label="Firmware version" error={errors.firmware_version}>
                <input type="text" value={form.firmware_version} disabled={saving}
                  onChange={(e) => set('firmware_version', e.target.value)} placeholder="v1.0.3" />
              </DField>
              <DField label="Description" error={errors.description} full>
                <textarea rows={2} value={form.description} disabled={saving}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Optional notes about this device." />
              </DField>
            </div>
            <label className="form-toggle">
              <input type="checkbox" checked={form.is_active} disabled={saving}
                onChange={(e) => set('is_active', e.target.checked)} />
              <span>Active</span>
            </label>
            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Add Device')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- camera link modal ----------------------- */
function CameraLinkModal({ initial, mode, cameraOptions, onClose, onSubmit }) {
  const [form, setForm] = useState(initial)
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
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    if (!form.camera) { setErrors({ camera: 'Pick a camera.' }); return }
    onSubmit(form, setSaving, setErrors, setBanner)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{mode === 'edit' ? 'Edit Camera Link' : 'Assign Camera'}</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="modal-body">
          <form onSubmit={submit} noValidate>
            {banner && <div className={'admin-banner ' + banner.type}>{banner.text}</div>}
            <DField label="Camera" required error={errors.camera} full>
              <select
                value={form.camera || ''}
                disabled={saving || mode === 'edit'}
                onChange={(e) => set('camera', e.target.value)}
              >
                <option value="">Select a camera…</option>
                {cameraOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.camera_name} {c.stream_path ? `(${c.stream_path})` : ''}
                  </option>
                ))}
              </select>
            </DField>
            <DField label="Note" error={errors.description} full>
              <textarea rows={2} value={form.description} disabled={saving}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Why is this camera linked? (optional)" />
            </DField>
            <label className="form-toggle">
              <input type="checkbox" checked={form.is_primary} disabled={saving}
                onChange={(e) => set('is_primary', e.target.checked)} />
              <span>Primary camera <small>— main display for this application</small></span>
            </label>
            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (mode === 'edit' ? 'Save Changes' : 'Assign Camera')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- dashboard row ----------------------- */
function DashboardRow({ dashboard, canUpdate, canDelete, onOpen, onEdit, onDelete }) {
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() }
  }
  return (
    <li
      className="detail-row is-clickable"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      aria-label={`Open ${dashboard.name}`}
    >
      <div className="detail-row-id">
        <div className="dash-thumb" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="8" height="10" rx="1.6" stroke="#F36A1E" strokeWidth="1.7" />
            <rect x="13" y="3" width="8" height="6" rx="1.6" stroke="#F36A1E" strokeWidth="1.7" />
            <rect x="3" y="15" width="8" height="6" rx="1.6" stroke="#F36A1E" strokeWidth="1.7" />
            <rect x="13" y="11" width="8" height="10" rx="1.6" stroke="#F36A1E" strokeWidth="1.7" />
          </svg>
        </div>
        <div className="detail-row-text">
          <div className="detail-row-name">{dashboard.name}</div>
          <div className="detail-row-sub">
            {dashboard.created_by_name && <span>by {dashboard.created_by_name}</span>}
            {dashboard.updated_at && <span>· updated {formatRelative(dashboard.updated_at)}</span>}
          </div>
          {dashboard.description && <div className="detail-row-desc">{dashboard.description}</div>}
        </div>
      </div>
      <div className="detail-row-actions" onClick={(e) => e.stopPropagation()}>
        {canUpdate && <button type="button" className="row-btn" onClick={onEdit}>Edit</button>}
        {canDelete && <button type="button" className="row-btn danger" onClick={onDelete}>Delete</button>}
        {!canUpdate && !canDelete && <span className="row-actions-none">View only</span>}
      </div>
    </li>
  )
}

/* ----------------------- 3D scene (Spline) section -----------------------
   Application-level config (sits alongside Devices / Cameras / Dashboards).
   The scene is shown on every dashboard's camera area, after the cameras. */
function SplineSection({ app, canUpdate, onSaved, setToast }) {
  const [url, setUrl] = useState(app?.spline_url || '')
  const [enabled, setEnabled] = useState(!!app?.spline_url_enable)
  const [saving, setSaving] = useState(false)

  // Re-sync if the app is (re)loaded externally.
  useEffect(() => {
    setUrl(app?.spline_url || '')
    setEnabled(!!app?.spline_url_enable)
  }, [app?.spline_url, app?.spline_url_enable])

  const dirty = url !== (app?.spline_url || '') || enabled !== !!app?.spline_url_enable

  async function save() {
    if (!app?.id) return
    setSaving(true)
    const vals = { spline_url: url.trim() || null, spline_url_enable: !!enabled }
    try {
      await api.updateApplication(app.id, vals)
      onSaved?.(vals)
      setToast?.({ type: 'success', text: '3D scene settings saved.' })
    } catch {
      setToast?.({ type: 'error', text: 'Could not save 3D scene settings.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-card list-card detail-section">
      <div className="card-head">
        <h3 className="card-title">3D Scene</h3>
        <div className="card-head-actions">
          <span className={'spline-status' + (enabled && url.trim() ? ' is-on' : '')}>
            {enabled && url.trim() ? 'Shown on dashboards' : 'Hidden'}
          </span>
        </div>
      </div>
      <div className="spline-section">
        <p className="spline-section-lead">
          Embed a Spline 3D scene. When enabled it appears in each dashboard's camera area, after all linked cameras.
        </p>
        <label className="form-field full">
          <span className="form-label">Spline scene URL</span>
          <input
            type="url"
            value={url}
            disabled={!canUpdate || saving}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://my.spline.design/…  (embed / viewer URL)"
          />
        </label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canUpdate || saving}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Show the 3D scene on dashboards <small>— appears after all cameras</small></span>
        </label>
        {canUpdate && (
          <div className="spline-section-foot">
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving || !dirty} aria-busy={saving}>
              {saving ? 'Saving…' : 'Save 3D scene'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/* ----------------------- dashboard modal ----------------------- */
function DashboardModal({ initial, onClose, onSubmit }) {
  const [form, setForm] = useState(initial)
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
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!form.name.trim()) fes.name = 'Dashboard name is required.'
    setErrors(fes)
    if (Object.keys(fes).length > 0) return
    onSubmit(form, setSaving, setErrors, setBanner)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{form.id ? 'Edit Dashboard' : 'Add Dashboard'}</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="modal-body">
          <form onSubmit={submit} noValidate>
            {banner && <div className={'admin-banner ' + banner.type}>{banner.text}</div>}
            <DField label="Dashboard name" required error={errors.name} full>
              <input type="text" value={form.name} disabled={saving} autoFocus
                onChange={(e) => set('name', e.target.value)} placeholder="Lobby overview" />
            </DField>
            <DField label="Description" error={errors.description} full>
              <textarea rows={2} value={form.description} disabled={saving}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What does this dashboard show or control?" />
            </DField>

            {/* Access queue — turn-based control for the published dashboard
                (desktop + mobile). Each person gets control for N seconds. */}
            <label className="form-toggle">
              <input type="checkbox" checked={form.queue_enabled} disabled={saving}
                onChange={(e) => set('queue_enabled', e.target.checked)} />
              <span>Enable access queue <small>— viewers take turns controlling; everyone else is read-only</small></span>
            </label>
            {form.queue_enabled && (
              <DField label="Control time per person (seconds)" error={errors.queue_control_seconds}>
                <input type="number" min={5} step={5} value={form.queue_control_seconds} disabled={saving}
                  onChange={(e) => set('queue_control_seconds', e.target.value)} placeholder="60" />
              </DField>
            )}

            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Add Dashboard')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- delete confirm ----------------------- */
function DeleteConfirm({ kind, item, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const verb = kind === 'cameraLink' ? 'Unlink' : 'Delete'
  const noun =
    kind === 'cameraLink' ? 'camera' :
    kind === 'dashboard'  ? 'dashboard' : 'device'
  const label =
    kind === 'cameraLink' ? (item.camera_details?.camera_name || 'this camera link') :
    kind === 'dashboard'  ? (item?.name || 'this dashboard') :
    (item?.device_name || 'this device')
  const subCopy =
    kind === 'cameraLink' ? 'The camera remains in the system — only its link to this application is removed.' :
    kind === 'dashboard'  ? 'The dashboard and all of its widget configurations will be permanently removed. Device payloads are not affected.' :
    'The device and all its payload data will be permanently removed.'
  async function go() {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <div className="modal-overlay" onMouseDown={() => !busy && onCancel()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{verb} {noun}?</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !busy && onCancel()}>×</button>
        </header>
        <div className="modal-body">
          <div className="confirm-body">
            <p className="confirm-lead">
              {verb} <strong>{label}</strong>?
            </p>
            <p className="confirm-sub">{subCopy}</p>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn-danger" onClick={go} disabled={busy} aria-busy={busy}>
              {busy ? 'Working…' : verb}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- shared bits ----------------------- */
function DField({ label, error, children, full, required }) {
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
