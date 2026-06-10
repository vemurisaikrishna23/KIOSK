import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied } from './Cameras.jsx'
import { Pager } from './Users.jsx'
import { api, auth } from '../lib/api.js'

const PAGE_SIZE = 10

/**
 * SSL Certificate management — lifecycle-aware.
 *
 * There is exactly ONE active certificate at a time. Uploading a new
 * file or reactivating an older one automatically demotes the previous
 * active certificate to "expired" (handled by the model's save()).
 *
 * Permissions:
 *   – ssl_certificate_view    → view this page + history
 *   – ssl_certificate_upload  → upload + reactivate
 *   – ssl_certificate_delete  → delete from history
 */
export default function SslCertificate() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView   = auth.hasPerm('ssl_certificate_view')
  const canUpload = auth.hasPerm('ssl_certificate_upload')
  const canDelete = auth.hasPerm('ssl_certificate_delete')

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [active, setActive]   = useState(null)
  const [list, setList]       = useState([])
  const [toast, setToast]     = useState(null)
  const [page, setPage]       = useState(1)
  const [preview, setPreview] = useState(null) // { name, text } | { name, loading } | { name, error }

  // ---- pagination
  const total       = list.length
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx     = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx       = Math.min(total, page * PAGE_SIZE)
  const paged       = useMemo(() => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [list, page])

  // Snap back to a valid page when the list size shrinks (e.g. after delete).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // ---- upload form (single file, minimal fields)
  const fileRef = useRef(null)
  const [form, setForm] = useState({ name: '', file: null })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const resp = await api.listSSLCertificates()
      setActive(resp?.active || null)
      setList(Array.isArray(resp?.certificates) ? resp.certificates : [])
    } catch (e) {
      setError(e?.network ? 'Could not reach the server.' : (e?.message || 'Failed to load certificates.'))
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

  async function onUpload(e) {
    e.preventDefault()
    setFormError(null)
    if (!form.file) { setFormError('Pick a .crt / .pem file to upload.'); return }
    // Default the name to the filename when the field is left blank —
    // keeps the upload one-click for the common case.
    const name = form.name.trim() || form.file.name.replace(/\.[^.]+$/, '')
    setSaving(true)
    try {
      await api.uploadSSLCertificate({
        name,
        description: '',
        file: form.file,
        isActive: true,
      })
      setForm({ name: '', file: null })
      if (fileRef.current) fileRef.current.value = ''
      const prevName = active?.name ? `“${active.name}” moved to expired. ` : ''
      setToast({ kind: 'ok', msg: prevName + 'New certificate is now active.' })
      load()
    } catch (e) {
      const msg = e?.data && typeof e.data === 'object'
        ? Object.entries(e.data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')
        : (e?.message || 'Upload failed.')
      setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function onSetActive(cert) {
    if (!window.confirm(`Make “${cert.name}” the active certificate?\n\nThe current active certificate will be moved to expired.`)) return
    try {
      await api.setActiveSSLCertificate(cert.id)
      const prevName = active?.name ? `“${active.name}” moved to expired. ` : ''
      setToast({ kind: 'ok', msg: prevName + `“${cert.name}” is now active.` })
      load()
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Failed to set active.' })
    }
  }
  async function onPreview(cert) {
    if (!cert.file_url) {
      setToast({ kind: 'err', msg: 'No file to preview for this certificate.' })
      return
    }
    setPreview({ name: cert.filename || cert.name || 'certificate', loading: true })
    try {
      const resp = await fetch(cert.file_url)
      if (!resp.ok) {
        setPreview({ name: cert.filename || cert.name, error: `Could not load certificate (HTTP ${resp.status}).` })
        return
      }
      const text = await resp.text()
      setPreview({ name: cert.filename || cert.name || 'certificate', text })
    } catch {
      setPreview({ name: cert.filename || cert.name, error: 'Could not reach the server to preview the certificate.' })
    }
  }
  async function onDelete(cert) {
    if (cert.is_active) {
      setToast({ kind: 'err', msg: 'Cannot delete the active certificate. Upload a new one first.' })
      return
    }
    if (!window.confirm(`Delete the expired certificate “${cert.name}”?\nThis cannot be undone.`)) return
    try {
      await api.deleteSSLCertificate(cert.id)
      setToast({ kind: 'ok', msg: 'Expired certificate deleted.' })
      load()
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Delete failed.' })
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

  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />
      <div className="admin-page">
        <header className="admin-page-head">
          <div>
            <h1 className="admin-page-title">SSL Certificate</h1>
          </div>
        </header>

        {toast && (
          <div className={'admin-banner ' + (toast.kind === 'ok' ? 'success' : 'error')}>{toast.msg}</div>
        )}
        {error && <div className="admin-banner error">{error}</div>}

        {/* ─────────── Upload (single inline row) ─────────── */}
        {canUpload && (
          <section className="admin-card ssl-upload-bar">
            <form className="ssl-upload-inline" onSubmit={onUpload}>
              <div className="ssl-inline-title">Upload new certificate</div>
              <input
                ref={fileRef}
                type="file"
                className="ssl-inline-file"
                accept=".crt,.pem,.cer,.der,application/x-x509-ca-cert,application/pkix-cert"
                onChange={(e) => set('file', e.target.files?.[0] || null)}
                disabled={saving}
                aria-label="Certificate file"
              />
              <input
                type="text"
                className="ssl-inline-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Label (optional — defaults to file name)"
                disabled={saving}
              />
              <button type="submit" className="btn-primary ssl-inline-btn" disabled={saving}>
                {saving ? 'Uploading…' : 'Upload as active'}
              </button>
              {active && (
                <span className="ssl-replace-hint">replaces <code>{active.filename || active.name}</code></span>
              )}
            </form>
            {formError && <div className="admin-banner error ssl-upload-error">{formError}</div>}
          </section>
        )}

        {/* ─────────── Records (unified active + expired list) ─────────── */}
        <section className="admin-card list-card">
          <div className="card-head">
            <h3 className="card-title">Certificate records</h3>
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
                <div className="admin-empty-title">No certificate uploaded yet.</div>
                <div className="admin-empty-sub">Use the form above to upload one. It will become active immediately.</div>
              </div>
            ) : (
              <ul className="detail-list ssl-record-list">
                {paged.map((c) => {
                  const isActive = !!c.is_active
                  return (
                    <li key={c.id} className={'detail-row ssl-record' + (isActive ? ' is-active' : ' is-expired')}>
                      <div className="detail-row-id">
                        <div className={'connection-dot' + (isActive ? ' is-on' : '')} aria-hidden="true" />
                        <div className="detail-row-text">
                          <div className="ssl-record-head">
                            <div className="detail-row-name">{c.name}</div>
                            <span className={'ssl-status-pill ' + (isActive ? 'is-active' : 'is-expired')}>
                              {isActive ? 'Active' : 'Expired'}
                            </span>
                          </div>
                          <div className="detail-row-sub">
                            <code>{c.filename || '—'}</code>
                            <span>· {formatBytes(c.file_size)}</span>
                            <span>· uploaded {formatAbs(c.uploaded_at)}</span>
                            {c.uploaded_by_email && <span>· by {c.uploaded_by_email}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="detail-row-actions">
                        {c.file_url && (
                          <button type="button" className="row-btn ghost" onClick={() => onPreview(c)}>
                            Preview
                          </button>
                        )}
                        {c.file_url && (
                          <a className="row-btn" href={c.file_url} download>Download</a>
                        )}
                        {!isActive && canUpload && (
                          <button type="button" className="row-btn" onClick={() => onSetActive(c)}>
                            Reactivate
                          </button>
                        )}
                        {!isActive && canDelete && (
                          <button type="button" className="row-btn danger" onClick={() => onDelete(c)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {!loading && total > 0 && (
            <Pager
              page={page}
              totalPages={totalPages}
              fromIdx={fromIdx}
              toIdx={toIdx}
              total={total}
              label={total === 1 ? 'certificate' : 'certificates'}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          )}
        </section>
      </div>

      {/* ─────────── Certificate preview modal ─────────── */}
      {preview && (
        <div className="modal-overlay" onMouseDown={() => setPreview(null)}>
          <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Certificate preview</h2>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setPreview(null)}>×</button>
            </header>
            <div className="modal-body">
              <div className="cert-preview-meta">
                <code>{preview.name}</code>
                {preview.text && (
                  <button
                    type="button"
                    className="row-btn ghost"
                    onClick={() => { try { navigator.clipboard.writeText(preview.text) } catch {} }}
                  >
                    Copy
                  </button>
                )}
              </div>
              {preview.loading ? (
                <div className="admin-empty admin-loading">
                  <span className="admin-spinner" aria-hidden="true" />
                  <span>Loading certificate…</span>
                </div>
              ) : preview.error ? (
                <div className="admin-banner error">{preview.error}</div>
              ) : (
                <pre className="cert-preview-text">{preview.text}</pre>
              )}
              <div className="modal-foot">
                <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatBytes(n) {
  if (n == null || n === '') return '—'
  const k = 1024
  if (n < k) return `${n} B`
  if (n < k * k) return `${(n / k).toFixed(1)} KB`
  return `${(n / (k * k)).toFixed(1)} MB`
}
function formatAbs(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return String(iso)
  }
}
