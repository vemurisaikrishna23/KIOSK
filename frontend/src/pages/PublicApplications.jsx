import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Pager } from './Users.jsx'
import { RichTextInline, RichTextBlock } from '../components/RichText.jsx'

// Deterministic gradient per app (same hash → same palette) so imageless
// cards still look varied. Mirrors the authenticated Applications page.
const APP_PALETTES = [
  ['#F36A1E', '#FFB082'], ['#1FAE6B', '#9CE3B6'], ['#4A7BFF', '#A4BEFF'],
  ['#A65EB8', '#E5BBF0'], ['#E0463D', '#F0978F'], ['#C77A14', '#F0C977'],
  ['#1B998B', '#7FD4C8'], ['#D63384', '#F0A3CB'],
]
function djb2(str) {
  let h = 5381
  for (let i = 0; i < (str || '').length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}
function paletteFor(seed) { return APP_PALETTES[djb2(String(seed || '?')) % APP_PALETTES.length] }
// Tracks whether the viewport is phone-sized (matches the dashboard's own
// 768px breakpoint), so cards can predict whether the dashboard will open.
function useIsNarrow(maxWidth = 768) {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const handler = (e) => setNarrow(e.matches)
    mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler) }
  }, [maxWidth])
  return narrow
}
function formatDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/**
 * Public landing page (no auth required).
 *
 * Top: a lean engagement overview — how many apps are live and how many
 * times visitors have opened (tried) them, plus a "most tried" leaderboard.
 *
 * Below: every Application that's both `is_active` and `publish` on the
 * server, with a card per app. Clicking "View" opens the application's
 * published dashboard at /public/applications/:appId/dashboards/:id.
 *
 * If an app has multiple published dashboards we jump straight to the
 * first one — most apps have exactly one.
 */
