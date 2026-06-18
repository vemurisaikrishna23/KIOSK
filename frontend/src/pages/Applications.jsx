import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { Pager } from './Users.jsx'
import { PermissionDenied } from './Cameras.jsx'
import { RichTextEditor, RichTextInline, RichTextBlock } from '../components/RichText.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'

// Deterministic gradient picker — same hash → same palette per app, so the
// wall of cards looks varied instead of all-peach when none have images.
const APP_PALETTES = [
  ['#F36A1E', '#FFB082'], // brand peach
  ['#1FAE6B', '#9CE3B6'], // mint
  ['#4A7BFF', '#A4BEFF'], // sky
  ['#A65EB8', '#E5BBF0'], // grape
  ['#E0463D', '#F0978F'], // coral
  ['#C77A14', '#F0C977'], // amber
  ['#1B998B', '#7FD4C8'], // teal
  ['#D63384', '#F0A3CB'], // rose
]
function djb2(str) {
  let h = 5381
  for (let i = 0; i < (str || '').length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}
function paletteFor(seed) {
  return APP_PALETTES[djb2(String(seed || '?')) % APP_PALETTES.length]
}

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
  name: '',
  description: '',
  publish: false,
  is_active: true,
  imageFile: null,   // newly selected File (null = unchanged on edit)
  imageUrl: null,    // existing URL from server, for preview
  clearImage: false, // user removed the existing image
}

