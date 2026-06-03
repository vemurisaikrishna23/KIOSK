import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'

/**
 * Public landing page (no auth required).
 *
 * Top: analytics overview — KPI tiles (total apps / dashboards / devices /
 * cameras / connected devices) + a per-application breakdown bar.
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
          <h1>Try a live application</h1>
          <p>Pick a published application below to open its public dashboard. No sign-in required — toggles, controls, and live data all work.</p>
        </div>

        {analytics && <AnalyticsOverview data={analytics} />}

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
          <div className="public-app-grid">
            {apps.map((app) => {
              const firstDash = app.dashboards?.[0]
              const canView = !!firstDash
              const to = canView
                ? `/public/applications/${app.id}/dashboards/${firstDash.id}`
                : '#'
              return (
                <article key={app.id} className="public-app-card">
                  <div className="public-app-card-head">
                    <div className="public-app-card-title">{app.application_name || app.name || `Application #${app.id}`}</div>
                    {app.application_type && (
                      <span className="public-app-card-type">{app.application_type}</span>
                    )}
                  </div>
                  {app.description && (
                    <p className="public-app-card-desc">{app.description}</p>
                  )}
                  <div className="public-app-card-meta">
                    <span className="public-app-card-chip">
                      {app.dashboards?.length || 0} {(app.dashboards?.length || 0) === 1 ? 'dashboard' : 'dashboards'}
                    </span>
                  </div>
                  <div className="public-app-card-actions">
                    {canView ? (
                      <Link to={to} className="btn-primary public-app-card-view">View</Link>
                    ) : (
                      <button type="button" className="btn-secondary" disabled title="No published dashboard">
                        No dashboard yet
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

/* ---------- Analytics overview ----------
   KPI tiles + per-application breakdown row. Pulls everything from the
   single /public/analytics/ payload so it stays cheap to render. */
function AnalyticsOverview({ data }) {
  const totals = data?.totals || {}
  const perApp = Array.isArray(data?.applications) ? data.applications : []

  const kpis = [
    { label: 'Applications', value: totals.applications ?? 0, hint: 'Currently published' },
    { label: 'Dashboards',   value: totals.dashboards ?? 0,   hint: 'Available to view' },
    { label: 'Devices',      value: totals.devices ?? 0,      hint: `${totals.devices_connected ?? 0} live now` },
    { label: 'Cameras',      value: totals.cameras ?? 0,      hint: 'Linked to apps' },
  ]

  // Stacked-bar denominator — pick the biggest single per-app resource
  // count so the bars scale relative to the busiest application. Avoids
  // a single small app being rendered as a full bar.
  const maxPerApp = perApp.reduce((m, a) => Math.max(
    m,
    (a.dashboards_count || 0) + (a.devices_count || 0) + (a.cameras_count || 0)
  ), 1)

  return (
    <section className="public-analytics" aria-label="Public analytics overview">
      <div className="public-analytics-head">
        <h2>Live overview</h2>
        <span className="public-analytics-sub">Aggregate state of every published application</span>
      </div>

      <div className="public-kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className="public-kpi-tile">
            <div className="public-kpi-label">{k.label}</div>
            <div className="public-kpi-value">{k.value}</div>
            <div className="public-kpi-hint">{k.hint}</div>
          </div>
        ))}
      </div>

      {perApp.length > 0 && (
        <div className="public-breakdown">
          <div className="public-breakdown-head">
            <span>Per-application breakdown</span>
            <span className="public-breakdown-legend">
              <i className="public-breakdown-swatch is-dash" /> Dashboards
              <i className="public-breakdown-swatch is-dev"  /> Devices
              <i className="public-breakdown-swatch is-cam"  /> Cameras
            </span>
          </div>
          <ul className="public-breakdown-list">
            {perApp.map((a) => {
              const total = (a.dashboards_count || 0) + (a.devices_count || 0) + (a.cameras_count || 0)
              const w = (n) => `${((n || 0) / maxPerApp) * 100}%`
              return (
                <li key={a.id} className="public-breakdown-row">
                  <div className="public-breakdown-row-head">
                    <span className="public-breakdown-name">{a.application_name || `Application #${a.id}`}</span>
                    <span className="public-breakdown-total">{total}</span>
                  </div>
                  <div className="public-breakdown-bar" role="presentation">
                    <div className="public-breakdown-seg is-dash" style={{ width: w(a.dashboards_count) }} title={`${a.dashboards_count || 0} dashboards`} />
                    <div className="public-breakdown-seg is-dev"  style={{ width: w(a.devices_count)    }} title={`${a.devices_count || 0} devices (${a.devices_connected_count || 0} live)`} />
                    <div className="public-breakdown-seg is-cam"  style={{ width: w(a.cameras_count)    }} title={`${a.cameras_count || 0} cameras`} />
                  </div>
                  <div className="public-breakdown-stats">
                    <span>{a.dashboards_count || 0} dashboards</span>
                    <span>{a.devices_count || 0} devices · {a.devices_connected_count || 0} live</span>
                    <span>{a.cameras_count || 0} cameras</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
