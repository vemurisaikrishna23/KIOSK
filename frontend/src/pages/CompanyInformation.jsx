import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied, Modal } from './Cameras.jsx'
import { api, auth } from '../lib/api.js'

const EMPTY = { company_name: '', email: '', phone: '', address: '', map_embed_code: '' }

/**
 * Pull exact lat/lng out of any Google-Maps link or embed snippet so the
 * map can drop a precise pin. Handles the common encodings:
 *   • place / share URLs:  …/@17.7409,83.3354,17z  and  !3d17.7409!4d83.3354
 *   • query params:        ?q=17.74,83.33  ?ll=…  ?center=…  ?destination=…
 * Returns "lat,lng" or null.
 */
export function coordsFromCode(code) {
  if (!code) return null
  const s = String(code)
  // Validate + format a candidate pair (latitude ±90, longitude ±180).
  const ok = (lat, lng) => {
    const la = parseFloat(lat); const ln = parseFloat(lng)
    if (Number.isNaN(la) || Number.isNaN(ln)) return null
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null
    return `${la},${ln}`
  }
  // Try each known Google encoding in order; the capture order is mapped so
  // the result is always "lat,lng".
  const tries = [
    // place / share URL data:  !3d<lat>!4d<lng>
    () => { const m = s.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/); return m && ok(m[1], m[2]) },
    // LatLng sub-message inside an embed / directions pb:  !3m2!1d<lat>!2d<lng>
    () => { const m = s.match(/!3m2!1d(-?\d{1,2}(?:\.\d+)?)!2d(-?\d{1,3}(?:\.\d+)?)/); return m && ok(m[1], m[2]) },
    // map URL centre:  @<lat>,<lng>
    () => { const m = s.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/); return m && ok(m[1], m[2]) },
    // query params:  ?q= / ?ll= / ?center= / ?destination= / ?sll= <lat>,<lng>
    () => { const m = s.match(/[?&](?:ll|q|center|destination|sll)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/); return m && ok(m[1], m[2]) },
    // camera centre (longitude first):  !2d<lng>!3d<lat>
    () => { const m = s.match(/!2d(-?\d{1,3}(?:\.\d+)?)!3d(-?\d{1,2}(?:\.\d+)?)/); return m && ok(m[2], m[1]) },
  ]
  for (const t of tries) { const r = t(); if (r) return r }
  return null
}

/**
 * Resolve a usable map URL out of whatever the admin pasted:
 *   1. If exact coordinates are present anywhere in the snippet/link → a
 *      single precise pin at that lat/lng (clean, no result sidebar).
 *   2. A full `<iframe … src="…">` embed snippet → its src.
 *   3. A bare URL → used verbatim.
 * Returns null if nothing usable is found.
 */