export default function Applications() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  // Permission gates — mirror the backend's HasCustomPermission rules.
  const canView   = auth.hasPerm('application_view')
  const canCreate = auth.hasPerm('application_create')
  const canUpdate = auth.hasPerm('application_update')
  const canDelete = auth.hasPerm('application_delete')

  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Client-side pagination.
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 8

  // Guard against stale list responses.
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

  // Full-description popup target (set by clicking "Read more" on a card).
  const [descApp, setDescApp] = useState(null)

  // Raw file the user just picked, awaiting crop confirmation.
  const [cropTarget, setCropTarget] = useState(null)

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

  // Snap to page 1 when filter changes.
  useEffect(() => { setPage(1) }, [debouncedQuery])

  /* ----------------------- data load ----------------------- */
  const reload = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    const myReqId = ++reqIdRef.current
    setLoading(true); setError(null)
    try {
      const resp = await api.listApplications()
      if (myReqId !== reqIdRef.current) return
      const list = resp?.applications ?? (Array.isArray(resp) ? resp : (resp?.results || []))
      setApps(list)
    } catch (e) {
      if (myReqId !== reqIdRef.current) return
      setError(e?.network ? 'Could not reach the server.' : 'Failed to load applications.')
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false)
    }
  }, [canView])

  useEffect(() => { reload() }, [reload])

  /* ----------------------- derived ----------------------- */
  const filtered = useMemo(() => {
    if (!debouncedQuery) return apps
    return apps.filter((a) => (
      (a.name || '').toLowerCase().includes(debouncedQuery) ||
      (a.description || '').toLowerCase().includes(debouncedQuery)
    ))
  }, [apps, debouncedQuery])

  const stats = useMemo(() => {
    const total = apps.length
    const active = apps.filter((a) => a.is_active).length
    const published = apps.filter((a) => a.publish).length
    return { total, active, published }
  }, [apps])

  // Pagination math + slice.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  const pagedApps = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])
  const fromIdx = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(page * PAGE_SIZE, filtered.length)

  /* ----------------------- modal helpers ----------------------- */
  function openCreate() {
    setModalMode('create')
    setForm(EMPTY_FORM)
    setFormErrors({}); setFormBanner(null)
    setModalOpen(true)
  }
  function openEdit(a) {
    setModalMode('edit')
    setForm({
      id: a.id,
      name: a.name || '',
      description: a.description || '',
      publish: !!a.publish,
      is_active: a.is_active !== false,
      imageFile: null,
      imageUrl: a.application_image || null,
      clearImage: false,
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

  function onPickImage(e) {
    const file = e.target.files?.[0] || null
    // Reset the input so picking the same file twice in a row still fires.
    if (e.target) e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setFormErrors((er) => ({ ...er, application_image: 'Please choose an image file.' }))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormErrors((er) => ({ ...er, application_image: 'Image must be 5 MB or smaller.' }))
      return
    }
    // Defer to the cropper — only once the user confirms a crop do we treat
    // the result as the new imageFile to upload.
    setCropTarget(file)
    setFormErrors((er) => ({ ...er, application_image: undefined }))
  }

  function onCropConfirmed(croppedFile) {
    setForm((f) => ({ ...f, imageFile: croppedFile, clearImage: false }))
    setCropTarget(null)
  }

  function clearImage() {
    setForm((f) => ({ ...f, imageFile: null, clearImage: !!f.imageUrl }))
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Application name is required.'
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setFormBanner(null)
    if (!validate()) return

    // Build the payload. Use FormData only when there's a new image to send
    // (or an existing image to clear) — otherwise a plain JSON PATCH is
    // simpler and avoids touching the file at all.
    const wantsImageChange = !!form.imageFile || form.clearImage
    let body
    if (wantsImageChange) {
      const fd = new FormData()
      fd.append('name', form.name.trim())
      fd.append('description', form.description.trim())
      fd.append('publish', form.publish ? 'true' : 'false')
      fd.append('is_active', form.is_active ? 'true' : 'false')
      if (form.imageFile) fd.append('application_image', form.imageFile)
      else if (form.clearImage) fd.append('application_image', '')
      body = fd
    } else {
      body = {
        name: form.name.trim(),
        description: form.description.trim(),
        publish: !!form.publish,
        is_active: !!form.is_active,
      }
    }

    setSaving(true)
    try {
      if (modalMode === 'create') {
        const resp = await api.createApplication(body)
        if (resp?.application) {
          setApps((prev) => [resp.application, ...prev])
        }
        setToast({ type: 'success', text: resp?.message || `Application "${form.name}" added.` })
      } else {
        const resp = await api.updateApplication(form.id, body)
        const updated = resp?.application
        if (updated) {
          setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
        }
        setToast({ type: 'success', text: resp?.message || `Application "${form.name}" updated.` })
      }
      setModalOpen(false)
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, [
          'name', 'description', 'publish', 'is_active', 'application_image',
        ])
        const fieldErrs = {}
        for (const k of Object.keys(parsed.fields)) {
          if (parsed.fields[k]?.length) fieldErrs[k] = parsed.fields[k][0]
        }
        setFormErrors(fieldErrs)
        const top = parsed.form[0] || err?.data?.error || err?.data?.message || err?.message
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
  function onDelete(a) { setConfirmDelete(a) }
  async function confirmDeleteApp() {
    const a = confirmDelete
    if (!a || deleting) return
    setDeleting(true)
    try {
      const resp = await api.deleteApplication(a.id)
      setApps((prev) => prev.filter((x) => x.id !== a.id))
      setToast({ type: 'success', text: resp?.message || `Application "${a.name}" deleted.` })
      setConfirmDelete(null)
    } catch (err) {
      const detail =
        (err instanceof ApiError && (err?.data?.error || err?.data?.detail || err?.data?.message)) ||
        err?.message ||
        'Failed to delete application.'
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
        <div className="admin-page"><PermissionDenied resource="applications" /></div>
      </div>
    )
  }

  return (
    <div className="kiosk-app">
      <TopBar />

      <div className="admin-page">
        <header className="admin-page-head">
          <div>
            <h1>Applications</h1>
            <p className="lede">Register apps deployed across kiosks. Toggle publish to expose them publicly.</p>
          </div>
          <div className="admin-page-actions">
            <div className="admin-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search by name or description…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search applications"
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
              <button type="button" className="btn-primary" onClick={openCreate}>+ Add Application</button>
            )}
          </div>
        </header>

        <section className="admin-stats">
          <div className="dash-stat"><div className="n">{stats.total}</div><div className="l">Total apps</div></div>
          <div className="dash-stat"><div className="n">{stats.active}</div><div className="l">Active</div></div>
          <div className="dash-stat"><div className="n">{stats.published}</div><div className="l">Published</div></div>
        </section>

        {error && <div className="admin-banner error">{error}</div>}

        <section className="admin-card list-card">
          <div className="card-head">
            <h3 className="card-title">Applications</h3>
            <span className="card-count">{filtered.length}</span>
          </div>
          <div className="list-scroll">
            {!canView ? (
              <PermissionDenied resource="applications" />
            ) : loading ? (
              <div className="camera-grid app-grid">
                {Array.from({ length: 6 }).map((_, i) => <AppCardSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="admin-empty">
                {debouncedQuery
                  ? <>No applications match <strong>"{debouncedQuery}"</strong>.{' '}
                      <button type="button" className="link-btn" onClick={() => setQuery('')}>Clear search</button>
                    </>
                  : (canCreate
                      ? 'No applications registered yet. Click "+ Add Application" to get started.'
                      : 'No applications registered yet.')}
              </div>
            ) : (
              <div className="camera-grid app-grid">
                {pagedApps.map((a) => (
                  <ApplicationCard
                    key={a.id}
                    app={a}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    onEdit={() => openEdit(a)}
                    onDelete={() => onDelete(a)}
                    onShowDesc={() => setDescApp(a)}
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
              label={debouncedQuery ? `matches for "${debouncedQuery}"` : 'applications'}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading}
            />
          )}
        </section>
      </div>

      {/* ---------- Full description popup ---------- */}
      {descApp && (
        <DescriptionModal app={descApp} onClose={() => setDescApp(null)} />
      )}

      {/* ---------- Image crop modal (sits on top of the edit modal) ---------- */}
      {cropTarget && (
        <ImageCropper
          file={cropTarget}
          onCancel={() => setCropTarget(null)}
          onCropped={onCropConfirmed}
        />
      )}

      {/* ---------- Create / Edit modal ---------- */}
      {modalOpen && (
        <Modal title={modalMode === 'create' ? 'Add Application' : 'Edit Application'} onClose={closeModal}>
          <form className="modal-form" onSubmit={submit} noValidate>
            {formBanner && <div className={'admin-banner ' + formBanner.type}>{formBanner.text}</div>}

            <div className="form-grid-2">
              <Field label="Application name" required error={formErrors.name} full>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setFormField('name', e.target.value)}
                  placeholder="Front Desk Display"
                  autoFocus
                  disabled={saving}
                />
              </Field>
              <Field label="Description" error={formErrors.description} full>
                <RichTextEditor
                  value={form.description}
                  onChange={(html) => setFormField('description', html)}
                  placeholder="Optional — what does this application do?"
                  disabled={saving}
                />
              </Field>
              <Field label="Icon / image" error={formErrors.application_image} full>
                <AppImagePicker
                  imageFile={form.imageFile}
                  imageUrl={form.imageUrl}
                  cleared={form.clearImage}
                  onPick={onPickImage}
                  onClear={clearImage}
                  disabled={saving}
                />
              </Field>
            </div>

            <label className="form-toggle">
              <input
                type="checkbox"
                checked={form.publish}
                onChange={(e) => setFormField('publish', e.target.checked)}
                disabled={saving}
              />
              <span>Publish <small>— make this application visible to the public</small></span>
            </label>
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setFormField('is_active', e.target.checked)}
                disabled={saving}
              />
              <span>Active <small>— show in dashboards</small></span>
            </label>

            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (modalMode === 'create' ? 'Add Application' : 'Save Changes')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Delete confirmation ---------- */}
      {confirmDelete && (
        <Modal title="Delete application?" onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              Delete <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="confirm-sub">
              The application and any linked devices / dashboards will lose their parent.
              This action cannot be undone.
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
              onClick={confirmDeleteApp}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete application'}
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

// Mirrors an ApplicationCard (hero · body · meta · actions) while loading.
function AppCardSkeleton() {
  return (
    <article className="app-card-v2 is-skeleton" aria-hidden="true">
      <div className="app-hero"><span className="sk" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} /></div>
      <div className="app-body">
        <Sk w="58%" h={16} style={{ marginBottom: 4 }} />
        <Sk w="92%" h={11} />
        <Sk w="76%" h={11} />
      </div>
      <div className="app-meta-row">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Sk w={22} h={22} r={999} />
          <Sk w={84} h={11} />
        </span>
        <Sk w={52} h={11} />
      </div>
      <div className="app-actions">
        <Sk w={56} h={30} r={8} />
        <Sk w={56} h={30} r={8} />
      </div>
    </article>
  )
}

/* ----------------------- card ----------------------- */
function ApplicationCard({ app, canUpdate, canDelete, onEdit, onDelete, onShowDesc }) {
  const navigate = useNavigate()
  const imageUrl = app.application_image || null
  const [c1, c2] = paletteFor(app.id ?? app.name)
  // Apply gradient as inline style so every card gets its deterministic
  // palette without us needing to ship N CSS classes.
  const heroStyle = imageUrl ? undefined : {
    background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
  }
  const initial = (app.name || '?').trim().charAt(0).toUpperCase() || '?'

  // Show "Read more" whenever the description spans more than one rendered
  // line (even if it isn't clipped by the 3-line clamp). ResizeObserver
  // re-checks on resize so a 2-line desktop blurb that fits on one line at
  // wider widths doesn't keep a stray link.
  const descRef = useRef(null)
  const [descOverflows, setDescOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) { setDescOverflows(false); return }
    const check = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 18
      // Multi-line if the rendered content is taller than ~1.5 line-heights.
      setDescOverflows(el.scrollHeight > lh * 1.5)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [app.description])

  function goToDetail() { navigate(`/applications/${app.id}`) }
  function handleKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToDetail() }
  }

  return (
    <article
      className={'app-card-v2' + (app.is_active ? '' : ' is-inactive')}
      role="button"
      tabIndex={0}
      onClick={goToDetail}
      onKeyDown={handleKey}
      aria-label={`Open ${app.name}`}
    >
      {/* Hero — large image OR a per-app gradient with the app's initial
          rendered big, so a wall of imageless apps still looks varied.
          When an image is present we ALSO paint a blurred copy behind a
          contained foreground image, so unusual aspect ratios fit fully
          without cropping while the hero still feels filled. */}
      <div className="app-hero" style={heroStyle}>
        {imageUrl ? (
          <>
            <img className="app-hero-bg" src={imageUrl} alt="" aria-hidden="true" />
            <img className="app-hero-img" src={imageUrl} alt="" />
          </>
        ) : (
          <span className="app-hero-initial" aria-hidden="true">{initial}</span>
        )}
        <span className={'app-publish-pill' + (app.publish ? ' is-pub' : ' is-draft')}>
          <span className="app-publish-dot" aria-hidden="true" />
          {app.publish ? 'Published' : 'Draft'}
        </span>
        {!app.is_active && <span className="app-disabled-pill">DISABLED</span>}
      </div>

      {/* Body — name + clamped description, with "Read more" if it overflows. */}
      <div className="app-body">
        <h4 className="app-name">{app.name}</h4>
        <div ref={descRef} className="app-desc">
          {app.description
            ? <RichTextInline value={app.description} />
            : <span className="muted">No description</span>}
        </div>
        {/* Only render when the description was actually clipped by the
            3-line clamp — short descriptions don't get a dead link. */}
        {descOverflows && (
          <button
            type="button"
            className="app-readmore"
            onClick={(e) => { e.stopPropagation(); onShowDesc?.() }}
          >
            Read more
            <svg className="app-readmore-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Footer meta — creator + added date. */}
      <div className="app-meta-row">
        <span className="app-meta-item">
          <AvatarDot text={app.created_by_name || '?'} />
          <span className="app-meta-label">{app.created_by_name || 'Unknown'}</span>
        </span>
        <span className="app-meta-item app-meta-date">{formatDate(app.created_at)}</span>
      </div>

      <div className="app-actions" onClick={(e) => e.stopPropagation()}>
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

function AvatarDot({ text }) {
  const initial = (text || '?').trim().charAt(0).toUpperCase() || '?'
  return <span className="app-avatar-dot" aria-hidden="true">{initial}</span>
}

/* ----------------------- description popup ----------------------- */
function DescriptionModal({ app, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card app-desc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head app-desc-head">
          <h2>Description</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="app-desc-body">
          {app?.description ? (
            <RichTextBlock className="app-desc-full md-body" value={app.description} />
          ) : (
            <p className="app-desc-full app-desc-empty">No description.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ----------------------- image picker ----------------------- */
function AppImagePicker({ imageFile, imageUrl, cleared, onPick, onClear, disabled }) {
  const previewUrl = imageFile
    ? URL.createObjectURL(imageFile)
    : (cleared ? null : imageUrl)
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  // Revoke object URLs when the picked file changes — otherwise we leak.
  useEffect(() => {
    if (!imageFile) return
    const url = previewUrl
    return () => { try { URL.revokeObjectURL(url) } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFile])

  function openDialog() { if (!disabled) inputRef.current?.click() }
  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const file = e.dataTransfer?.files?.[0]
    // Reuse the parent's event-based handler (validates + opens the cropper).
    if (file) onPick({ target: { files: [file], value: '' } })
  }

  return (
    <div
      className={'app-image-picker app-image-dropzone' + (dragOver ? ' is-drag' : '') + (disabled ? ' is-disabled' : '')}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragEnter={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
      onDrop={onDrop}
    >
      <div className="app-image-preview" aria-hidden="true">
        {previewUrl ? <img src={previewUrl} alt="" /> : <DefaultAppIcon large />}
      </div>
      <div className="app-image-controls">
        <input ref={inputRef} type="file" accept="image/*" onChange={onPick} disabled={disabled} hidden />
        <button type="button" className="app-image-cta" onClick={openDialog} disabled={disabled}>
          <span className="app-image-cta-ic" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 16V8m0 0-3 3m3-3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 16.5A4.5 4.5 0 0 0 17.5 8h-1.05A7 7 0 1 0 5 14.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="app-image-cta-text">
            <strong>{previewUrl ? 'Replace image' : 'Upload a file'}</strong> or drag and drop
          </span>
        </button>
        <p className="form-hint">PNG / JPG / SVG · Max 5 MB</p>
        {previewUrl && (
          <button type="button" className="btn-link danger" onClick={onClear} disabled={disabled}>
            Remove image
          </button>
        )}
      </div>
    </div>
  )
}

/* ----------------------- image cropper ----------------------- */
/* Lets the user reposition (and zoom) their freshly-picked image inside a
   fixed 16:9 frame, then renders that cropped region to a canvas and
   returns a new JPEG File. All apps end up with the same hero aspect, so
   the wall of cards looks consistent regardless of source dimensions. */
function ImageCropper({ file, onCancel, onCropped }) {
  // Output ratio + display size of the crop stage. Output canvas is
  // rendered larger than the stage for crisp uploads.
  const ASPECT_W = 16
  const ASPECT_H = 9
  const STAGE_W = 480
  const STAGE_H = (STAGE_W * ASPECT_H) / ASPECT_W
  const OUT_W = 1280
  const OUT_H = (OUT_W * ASPECT_H) / ASPECT_W

  const imgRef = useRef(null)
  // Object URL is created once for the file and intentionally NOT revoked
  // in a cleanup — Strict Mode's double-invoke would otherwise revoke it
  // while the <img> is still loading and break the preview.
  const imgUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  // null until the rendered <img> has fired its onLoad and we know the
  // natural dimensions.
  const [naturalSize, setNaturalSize] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [scale, setScale] = useState(1)
  const [baseScale, setBaseScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const dragRef = useRef(null)

  function onImgLoad(e) {
    const el = e.currentTarget
    const nw = el.naturalWidth
    const nh = el.naturalHeight
    if (!nw || !nh) { setLoadError('Could not read image dimensions.'); return }
    const cover = Math.max(STAGE_W / nw, STAGE_H / nh)
    const dw = nw * cover
    const dh = nh * cover
    setBaseScale(cover)
    setScale(1)
    setTranslate({ x: (STAGE_W - dw) / 2, y: (STAGE_H - dh) / 2 })
    setNaturalSize({ w: nw, h: nh })
    setLoadError(null)
  }

  function clamp(t, effectiveScale) {
    if (!naturalSize) return t
    const dw = naturalSize.w * effectiveScale
    const dh = naturalSize.h * effectiveScale
    return {
      x: Math.min(0, Math.max(STAGE_W - dw, t.x)),
      y: Math.min(0, Math.max(STAGE_H - dh, t.y)),
    }
  }

  // Re-clamp whenever the scale changes (zoom out can leave the image
  // floating short of an edge).
  useEffect(() => {
    if (!naturalSize) return
    setTranslate((t) => clamp(t, baseScale * scale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, baseScale, naturalSize])

  function onPointerDown(e) {
    if (!naturalSize) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTx: translate.x,
      startTy: translate.y,
    }
  }
  function onPointerMove(e) {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const next = {
      x: d.startTx + (e.clientX - d.startX),
      y: d.startTy + (e.clientY - d.startY),
    }
    setTranslate(clamp(next, baseScale * scale))
  }
  function onPointerUp(e) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
  }

  async function confirm() {
    if (!naturalSize || !imgRef.current || busy) return
    setBusy(true)
    try {
      const eff = baseScale * scale
      const srcX = -translate.x / eff
      const srcY = -translate.y / eff
      const srcW = STAGE_W / eff
      const srcH = STAGE_H / eff

      const canvas = document.createElement('canvas')
      canvas.width = OUT_W
      canvas.height = OUT_H
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(imgRef.current, srcX, srcY, srcW, srcH, 0, 0, OUT_W, OUT_H)

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) { setBusy(false); return }
      const base = (file.name || 'image').replace(/\.[^.]+$/, '')
      const cropped = new File([blob], `${base}_cropped.jpg`, { type: 'image/jpeg' })
      onCropped(cropped)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay crop-overlay" onMouseDown={() => !busy && onCancel()}>
      <div className="modal-card crop-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Position your image</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !busy && onCancel()}>×</button>
        </header>
        <div className="modal-body">
          <p className="crop-hint">
            Drag the image to choose what shows in the card hero. The selection is locked to 16:9.
          </p>
          <div
            className="crop-stage"
            style={{ width: STAGE_W, height: STAGE_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {imgUrl && (
              <img
                ref={imgRef}
                className="crop-img"
                src={imgUrl}
                alt=""
                draggable={false}
                onLoad={onImgLoad}
                onError={() => setLoadError('Could not load the image.')}
                style={naturalSize ? {
                  width: naturalSize.w * baseScale * scale,
                  height: naturalSize.h * baseScale * scale,
                  transform: `translate(${translate.x}px, ${translate.y}px)`,
                } : { opacity: 0 }}
              />
            )}
            {!naturalSize && !loadError && (
              <div className="crop-loading">
                <span className="admin-spinner" aria-hidden="true" />
                <span>Loading image…</span>
              </div>
            )}
            {loadError && <div className="crop-loading crop-error">{loadError}</div>}
            <div className="crop-frame" aria-hidden="true" />
          </div>
          <div className="crop-zoom">
            <span className="crop-zoom-label">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="crop-zoom-slider"
              aria-label="Zoom"
              disabled={!naturalSize}
            />
            <button
              type="button"
              className="btn-link"
              disabled={!naturalSize}
              onClick={() => {
                if (!naturalSize) return
                setScale(1)
                const dw = naturalSize.w * baseScale
                const dh = naturalSize.h * baseScale
                setTranslate({ x: (STAGE_W - dw) / 2, y: (STAGE_H - dh) / 2 })
              }}
            >
              Reset
            </button>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={confirm} disabled={!naturalSize || busy} aria-busy={busy}>
              {busy ? 'Cropping…' : 'Use this crop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DefaultAppIcon({ large }) {
  const size = large ? 36 : 22
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#F36A1E" strokeWidth="1.7" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#F36A1E" strokeWidth="1.7" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#F36A1E" strokeWidth="1.7" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#F36A1E" strokeWidth="1.7" />
    </svg>
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

function Modal({ title, children, onClose }) {
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

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="#6b6258" strokeWidth="1.7" />
      <path d="m16 16 4 4" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
