import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied, Modal } from './Cameras.jsx'
import { Pager } from './Users.jsx'
import { api, auth } from '../lib/api.js'

const PAGE_SIZE = 10

/* The submission lifecycle. `key` matches the backend status value; the
   pill class drives the colour. Order doubles as the dropdown order. */
const STATUSES = [
  { key: 'new',            label: 'New' },
  { key: 'contacted',      label: 'Contacted' },
  { key: 'in_discussion',  label: 'In Discussion' },
  { key: 'converted',      label: 'Converted' },
  { key: 'not_interested', label: 'Not Interested' },
]
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
  } catch { return '—' }
}
function formatAbs(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return String(iso) }
}

/**
 * Contact Us submissions — admin triage, laid out like the Users page
 * (search · stat tiles · table that collapses to cards on mobile). Reading a
 * message opens a formatted popup where the status can also be changed.
 *
 * Permissions:
 *   – contact_submission_view    → view this page
 *   – contact_submission_update  → change a submission's status
 *   – contact_submission_delete  → delete a submission
 */
export default function ContactSubmissions() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView   = auth.hasPerm('contact_submission_view')
  const canUpdate = auth.hasPerm('contact_submission_update')
  const canDelete = auth.hasPerm('contact_submission_delete')

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [list, setList]         = useState([])
  const [counts, setCounts]     = useState({})
  const [toast, setToast]       = useState(null)
  const [page, setPage]         = useState(1)
  const [filter, setFilter]     = useState('all')   // 'all' | status key
  const [query, setQuery]       = useState('')
  const [viewing, setViewing]   = useState(null)     // submission shown in the read popup
  const [busyId, setBusyId]     = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)  // submission pending delete confirmation
  const [deleting, setDeleting] = useState(false)

  // status filter + free-text search (client-side; the API returns the full set)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false
      if (!q) return true
      return [s.name, s.email, s.message]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [list, filter, query])

  const total      = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx    = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx      = Math.min(total, page * PAGE_SIZE)
  const paged      = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  useEffect(() => { setPage(1) }, [filter, query])

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const resp = await api.listContactSubmissions()
      setList(Array.isArray(resp?.submissions) ? resp.submissions : [])
      setCounts(resp?.status_counts || {})
    } catch (e) {
      setError(e?.network ? 'Could not reach the server.' : (e?.message || 'Failed to load submissions.'))
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

  // Close the popup on Escape.
  useEffect(() => {
    if (!viewing) return undefined
    function onKey(e) { if (e.key === 'Escape') setViewing(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])

  async function onStatusChange(sub, status) {
    if (status === sub.status) return
    setBusyId(sub.id)
    try {
      await api.updateContactSubmission(sub.id, { status })
      setList((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status } : s)))
      setViewing((v) => (v && v.id === sub.id ? { ...v, status } : v))
      setCounts((prev) => {
        const next = { ...prev }
        next[sub.status] = Math.max(0, (next[sub.status] || 1) - 1)
        next[status] = (next[status] || 0) + 1
        return next
      })
      setToast({ kind: 'ok', msg: `Marked “${sub.name}” as ${STATUS_LABEL[status]}.` })
    } catch (e) {
      setToast({ kind: 'err', msg: e?.message || 'Failed to update status.' })
    } finally {
      setBusyId(null)
    }
  }

  function onDelete(sub) { setConfirmDelete(sub) }
  async function confirmDeleteSub() {
    const sub = confirmDelete
    if (!sub || deleting) return
    setDeleting(true)
    try {
      await api.deleteContactSubmission(sub.id)
      setList((prev) => prev.filter((s) => s.id !== sub.id))
      setCounts((prev) => ({ ...prev, [sub.status]: Math.max(0, (prev[sub.status] || 1) - 1) }))
      setViewing((v) => (v && v.id === sub.id ? null : v))
      setConfirmDelete(null)
      setToast({ kind: 'ok', msg: 'Submission deleted.' })
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
        <div className="admin-page"><PermissionDenied resource="contact submissions" /></div>
      </div>
    )
  }

  const totalAll = list.length

  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />
      <div className="admin-page cs-page">
        <header className="admin-page-head">
          <div>
            <h1>Contact Submissions</h1>
            <p className="lede">Messages sent from the public landing page’s contact form.</p>
          </div>
          <div className="admin-page-actions">
            <div className="admin-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search name, email or message…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') } }}
                aria-label="Search submissions"
              />
              {query && (
                <button type="button" className="admin-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>×</button>
              )}
            </div>
          </div>
        </header>

        <section className="admin-stats">
          <div className="dash-stat"><div className="n">{totalAll}</div><div className="l">Total messages</div></div>
          <div className="dash-stat"><div className="n">{counts.new || 0}</div><div className="l">New</div></div>
          <div className="dash-stat"><div className="n">{counts.in_discussion || 0}</div><div className="l">In discussion</div></div>
          <div className="dash-stat"><div className="n">{counts.converted || 0}</div><div className="l">Converted</div></div>
        </section>

        {toast && (
          <div className={'admin-banner ' + (toast.kind === 'ok' ? 'success' : 'error')}>{toast.msg}</div>
        )}
        {error && <div className="admin-banner error">{error}</div>}

        {/* Status filter chips */}
        <div className="cs-filter-row">
          <button type="button" className={'cs-chip' + (filter === 'all' ? ' is-on' : '')} onClick={() => setFilter('all')}>
            All <span className="cs-chip-count">{totalAll}</span>
          </button>
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={'cs-chip cs-chip-' + s.key + (filter === s.key ? ' is-on' : '')}
              onClick={() => setFilter(s.key)}
            >
              {s.label} <span className="cs-chip-count">{counts[s.key] || 0}</span>
            </button>
          ))}
        </div>

        <section className="admin-card list-card cs-table">
          <div className="user-table-head">
            <div>Name</div>
            <div>Email</div>
            <div>Status</div>
            <div>Received</div>
            <div className="ta-right">Actions</div>
          </div>

          <div className="list-scroll">
            {loading ? (
              <div className="admin-empty admin-loading">
                <span className="admin-spinner" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            ) : total === 0 ? (
              <div className="admin-empty">
                {query
                  ? <>No submissions match <strong>“{query}”</strong>. <button type="button" className="link-btn" onClick={() => setQuery('')}>Clear search</button></>
                  : (filter !== 'all' ? `No submissions in “${STATUS_LABEL[filter]}”.` : 'No submissions yet. Messages from the public contact form appear here.')}
              </div>
            ) : (
              paged.map((s) => (
                <div className={'user-row cs-row cs-status-' + s.status} key={s.id}>
                  <div className="cs-cell-name" data-col="Name">
                    <span className="user-name">{s.name}</span>
                  </div>
                  <div className="cs-cell-email" data-col="Email">
                    <a className="cs-row-email" href={`mailto:${s.email}`}>{s.email}</a>
                  </div>
                  <div data-col="Status">
                    <span className={'cs-status-pill cs-pill-' + s.status}>{STATUS_LABEL[s.status] || s.status}</span>
                  </div>
                  <div className="user-sub" data-col="Received">{formatDate(s.created_at)}</div>
                  <div className="user-actions" data-col="Actions">
                    <button type="button" className="row-btn" onClick={() => setViewing(s)}>View message</button>
                    {canDelete && (
                      <button type="button" className="row-btn danger" onClick={() => onDelete(s)}>Delete</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {!loading && total > 0 && (
            <Pager
              page={page}
              totalPages={totalPages}
              fromIdx={fromIdx}
              toIdx={toIdx}
              total={total}
              label={total === 1 ? 'message' : 'messages'}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          )}
        </section>
      </div>

      {/* ─────────── Read-message popup (standard modal) ─────────── */}
      {viewing && (
        <div className="modal-overlay cs-msg-overlay" onMouseDown={() => setViewing(null)}>
          <div className="modal-card modal-wide cs-msg-modal" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Message</h2>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </header>
            <div className="modal-body">
              {/* Read-only details — same meta-grid pattern as the device modal */}
              <dl className="device-meta-grid cs-msg-meta">
                <div><dt>Name</dt><dd>{viewing.name}</dd></div>
                <div><dt>Email</dt><dd><a className="cs-row-email" href={`mailto:${viewing.email}`}>{viewing.email}</a></dd></div>
                <div><dt>Received</dt><dd>{formatAbs(viewing.created_at)}</dd></div>
                <div><dt>Status</dt><dd><span className={'cs-status-pill cs-pill-' + viewing.status}>{STATUS_LABEL[viewing.status] || viewing.status}</span></dd></div>
                <div className="cs-meta-wide"><dt>Subject</dt><dd>{viewing.subject || <span className="cs-muted">No subject</span>}</dd></div>
              </dl>

              {/* Message */}
              <label className="form-field">
                <span className="form-label">Message</span>
                <div className="cs-msg-readonly">{viewing.message}</div>
              </label>

              {/* Status control */}
              {canUpdate && (
                <label className="form-field">
                  <span className="form-label">Update status</span>
                  <select
                    value={viewing.status}
                    disabled={busyId === viewing.id}
                    onChange={(e) => onStatusChange(viewing, e.target.value)}
                  >
                    {STATUSES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                  </select>
                </label>
              )}

              <div className="modal-foot">
                {canDelete && (
                  <button type="button" className="btn-danger" onClick={() => onDelete(viewing)}>Delete</button>
                )}
                <a className="btn-secondary" href={`mailto:${viewing.email}?subject=${encodeURIComponent('Re: ' + (viewing.subject || 'your message'))}`}>Reply by email</a>
                <button type="button" className="btn-primary" onClick={() => setViewing(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── Delete confirmation ─────────── */}
      {confirmDelete && (
        <Modal title="Delete message?" onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              Delete the message from <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="confirm-sub">
              This permanently removes the submission from the inbox. This action cannot be undone.
            </p>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={confirmDeleteSub} disabled={deleting} aria-busy={deleting}>
              {deleting ? 'Deleting…' : 'Delete message'}
            </button>
          </div>
        </Modal>
      )}
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
