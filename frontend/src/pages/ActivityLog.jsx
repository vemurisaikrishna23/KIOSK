import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied } from './Cameras.jsx'
import { Pager } from './Users.jsx'
import { api, auth } from '../lib/api.js'

const PAGE_SIZES = [10, 25, 50, 100]   // rows per page (backend caps at 100)

/* Duration presets — default 1 day, up to 30. */
const RANGES = [
  { key: '1',  label: 'Today' },
  { key: '7',  label: '7 days' },
  { key: '15', label: '15 days' },
  { key: '30', label: '30 days' },
  { key: 'custom', label: 'Custom' },
]
const CATEGORIES = ['all', 'application', 'dashboard', 'device', 'camera', 'user', 'role', 'company', 'ssl', 'system']
const ACTION_STATE = { create: 'ok', update: 'idle', delete: 'err' }
const ACTION_LABEL = { create: 'Created', update: 'Updated', delete: 'Deleted' }

function todayISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
/** Earliest selectable date — one month (30 days) back, matching retention. */
function monthBackISO() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
function formatAbs(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return String(iso) }
}

/**
 * Activity Log — view & download the internal audit log over a selectable
 * time window (default today, up to 30 days).
 *
 * Permissions:
 *   – activity_log_view      → view this page
 *   – activity_log_download  → export the visible range as CSV
 */
export default function ActivityLog() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView     = auth.hasPerm('activity_log_view')
  const canDownload = auth.hasPerm('activity_log_download')

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [logs, setLogs]         = useState([])
  const [total, setTotal]       = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [range, setRange]       = useState('1')
  const [customStart, setCustomStart] = useState(todayISO())
  const [customEnd, setCustomEnd]     = useState(todayISO())
  const [category, setCategory] = useState('all')
  const [downloading, setDownloading] = useState(false)
  const [toast, setToast]       = useState(null)

  const customInvalid = range === 'custom' && (!customStart || !customEnd || customEnd < customStart)

  function rangeParams() {
    const p = {}
    if (category !== 'all') p.category = category
    if (range === 'custom') { p.start = customStart; p.end = customEnd }
    else p.days = Number(range)
    return p
  }

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    if (customInvalid) { setLogs([]); setTotal(0); setTotalPages(1); setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const resp = await api.listActivityLogs({ ...rangeParams(), page, page_size: pageSize })
      setLogs(Array.isArray(resp?.logs) ? resp.logs : [])
      setTotal(resp?.count || 0)
      setTotalPages(resp?.total_pages || 1)
    } catch (e) {
      setError(e?.network ? 'Could not reach the server.' : (e?.message || 'Failed to load activity logs.'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, page, pageSize, range, customStart, customEnd, category, customInvalid])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  function pick(setter, value) { setter(value); setPage(1) }

  async function onDownload() {
    if (!canDownload || customInvalid) return
    setDownloading(true)
    try {
      const csv = await api.downloadActivityLogs(rangeParams())
      const blob = new Blob([typeof csv === 'string' ? csv : ''], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const tag = range === 'custom' ? `${customStart}_to_${customEnd}` : `last-${range}d`
      a.download = `activity-logs_${tag}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setToast({ kind: 'ok', msg: 'Download started.' })
    } catch (e) {
      setToast({ kind: 'err', msg: e?.status === 403 ? 'You don’t have permission to download.' : (e?.message || 'Download failed.') })
    } finally {
      setDownloading(false)
    }
  }

  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page"><PermissionDenied resource="activity logs" /></div>
      </div>
    )
  }

  const fromIdx = total === 0 ? 0 : (page - 1) * pageSize + 1
  const toIdx   = Math.min(total, page * pageSize)

  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />
      <div className="admin-page alog-page">
        <header className="admin-page-head">
          <div>
            <h1>Activity Log</h1>
            <p className="lede">Internal audit trail — who changed what, kept for 30 days.</p>
          </div>
          <div className="admin-page-actions">
            <button
              type="button"
              className="btn-primary alog-dl"
              onClick={onDownload}
              disabled={!canDownload || downloading || customInvalid || loading}
              title={canDownload ? 'Download the selected range as CSV' : 'You don’t have download permission'}
            >
              {downloading ? 'Preparing…' : '↓ Download CSV'}
            </button>
          </div>
        </header>

        {toast && <div className={'admin-banner ' + (toast.kind === 'ok' ? 'success' : 'error')}>{toast.msg}</div>}
        {error && <div className="admin-banner error">{error}</div>}

        {/* Duration + category controls */}
        <div className="alog-controls">
          <div className="tf-pill" role="tablist" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.key} type="button" role="tab" aria-selected={range === r.key}
                className={'tf-opt' + (range === r.key ? ' is-active' : '')}
                onClick={() => pick(setRange, r.key)}>{r.label}</button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="alog-dates">
              <label>From <input type="date" value={customStart} min={monthBackISO()} max={customEnd || todayISO()}
                onChange={(e) => pick(setCustomStart, e.target.value)} /></label>
              <label>To <input type="date" value={customEnd} min={customStart || monthBackISO()} max={todayISO()}
                onChange={(e) => pick(setCustomEnd, e.target.value)} /></label>
              <span className="alog-date-hint">Up to 1 month back</span>
            </div>
          )}

          <select className="alog-cat" value={category} onChange={(e) => pick(setCategory, e.target.value)} aria-label="Filter by category">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
          <select className="alog-rows" value={pageSize} onChange={(e) => pick(setPageSize, Number(e.target.value))} aria-label="Rows per page">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>

        {customInvalid && <div className="admin-banner error">End date must be on or after the start date.</div>}

        <section className="admin-card list-card alog-table">
          <div className="alog-head">
            <div>When</div><div>Category</div><div>Action</div><div>Entity</div><div>Detail</div><div>Actor</div>
          </div>
          <div className="list-scroll">
            {loading ? (
              <div className="admin-empty admin-loading"><span className="admin-spinner" aria-hidden="true" /><span>Loading…</span></div>
            ) : customInvalid ? (
              <div className="admin-empty">Pick a valid start and end date.</div>
            ) : total === 0 ? (
              <div className="admin-empty">No activity in this period.</div>
            ) : (
              logs.map((r) => {
                const st = ACTION_STATE[r.action] || 'idle'
                return (
                  <div className={'alog-row alog-' + st} key={r.id}>
                    <div className="alog-when" data-col="When">{formatAbs(r.created_at)}</div>
                    <div data-col="Category"><span className="dl-type">{r.category}</span></div>
                    <div data-col="Action"><span className={'dl-state dl-state-' + st}>{ACTION_LABEL[r.action] || r.action}</span></div>
                    <div className="alog-entity" data-col="Entity">{r.entity_name || '—'}</div>
                    <div className="alog-detail" data-col="Detail">{r.message || '—'}</div>
                    <div className="alog-actor" data-col="Actor">{r.actor_name || '—'}</div>
                  </div>
                )
              })
            )}
          </div>

          {!loading && total > 0 && (
            <Pager
              page={page}
              totalPages={totalPages}
              fromIdx={fromIdx}
              toIdx={toIdx}
              total={total}
              label={total === 1 ? 'entry' : 'entries'}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          )}
        </section>
      </div>
    </div>
  )
}