export function mapSrcFromEmbed(code) {
  if (!code) return null
  const coords = coordsFromCode(code)
  if (coords) return `https://maps.google.com/maps?q=${coords}&z=19&output=embed`
  const str = String(code).trim()
  const m = str.match(/src\s*=\s*["']([^"']+)["']/i)
  if (m) return m[1]
  if (/^https?:\/\//i.test(str)) return str
  return null
}

/**
 * Company Information — admin management of the contact details shown on
 * the public landing page (email / phone / office) plus a Google-Maps
 * embed so the office location renders. Multiple records may be stored,
 * but only ONE is active at a time (it's the one the public page reads).
 *
 * Permissions:
 *   – company_info_view    → view this page
 *   – company_info_create  → add a record
 *   – company_info_update  → edit / activate a record
 *   – company_info_delete  → delete a record
 */
export default function CompanyInformation() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView   = auth.hasPerm('company_info_view')
  const canCreate = auth.hasPerm('company_info_create')
  const canUpdate = auth.hasPerm('company_info_update')
  const canDelete = auth.hasPerm('company_info_delete')

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [list, setList]       = useState([])
  const [toast, setToast]     = useState(null)

  // Editor modal — create or edit a single record.
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId]       = useState(null)   // null → create
  const [form, setForm]           = useState(EMPTY)
  const [makeActive, setMakeActive] = useState(true)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)  // record pending delete confirmation
  const [deleting, setDeleting]   = useState(false)
  const [activating, setActivating] = useState(false)       // show overlay spinner while activating a record
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const resp = await api.listCompanyInformation()
      setList(Array.isArray(resp?.records) ? resp.records : [])
    } catch (e) {
      setError(e?.network ? 'Could not reach the server.' : (e?.message || 'Failed to load company information.'))
    } finally {
      setLoading(false)
    }
  }, [canView])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // Merge a saved record into the list in place — no full re-fetch. Enforces
  // the one-active-record rule locally: if the saved record is active, every
  // other record is flipped inactive (mirroring the server's singleton save()).
  function mergeRecord(rec) {
    if (!rec || rec.id == null) { load(); return }   // unexpected shape → fall back
    setList((prev) => {
      const exists = prev.some((r) => r.id === rec.id)
      const next = exists ? prev.map((r) => (r.id === rec.id ? rec : r)) : [...prev, rec]
      return rec.is_active ? next.map((r) => (r.id === rec.id ? r : { ...r, is_active: false })) : next
    })
  }

  function openCreate() {
    setEditId(null); setForm(EMPTY); setMakeActive(true); setFormError(null); setModalOpen(true)
  }
  function openEdit(rec) {
    setEditId(rec.id)
    setForm({
      company_name: rec.company_name || '',
      email: rec.email || '',
      phone: rec.phone || '',
      address: rec.address || '',
      map_embed_code: rec.map_embed_code || '',
    })
    setMakeActive(!!rec.is_active)
    setFormError(null)
    setModalOpen(true)
  }

  async function onSave(e) {
    e.preventDefault()
    setFormError(null)
    if (!form.company_name.trim() && !form.email.trim()) {
      setFormError('Enter at least a company name or email.')
      return
    }
    setSaving(true)
    try {
      const body = { ...form, is_active: mustBeActive ? true : makeActive }
      const saved = editId == null
        ? await api.createCompanyInformation(body)
        : await api.updateCompanyInformation(editId, body)
      mergeRecord(saved)
      setModalOpen(false)
      setToast({ kind: 'ok', msg: editId == null ? 'Company information added.' : 'Company information updated.' })
    } catch (e2) {
      const msg = e2?.data && typeof e2.data === 'object'
        ? Object.entries(e2.data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')
        : (e2?.message || 'Save failed.')
      setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function onSetActive(rec) {
    if (rec.is_active) return
    setActivating(true)   // translucent overlay over the list so the click is felt, data stays visible
    try {
      const saved = await api.setActiveCompanyInformation(rec.id)
      mergeRecord(saved && saved.id != null ? saved : { ...rec, is_active: true })
      setToast({ kind: 'ok', msg: `“${rec.company_name || rec.email}” is now the active company info.` })
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Failed to set active.' })
    } finally {
      setActivating(false)
    }
  }

  function onDelete(rec) {
    if (rec.is_active) {
      setToast({ kind: 'err', msg: 'Cannot delete the active record. Activate another one first.' })
      return
    }
    setConfirmDelete(rec)
  }
  async function confirmDeleteRecord() {
    const rec = confirmDelete
    if (!rec || deleting) return
    setDeleting(true)
    try {
      await api.deleteCompanyInformation(rec.id)
      setList((prev) => prev.filter((r) => r.id !== rec.id))   // only the active record is auto-promoted server-side, and it can't be deleted here
      setConfirmDelete(null)
      setToast({ kind: 'ok', msg: 'Record deleted.' })
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Delete failed.' })
    } finally {
      setDeleting(false)
    }
  }

  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page">
          <PermissionDenied />
        </div>
      </div>
    )
  }

  const previewSrc = mapSrcFromEmbed(form.map_embed_code)
  // One record must always be active: the first record, or the record that is
  // currently the active one, can't be toggled off here. To switch the live
  // address, activate a different record from the list.
  const editingRec = editId != null ? list.find((r) => r.id === editId) : null
  const mustBeActive = (editId == null && list.length === 0) || (editingRec ? editingRec.is_active : false)

  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />
      <div className="admin-page ci-page">
        <header className="admin-page-head ci-head">
          <div>
            <h1 className="admin-page-title">Company Information</h1>
            <p className="admin-page-sub">Contact details &amp; office map shown on the public landing page. Only the active record is published.</p>
          </div>
          {canCreate && (
            <button type="button" className="btn-primary ci-add-btn" onClick={openCreate}>+ Add record</button>
          )}
        </header>

        {toast && (
          <div className={'admin-banner ' + (toast.kind === 'ok' ? 'success' : 'error')}>{toast.msg}</div>
        )}
        {error && <div className="admin-banner error">{error}</div>}

        <section className="admin-card list-card ci-records-card">
          {activating && (
            <div className="ci-busy-overlay" aria-live="polite" aria-busy="true">
              <span className="admin-spinner" aria-hidden="true" />
              <span>Updating…</span>
            </div>
          )}
          <div className="card-head">
            <h3 className="card-title">Records</h3>
            <span className="card-count">{list.length}</span>
          </div>
          <div className="list-scroll">
            {loading ? (
              <div className="admin-empty admin-loading">
                <span className="admin-spinner" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            ) : list.length === 0 ? (
              <div className="admin-empty">
                <div className="admin-empty-title">No company information yet.</div>
                <div className="admin-empty-sub">Add a record — it will become the active one shown on the public page.</div>
              </div>
            ) : (
              <ul className="detail-list ci-list">
                {list.map((rec) => {
                  const src = mapSrcFromEmbed(rec.map_embed_code)
                  return (
                    <li key={rec.id} className={'ci-record' + (rec.is_active ? ' is-active' : '')}>
                      <div className="ci-record-main">
                        <div className="ci-record-head">
                          <div className="ci-record-title">
                            <span className={'connection-dot' + (rec.is_active ? ' is-on' : '')} aria-hidden="true" />
                            <strong>{rec.company_name || rec.email || 'Untitled'}</strong>
                            <span className={'ssl-status-pill ' + (rec.is_active ? 'is-active' : 'is-expired')}>
                              {rec.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <div className="detail-row-actions">
                            {!rec.is_active && canUpdate && (
                              <button type="button" className="row-btn" onClick={() => onSetActive(rec)}>Activate</button>
                            )}
                            {canUpdate && (
                              <button type="button" className="row-btn ghost" onClick={() => openEdit(rec)}>Edit</button>
                            )}
                            {!rec.is_active && canDelete && (
                              <button type="button" className="row-btn danger" onClick={() => onDelete(rec)}>Delete</button>
                            )}
                          </div>
                        </div>
                        <div className="ci-record-body">
                          <dl className="ci-fields">
                            <div><dt>Email</dt><dd>{rec.email || '—'}</dd></div>
                            <div><dt>Phone</dt><dd>{rec.phone || '—'}</dd></div>
                            {rec.address ? <div className="ci-field-wide"><dt>Address</dt><dd>{rec.address}</dd></div> : null}
                          </dl>
                          {src && (
                            <div className="ci-map-thumb">
                              <iframe
                                title={`map-${rec.id}`}
                                src={src}
                                loading="lazy"
                                referrerPolicy="no-referrer-when-downgrade"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ─────────── Create / Edit modal ─────────── */}
      {modalOpen && (
        <div className="modal-overlay" onMouseDown={() => setModalOpen(false)}>
          <div className="modal-card modal-wide ci-modal" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{editId == null ? 'Add company information' : 'Edit company information'}</h2>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setModalOpen(false)}>×</button>
            </header>
            <form className="modal-body" onSubmit={onSave}>
              {formError && <div className="admin-banner error">{formError}</div>}
              <div className="form-grid-2">
                <label className="form-field">
                  <span>Company / Office name</span>
                  <input type="text" value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="MYACCESS PRIVATE LIMITED" />
                </label>
                <label className="form-field">
                  <span>Email</span>
                  <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="naveen@myaccessio.com" />
                </label>
                <label className="form-field">
                  <span>Phone</span>
                  <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 00000 00000" />
                </label>
                <label className="form-field ci-active-toggle">
                  <span>Active</span>
                  <label className="ci-switch">
                    <input
                      type="checkbox"
                      checked={mustBeActive ? true : makeActive}
                      disabled={mustBeActive}
                      onChange={(e) => setMakeActive(e.target.checked)}
                    />
                    <span>Show this record on the public page</span>
                  </label>
                  {mustBeActive && (
                    <small className="form-hint">One record must always be active. Activate a different record to switch the live address.</small>
                  )}
                </label>
              </div>
              <label className="form-field">
                <span>Address</span>
                <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, city, state, ZIP" />
              </label>
              <label className="form-field">
                <span>Google Maps embed code</span>
                <textarea
                  className="mono"
                  rows={3}
                  value={form.map_embed_code}
                  onChange={(e) => set('map_embed_code', e.target.value)}
                  placeholder={'Paste the full <iframe … src="…"></iframe> from Google Maps → Share → Embed a map'}
                />
                <small className="form-hint">Paste the whole embed snippet or just the map URL — the office point will render on the public page.</small>
              </label>
              {previewSrc && (
                <div className="ci-map-preview">
                  <div className="ci-map-preview-label">Map preview</div>
                  <div className="ci-map-thumb is-large">
                    <iframe title="map-preview" src={previewSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  </div>
                </div>
              )}
              <div className="modal-foot">
                <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : (editId == null ? 'Add record' : 'Save changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────── Delete confirmation ─────────── */}
      {confirmDelete && (
        <Modal title="Delete record?" onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              Delete <strong>{confirmDelete.company_name || confirmDelete.email || 'this record'}</strong>?
            </p>
            <p className="confirm-sub">
              This permanently removes the company information record. This action cannot be undone.
            </p>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={confirmDeleteRecord} disabled={deleting} aria-busy={deleting}>
              {deleting ? 'Deleting…' : 'Delete record'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