export default function PublicApplications() {
  const [apps, setApps] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [descApp, setDescApp] = useState(null)   // app whose full description popup is open
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 6
  const isNarrow = useIsNarrow(768)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        // Analytics is independent of the per-app dashboard fetches —
        // start them in parallel and don't fail the page if just the
        // analytics call errors (the app list is the load-bearing part).
        const [analyticsResp, listResp] = await Promise.allSettled([
          api.publicAnalytics(),
          api.publicListApplications(),
        ])
        if (cancelled) return
        if (analyticsResp.status === 'fulfilled') {
          setAnalytics(analyticsResp.value)
        }
        if (listResp.status !== 'fulfilled') {
          throw listResp.reason
        }
        const list = listResp.value?.applications ?? (Array.isArray(listResp.value) ? listResp.value : [])
        // For each app, eagerly fetch its first published dashboard so
        // the "View" link can point straight at it. Misses (no dashboard
        // published yet) fall back to a disabled card.
        const enriched = await Promise.all(list.map(async (app) => {
          try {
            const dResp = await api.publicListDashboards({ application: app.id })
            const dashboards = dResp?.dashboards ?? (Array.isArray(dResp) ? dResp : [])
            return { ...app, dashboards }
          } catch {
            return { ...app, dashboards: [] }
          }
        }))
        if (!cancelled) setApps(enriched)
      } catch (e) {
        if (!cancelled) setError(e?.network ? 'Could not reach the server.' : 'Failed to load applications.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Map app id → tries (from the analytics payload) so each app card can show
  // its own engagement count alongside the aggregate overview.
  const triesByApp = new Map(
    (analytics?.applications || []).map((a) => [a.id, a.tries || 0])
  )

  // Pagination — the app grid lives in its own bounded, scrollable container so
  // the page itself never scrolls; long lists page instead of growing the page.
  const totalPages = Math.max(1, Math.ceil(apps.length / PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const pagedApps = useMemo(
    () => apps.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE),
    [apps, page],
  )
  const fromIdx = apps.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(page * PAGE_SIZE, apps.length)

  return (
    <div className="kiosk-app is-public-landing">
      <header className="public-topbar">
        <Link to="/" className="public-topbar-brand" aria-label="KIOSK home">
          <img src="/logos/myaccess.svg" alt="myaccess" className="logo-wordmark" />
        </Link>
        <div className="public-topbar-title">Live Applications</div>
        <Link to="/" className="public-topbar-back">Back to landing</Link>
      </header>

      <main className="admin-page public-page">
        <div className="public-intro">
          <h1>Public Kiosk Access Hub</h1>
          <p className="public-intro-lede">Explore published kiosk applications through a simple, touch-friendly public dashboard — no login required, secure, and fully interactive.</p>
        </div>

        {analytics && <AnalyticsOverview data={analytics} />}

        <section className="public-apps-panel">
          <div className="public-apps-panel-head">
            <h2>Applications</h2>
            {apps.length > 0 && <span className="public-apps-count">{apps.length}</span>}
          </div>
          {loading ? (
            <div className="admin-empty admin-loading">
              <span className="admin-spinner" aria-hidden="true" />
              <span>Loading applications…</span>
            </div>
          ) : error ? (
            <div className="admin-banner error">{error}</div>
          ) : apps.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-title">No published applications yet.</div>
              <div className="admin-empty-sub">An admin needs to mark an application as published before it appears here.</div>
            </div>
          ) : (
            <>
              <div className="camera-grid app-grid public-app-grid-v2">
                {pagedApps.map((app) => (
                  <PublicAppCard
                    key={app.id}
                    app={app}
                    tries={triesByApp.get(app.id) || 0}
                    isNarrow={isNarrow}
                    onShowDesc={() => setDescApp(app)}
                  />
                ))}
              </div>
              <Pager
                page={page}
                totalPages={totalPages}
                fromIdx={fromIdx}
                toIdx={toIdx}
                total={apps.length}
                label="applications"
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={loading}
              />
            </>
          )}
        </section>
      </main>

      {descApp && <DescriptionModal app={descApp} onClose={() => setDescApp(null)} />}
    </div>
  )
}

/* ---------- Public application card ----------
   Mirrors the authenticated Applications page card (hero + name + clamped
   markdown description + meta), but the action opens the app's published
   public dashboard instead of editing. The whole card is also clickable. */
function PublicAppCard({ app, tries, isNarrow, onShowDesc }) {
  const navigate = useNavigate()
  const name = app.name || app.application_name || `Application #${app.id}`
  const imageUrl = app.application_image || null
  const [c1, c2] = paletteFor(app.id ?? name)
  const heroStyle = imageUrl ? undefined : { background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'

  // Viewport-aware: a phone can only open a dashboard whose MOBILE layout is
  // published, a desktop one whose DESKTOP layout is published. Pick the first
  // dashboard published for this device — if none, the card reads "No
  // dashboard yet" for this viewport.
  const viewable = (app.dashboards || []).find((d) => (isNarrow ? d.publish_mobile : d.publish_desktop))
  const canView = !!viewable
  const to = canView ? `/public/applications/${app.id}/dashboards/${viewable.id}` : null

  // "Read more" appears only when the clamped description actually overflows.
  const descRef = useRef(null)
  const [descOverflows, setDescOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) { setDescOverflows(false); return }
    const check = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 18
      setDescOverflows(el.scrollHeight > lh * 1.5)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [app.description])

  const goView = () => { if (to) navigate(to) }

  return (
    <article
      className="app-card-v2"
      role={canView ? 'button' : undefined}
      tabIndex={canView ? 0 : undefined}
      onClick={canView ? goView : undefined}
      onKeyDown={canView ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goView() } } : undefined}
      aria-label={canView ? `Open ${name}` : name}
    >
      <div className="app-hero" style={heroStyle}>
        {imageUrl ? (
          <>
            <img className="app-hero-bg" src={imageUrl} alt="" aria-hidden="true" />
            <img className="app-hero-img" src={imageUrl} alt="" />
          </>
        ) : (
          <span className="app-hero-initial" aria-hidden="true">{initial}</span>
        )}
        <span className="app-publish-pill is-pub">
          <span className="app-publish-dot" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="app-body">
        <h4 className="app-name">{name}</h4>
        <div ref={descRef} className="app-desc">
          {app.description
            ? <RichTextInline value={app.description} />
            : <span className="muted">No description</span>}
        </div>
        {descOverflows && (
          <button type="button" className="app-readmore" onClick={(e) => { e.stopPropagation(); onShowDesc?.() }}>
            Read more
            <svg className="app-readmore-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="app-meta-row">
        <span className="app-meta-item app-meta-date">{formatDate(app.created_at)}</span>
        <span className="app-meta-item public-tries-meta" title="Public dashboard views">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7Z" stroke="currentColor" strokeWidth="1.7"/>
            <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7"/>
          </svg>
          {tries} {tries === 1 ? 'view' : 'views'}
        </span>
      </div>

      <div className="app-actions" onClick={(e) => e.stopPropagation()}>
        {canView ? (
          <Link to={to} className="btn-primary public-app-view-btn">View dashboard</Link>
        ) : (
          <button
            type="button"
            className="btn-secondary public-app-noview-btn"
            disabled
            title={`No ${isNarrow ? 'mobile' : 'desktop'} dashboard published`}
          >
            No dashboard yet
          </button>
        )}
      </div>
    </article>
  )
}

/* ---------- Full description popup ---------- */
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
          <h2>{app?.name || app?.application_name || 'Description'}</h2>
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

/* ---------- Engagement overview ----------
   A lean, classic summary built around how much the public is actually
   using the apps: how many are live, how many times they've been opened
   ("tries"), and a "most tried" leaderboard. Everything comes from the
   single /public/analytics/ payload so it stays cheap to render. */
function AnalyticsOverview({ data }) {
  const totals = data?.totals || {}
  const perApp = Array.isArray(data?.applications) ? data.applications : []

  const appCount = totals.applications ?? 0
  const tries = totals.tries ?? 0
  // Backend returns apps already sorted by popularity (most tried first).
  const topApp = [...perApp].sort((a, b) => (b.tries || 0) - (a.tries || 0))[0]
  const avgTries = appCount ? Math.round(tries / appCount) : 0

  const kpis = [
    { label: 'Live applications', value: appCount, hint: 'Published & ready to view' },
    { label: 'Total views',       value: tries,    hint: 'Public dashboard opens' },
    { label: 'Avg views / app',   value: avgTries, hint: 'Across every app' },
  ]

  return (
    <section className="public-analytics" aria-label="Engagement overview">
      <div className="public-analytics-head">
        <h2>Engagement overview</h2>
      </div>

      <div className="public-kpi-grid">
        {/* Feature tile — the single most useful headline: the most-tried app. */}
        <div className="public-kpi-tile is-feature">
          <div className="public-kpi-label">Most viewed</div>
          <div className="public-kpi-feature-name">{topApp?.application_name || '—'}</div>
          <div className="public-kpi-hint">
            {topApp ? `${topApp.tries || 0} ${(topApp.tries || 0) === 1 ? 'view' : 'views'}` : 'No views yet'}
          </div>
        </div>
        {kpis.map((k) => (
          <div key={k.label} className="public-kpi-tile">
            <div className="public-kpi-label">{k.label}</div>
            <div className="public-kpi-value">{k.value}</div>
            <div className="public-kpi-hint">{k.hint}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
