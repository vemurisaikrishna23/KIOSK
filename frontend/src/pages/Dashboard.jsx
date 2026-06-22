import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import WsStatus from '../components/WsStatus.jsx'
import { api, auth, WS_BASE } from '../lib/api.js'

/* =====================================================================
   Main dashboard — a READ-ONLY analytics overview of the whole platform.
   Every number is pulled live from the real backend (applications,
   dashboards, devices, cameras, users) and aggregated client-side. The
   hero is a views-over-time graph (last 7 / 30 days), optionally scoped to
   a single application. There are no actions here on purpose.
   ===================================================================== */

/* ----------------------- Helpers ----------------------- */

// Compact letter notation (1.2K, 3.4M, 1B) for anything ≥ 1000; full
// comma-grouped value for 0–999. Keeps big KPI/view numbers from overflowing.
const compactNf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const nf = (n) => {
  if (n == null) return '—'
  const num = Number(n)
  if (!Number.isFinite(num)) return '—'
  return Math.abs(num) < 1000 ? num.toLocaleString() : compactNf.format(num)
}
const fk = (v) => (v && typeof v === 'object' ? v.id : v)
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

function timeAgo(iso) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

/** Format an ISO date (YYYY-MM-DD) as "Jun 9" without timezone drift. */
function fmtDay(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y) return iso
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Today as a local YYYY-MM-DD string (no UTC drift). */
function todayISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
/** Date portion (YYYY-MM-DD) of an ISO datetime. */
const toDateStr = (iso) => (iso ? String(iso).slice(0, 10) : '')

/** Tiny inline icon set. */
function Ic({ name, size = 18, color = '#F36A1E' }) {
  const sw = 1.7
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' }
  switch (name) {
    case 'app': return (<svg {...p}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" stroke={color} strokeWidth={sw} /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" stroke={color} strokeWidth={sw} /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" stroke={color} strokeWidth={sw} /><rect x="13" y="13" width="7.5" height="7.5" rx="1.6" stroke={color} strokeWidth={sw} /></svg>)
    case 'layers': return (<svg {...p}><path d="M12 3 3 8l9 5 9-5-9-5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" /><path d="M3 13l9 5 9-5M3 16.5l9 5 9-5" stroke={color} strokeWidth={sw} strokeLinejoin="round" /></svg>)
    case 'device': return (<svg {...p}><rect x="3.5" y="5.5" width="17" height="11" rx="2" stroke={color} strokeWidth={sw} /><path d="M9 20h6M12 16.5V20" stroke={color} strokeWidth={sw} strokeLinecap="round" /><circle cx="7" cy="11" r="1.2" fill={color} /><path d="M10.5 11h7" stroke={color} strokeWidth={sw} strokeLinecap="round" /></svg>)
    case 'camera': return (<svg {...p}><rect x="3" y="7" width="14" height="11" rx="2.2" stroke={color} strokeWidth={sw} /><path d="M17 11 L21 8.5 V16.5 L17 14" stroke={color} strokeWidth={sw} strokeLinejoin="round" /></svg>)
    case 'users': return (<svg {...p}><circle cx="9" cy="8" r="3.2" stroke={color} strokeWidth={sw} /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke={color} strokeWidth={sw} strokeLinecap="round" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-2.2-4.4" stroke={color} strokeWidth={sw} strokeLinecap="round" /></svg>)
    case 'eye': return (<svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" /><circle cx="12" cy="12" r="2.6" stroke={color} strokeWidth={sw} /></svg>)
    default: return null
  }
}

/* ----------------------- Views time-series chart ----------------------- */

function ViewsChart({ series }) {
  const W = 820, H = 280
  const PAD = { top: 24, right: 24, bottom: 38, left: 46 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const n = series.length
  const vals = series.map((s) => s.views || 0)
  const total = vals.reduce((a, b) => a + b, 0)
  const rawMax = Math.max(...vals, 0)
  const step = rawMax <= 0 ? 1 : Math.max(1, Math.ceil(rawMax / 4))
  const maxY = step * 4

  const xOf = (i) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yOf = (v) => PAD.top + innerH - (v / maxY) * innerH

  const pts = series.map((s, i) => `${xOf(i).toFixed(1)},${yOf(s.views || 0).toFixed(1)}`)
  const linePath = n ? `M ${pts.join(' L ')}` : ''
  const areaPath = n ? `M ${xOf(0)},${yOf(0)} L ${pts.join(' L ')} L ${xOf(n - 1)},${yOf(0)} Z` : ''

  const yTicks = [0, 1, 2, 3, 4].map((k) => ({ v: k * step, y: yOf(k * step) }))
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 6)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="kiosk-chart-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="views-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F36A1E" stopOpacity="0.30" />
          <stop offset="1" stopColor="#F36A1E" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#F1E6D6" strokeDasharray="3 4" />
          <text x={PAD.left - 10} y={t.y + 3} fontSize="10" fill="#9c9389" textAnchor="end" fontFamily="Manrope, system-ui">{nf(t.v)}</text>
        </g>
      ))}

      {total > 0 && (
        <>
          <path d={areaPath} fill="url(#views-fill)" />
          <path d={linePath} fill="none" stroke="#F36A1E" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          {n <= 16 && series.map((s, i) => (
            <circle key={i} cx={xOf(i)} cy={yOf(s.views || 0)} r="3.2" fill="#fff" stroke="#F36A1E" strokeWidth="2" />
          ))}
        </>
      )}

      {series.map((s, i) => (i % labelEvery === 0 || i === n - 1) ? (
        <text key={'x' + i} x={xOf(i)} y={H - PAD.bottom + 20} fontSize="10" fill="#9c9389" textAnchor="middle" fontFamily="Manrope, system-ui">{fmtDay(s.date)}</text>
      ) : null)}

      {total === 0 && (
        <text x={W / 2} y={PAD.top + innerH / 2} fontSize="13" fill="#9c9389" textAnchor="middle" fontWeight="600" fontFamily="Manrope, system-ui">
          No views recorded in this period.
        </text>
      )}
    </svg>
  )
}

/* ----------------------- Loading skeletons ----------------------- */
// Shimmer block. Defaults to a thin "line"; override w/h/r for other shapes.
const Sk = ({ w = '100%', h = 12, r = 6, circle = false, style }) => (
  <span className={'sk' + (circle ? ' sk-circle' : '')} aria-hidden="true"
    style={{ display: 'block', width: w, height: h, borderRadius: circle ? '50%' : r, ...style }} />
)

function KpiSkeleton() {
  return (
    <div className="dash-kpi is-skeleton" aria-hidden="true">
      <Sk w={34} h={34} r={10} style={{ marginBottom: 8 }} />
      <Sk w="56%" h={22} style={{ marginBottom: 8 }} />
      <Sk w="70%" h={11} style={{ marginBottom: 6 }} />
      <Sk w="86%" h={10} />
    </div>
  )
}

function ChartSkeleton() {
  const bars = [42, 66, 52, 80, 58, 72, 48, 62, 54, 76]
  return (
    <div className="dash-chart-skel" aria-hidden="true">
      {bars.map((h, i) => <span key={i} className="sk" style={{ height: h + '%' }} />)}
    </div>
  )
}

function FleetSkeleton() {
  return (
    <div className="fleet" aria-hidden="true">
      <Sk w={118} h={118} circle />
      <div className="fleet-legend" style={{ flex: 1 }}>
        <Sk w="80%" style={{ marginBottom: 12 }} />
        <Sk w="66%" style={{ marginBottom: 12 }} />
        <Sk w="74%" />
      </div>
    </div>
  )
}

function BarsSkeleton({ rows = 3 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="ovb" key={i}>
          <div className="ovb-top"><Sk w="38%" h={11} /><Sk w="26%" h={11} /></div>
          <div className="ovb-track"><span className="sk" style={{ display: 'block', height: '100%', width: (70 - i * 16) + '%' }} /></div>
        </div>
      ))}
    </div>
  )
}

function LeadSkeleton() {
  return (
    <div className="lead" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="lead-row" key={i}>
          <span className="lead-rank">{i + 1}</span>
          <div className="lead-main">
            <Sk w="58%" style={{ marginBottom: 8 }} />
            <div className="lead-track"><span className="sk" style={{ display: 'block', height: '100%', width: (72 - i * 18) + '%' }} /></div>
          </div>
          <Sk w={34} h={12} />
        </div>
      ))}
    </div>
  )
}

function LogSkeleton({ rows = 6 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="dash-log-row" key={i}>
          <div className="dl-entity">
            <Sk w={8} h={8} circle style={{ marginTop: 5, flexShrink: 0 }} />
            <div className="dl-entity-text" style={{ flex: 1 }}>
              <Sk w="50%" style={{ marginBottom: 5 }} />
              <Sk w="72%" h={10} />
            </div>
          </div>
          <div><Sk w="60%" h={18} r={6} /></div>
          <div><Sk w="55%" h={18} r={999} /></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Sk w={48} h={11} /></div>
        </div>
      ))}
    </div>
  )
}

/* ----------------------- Data load + aggregation ----------------------- */

function useAnalytics() {
  const [state, setState] = useState({ loading: true, error: null, stats: null })

  useEffect(() => {
    let alive = true
    ;(async () => {
      setState((s) => ({ ...s, loading: true, error: null }))
      const [appsR, devsR, camsR, dashR, linksR, usersR] = await Promise.allSettled([
        api.listApplications(),
        api.listDevices(),
        api.listCameras(),
        api.listDashboards(),
        api.listAppCameras(),
        api.listUsers({ page: 1, pageSize: 1 }),
      ])
      if (!alive) return

      const val = (r, key) => (r.status === 'fulfilled' ? (r.value?.[key] || []) : [])
      const cnt = (r, arr) => (r.status === 'fulfilled' ? (r.value?.count ?? arr.length) : null)

      const appsRaw = val(appsR, 'applications')
      const devices = val(devsR, 'devices')
      const cameras = val(camsR, 'cameras')
      const dashboards = val(dashR, 'dashboards')
      const links = val(linksR, 'links')

      const devBy = {}, connBy = {}, camBy = {}, dashBy = {}, dashDateBy = {}
      for (const d of devices) { const a = fk(d.application); devBy[a] = (devBy[a] || 0) + 1; if (d.is_connected) connBy[a] = (connBy[a] || 0) + 1 }
      for (const l of links) { const a = fk(l.application); camBy[a] = (camBy[a] || 0) + 1 }
      for (const dh of dashboards) {
        const a = fk(dh.application)
        dashBy[a] = (dashBy[a] || 0) + 1
        const ds = dh.created_at ? String(dh.created_at).slice(0, 10) : null
        if (ds && (!dashDateBy[a] || ds < dashDateBy[a])) dashDateBy[a] = ds   // earliest dashboard date per app
      }

      const apps = appsRaw.map((a) => ({
        id: a.id,
        name: a.name,
        publish: !!a.publish,
        is_active: !!a.is_active,
        created_at: a.created_at,
        views: a.public_views || 0,
        devices: devBy[a.id] || 0,
        connected: connBy[a.id] || 0,
        cameras: camBy[a.id] || 0,
        dashboards: dashBy[a.id] || 0,
      }))

      const totals = {
        apps: cnt(appsR, appsRaw) ?? apps.length,
        appsPublished: apps.filter((a) => a.publish).length,
        appsActive: apps.filter((a) => a.is_active).length,
        dashboards: cnt(dashR, dashboards),
        dashboardsPublished: dashboards.filter((d) => d.publish).length,
        devices: cnt(devsR, devices),
        devicesConnected: devices.filter((d) => d.is_connected).length,
        cameras: cnt(camsR, cameras),
        camerasActive: cameras.filter((c) => c.is_active).length,
        viewers: cameras.reduce((s, c) => s + (c.viewers || 0), 0),
        users: usersR.status === 'fulfilled' ? (usersR.value?.count ?? null) : null,
        views: apps.reduce((s, a) => s + a.views, 0),
      }

      const anyOk = [appsR, devsR, camsR, dashR].some((r) => r.status === 'fulfilled')
      setState({
        loading: false,
        error: anyOk ? null : 'Could not load analytics. Check your connection or permissions.',
        stats: { apps, totals, dashDatesByApp: dashDateBy },
      })
    })()
    return () => { alive = false }
  }, [])

  return state
}

/* ----------------------- Page ----------------------- */

const RANGES = [{ days: 7, label: '7D' }, { days: 15, label: '15D' }, { days: 30, label: '30D' }]
const ACTION_STATE = { create: 'ok', update: 'idle', delete: 'err' }
const ACTION_LABEL = { create: 'Created', update: 'Updated', delete: 'Deleted' }

export default function Dashboard() {
  const navigate = useNavigate()
  const user = auth.getUser()
  if (!user) { navigate('/signin', { replace: true }); return null }

  const { loading, error, stats } = useAnalytics()
  const t = stats?.totals

  // Views graph state — range (7|15|30|'custom') + application filter.
  const [range, setRange] = useState(7)
  const [appFilter, setAppFilter] = useState('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [ts, setTs] = useState({ loading: true, series: [], total: 0 })

  const todayStr = useMemo(() => todayISO(), [])

  // The earliest selectable date for the current scope:
  //   • All applications → the first application's creation date.
  //   • A single application → that application's dashboard creation date
  //     (falling back to the application's own creation date).
  const minDate = useMemo(() => {
    if (!stats) return ''
    if (appFilter === 'all') {
      // Lowest dashboard creation date across every application (same basis
      // as the individual case). Fall back to the earliest application date.
      const dd = Object.values(stats.dashDatesByApp || {}).filter(Boolean).sort()
      if (dd.length) return dd[0]
      const dates = stats.apps.map((a) => toDateStr(a.created_at)).filter(Boolean).sort()
      return dates[0] || ''
    }
    const dash = stats.dashDatesByApp?.[appFilter]
    if (dash) return dash
    const app = stats.apps.find((a) => String(a.id) === String(appFilter))
    return app ? toDateStr(app.created_at) : ''
  }, [stats, appFilter])

  // Default the custom range to [minDate → today] whenever the scope changes
  // (or data first loads). User edits afterwards are preserved.
  useEffect(() => {
    if (!stats) return
    setCustomStart(minDate || '')
    setCustomEnd(todayStr)
  }, [appFilter, minDate, stats, todayStr])

  const customInvalid = range === 'custom' && (!customStart || !customEnd || customEnd < customStart)

  useEffect(() => {
    let alive = true
    if (range === 'custom') {
      if (customInvalid) { setTs({ loading: false, series: [], total: 0 }); return undefined }
      setTs((s) => ({ ...s, loading: true }))
      api.appViewsTimeseries({ start: customStart, end: customEnd, application: appFilter })
        .then((r) => { if (alive) setTs({ loading: false, series: r?.series || [], total: r?.total || 0 }) })
        .catch(() => { if (alive) setTs({ loading: false, series: [], total: 0 }) })
    } else {
      setTs((s) => ({ ...s, loading: true }))
      api.appViewsTimeseries({ days: range, application: appFilter })
        .then((r) => { if (alive) setTs({ loading: false, series: r?.series || [], total: r?.total || 0 }) })
        .catch(() => { if (alive) setTs({ loading: false, series: [], total: 0 }) })
    }
    return () => { alive = false }
  }, [range, appFilter, customStart, customEnd, customInvalid])

  // Internal activity log — last 6, categorised (drives Recent activity).
  // Initial load over REST (fast + reliable); live updates over WebSocket.
  const [logs, setLogs] = useState({ loading: true, items: [] })
  useEffect(() => {
    let alive = true
    api.listActivityLogs({ limit: 6 })
      .then((r) => { if (alive) setLogs((s) => (s.items.length ? s : { loading: false, items: r?.logs || [] })) })
      .catch(() => { if (alive) setLogs((s) => (s.items.length ? s : { loading: false, items: [] })) })
    return () => { alive = false }
  }, [])

  // Live activity feed over WebSocket — snapshot on connect + push per new entry.
  // Auto-reconnects forever with exponential backoff (no manual reconnect).
  const [wsStatus, setWsStatus] = useState('connecting') // connecting | reconnecting | live | offline
  useEffect(() => {
    const token = auth.getAccess()
    if (!token) { setWsStatus('offline'); return undefined }
    const url = `${WS_BASE}/activity-logs/?token=${encodeURIComponent(token)}`
    let cancelled = false, ws = null, attempt = 0, timer = null
    // Fast recovery: ~250ms first retry, backing off to a 4s cap.
    const schedule = () => { attempt += 1; timer = setTimeout(connect, Math.min(4000, 250 * Math.pow(2, attempt - 1))) }
    function connect() {
      if (cancelled) return
      setWsStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      try { ws = new WebSocket(url) } catch { setWsStatus('offline'); schedule(); return }
      ws.onopen = () => { attempt = 0; setWsStatus('live') }
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data) } catch { return }
        if (msg?.type === 'snapshot' && Array.isArray(msg.logs)) {
          setLogs({ loading: false, items: msg.logs.slice(0, 6) })
        } else if (msg?.type === 'log' && msg.log) {
          setLogs((s) => ({ loading: false, items: [msg.log, ...s.items.filter((x) => x.id !== msg.log.id)].slice(0, 6) }))
        }
      }
      ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
      ws.onclose = () => { setWsStatus('reconnecting'); if (!cancelled) schedule() }
    }
    connect()
    return () => { cancelled = true; if (timer) clearTimeout(timer); try { ws && ws.close() } catch { /* noop */ } }
  }, [])

  // Top 3 applications by views.
  const topApps = useMemo(() => {
    if (!stats) return []
    return [...stats.apps].sort((a, b) => (b.views - a.views) || (b.devices - a.devices)).slice(0, 3)
  }, [stats])
  const topMax = Math.max(1, ...topApps.map((a) => a.views))

  const fleetPct = t ? pct(t.devicesConnected, t.devices || 0) : 0
  const appName = appFilter === 'all' ? 'all applications' : (stats?.apps.find((a) => String(a.id) === String(appFilter))?.name || 'application')

  const KPIS = t ? [
    { icon: 'app',    num: t.apps,       label: 'Applications', sub: `${t.appsPublished} published · ${t.appsActive} active` },
    { icon: 'layers', num: t.dashboards, label: 'Dashboards',   sub: `${t.dashboardsPublished} published` },
    { icon: 'device', num: t.devices,    label: 'Devices',      sub: `${t.devicesConnected} connected` },
    { icon: 'camera', num: t.cameras,    label: 'Cameras',      sub: `${t.camerasActive} active · ${nf(t.viewers)} viewers` },
    { icon: 'users',  num: t.users,      label: 'Users',        sub: 'team members' },
    { icon: 'eye',    num: t.views,      label: 'Total views',  sub: 'public dashboard opens' },
  ] : []

  return (
    <div className="kiosk-app">
      <TopBar />

      <div className="kiosk-body dash-ro">
        {/* ===== Page heading (full width) ===== */}
        <div className="dash-ro-head">
          <div>
            <h1>Platform Overview</h1>
            <p className="lede">Live analytics across every application, dashboard, device and camera.</p>
          </div>
        </div>

        {error && <div className="admin-banner error">{error}</div>}

        {/* ===== KPIs + hero (left) · system overview (right) — bottoms aligned ===== */}
        <div className="dash-top-grid">
          <div className="dash-top-left">

          {/* ===== KPI grid ===== */}
          <section className="dash-kpis">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
              : KPIS.map((k, i) => (
                <div className="dash-kpi" key={i}>
                  <span className="kpi-ic"><Ic name={k.icon} size={18} /></span>
                  <div className="kpi-num">{nf(k.num)}</div>
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-sub">{k.sub}</div>
                </div>
              ))}
          </section>

          {/* ===== Hero — views over time ===== */}
          <div className="hero-card">
            <div className="hero-head dash-views-head">
              <div className="hero-id">
                <span className="hero-token"><Ic name="eye" size={20} /></span>
                <span className="hero-pair">VIEWS <span className="muted">/ over time</span></span>
              </div>
              <div className="hero-stats">
                <span className="hero-value">{nf(ts.total)} <span className="muted">views{range !== 'custom' ? ` · ${range}d` : ''}</span></span>
              </div>
              <div className="dash-views-controls">
                <select
                  className="dash-app-select"
                  value={appFilter}
                  onChange={(e) => setAppFilter(e.target.value)}
                  aria-label="Filter views by application"
                >
                  <option value="all">All applications</option>
                  {stats?.apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <div className="tf-pill" role="tablist" aria-label="Range">
                  {RANGES.map((r) => (
                    <button key={r.days} type="button" role="tab" aria-selected={range === r.days}
                      className={'tf-opt' + (range === r.days ? ' is-active' : '')}
                      onClick={() => setRange(r.days)}>{r.label}</button>
                  ))}
                  <button type="button" role="tab" aria-selected={range === 'custom'}
                    className={'tf-opt' + (range === 'custom' ? ' is-active' : '')}
                    onClick={() => setRange('custom')}>Custom</button>
                </div>
              </div>
            </div>

            {range === 'custom' && (
              <div className="dash-views-daterow">
                <label>From
                  <input type="date" value={customStart} min={minDate || undefined} max={customEnd || todayStr}
                    onChange={(e) => setCustomStart(e.target.value)} />
                </label>
                <label>To
                  <input type="date" value={customEnd} min={customStart || minDate || undefined} max={todayStr}
                    onChange={(e) => setCustomEnd(e.target.value)} />
                </label>
                {customInvalid && <span className="dash-date-err">End date must be on or after the start date.</span>}
                {minDate && <span className="dash-date-hint">Data available from {fmtDay(minDate)}</span>}
              </div>
            )}

            <div className="chart-wrap dash-views-chart">
              {ts.loading
                ? <ChartSkeleton />
                : customInvalid
                  ? <div className="dash-ph">Pick a valid start and end date.</div>
                  : <ViewsChart series={ts.series} />}
            </div>
            <p className="dash-views-cap">
              Daily public dashboard opens for {appName}, {range === 'custom'
                ? `${customStart ? fmtDay(customStart) : '—'} → ${customEnd ? fmtDay(customEnd) : '—'}`
                : `last ${range} days`}.
            </p>
          </div>
          </div>

          {/* ===== Right column — system overview (bottom aligns with hero) ===== */}
          <aside className="kiosk-side dash-side">
            {/* Fleet health ring */}
            <div className="ov-block">
              <div className="ov-h">Fleet health</div>
              {loading ? <FleetSkeleton /> : (
                <div className="fleet">
                  <div className="fleet-ring" style={{ background: `conic-gradient(var(--accent, #F36A1E) ${fleetPct * 3.6}deg, #F1E6D6 0)` }}>
                    <div className="fleet-hole"><span className="fleet-pct">{fleetPct}%</span><span className="fleet-cap">online</span></div>
                  </div>
                  <div className="fleet-legend">
                    <div className="fl-row"><span className="fl-dot fl-ok" /> Connected <b>{nf(t?.devicesConnected)}</b></div>
                    <div className="fl-row"><span className="fl-dot fl-off" /> Offline <b>{nf(t ? (t.devices || 0) - t.devicesConnected : null)}</b></div>
                    <div className="fl-row fl-total"><span className="fl-dot fl-tot" /> Total devices <b>{nf(t?.devices)}</b></div>
                  </div>
                </div>
              )}
            </div>

            {/* Distribution bars */}
            <div className="ov-block">
              <div className="ov-h">Distribution</div>
              {loading ? <BarsSkeleton rows={3} /> : t && [
                { label: 'Applications', filled: t.appsPublished, total: t.apps, cap: 'published' },
                { label: 'Dashboards', filled: t.dashboardsPublished, total: t.dashboards || 0, cap: 'published' },
                { label: 'Cameras', filled: t.camerasActive, total: t.cameras || 0, cap: 'active' },
              ].map((b) => (
                <div className="ovb" key={b.label}>
                  <div className="ovb-top"><span>{b.label}</span><span className="ovb-val">{nf(b.filled)}<span className="muted">/{nf(b.total)} {b.cap}</span></span></div>
                  <div className="ovb-track"><div className="ovb-fill" style={{ width: pct(b.filled, b.total) + '%' }} /></div>
                </div>
              ))}
            </div>

            {/* Top applications — always 3 ranked rows (placeholders for empty slots) */}
            <div className="ov-block">
              <div className="ov-h">Top applications <span className="ov-h-sub">by views</span></div>
              {loading ? (
                <LeadSkeleton />
              ) : (
                <div className="lead">
                  {[0, 1, 2].map((i) => {
                    const a = topApps[i]
                    return (
                      <div className={'lead-row' + (a ? '' : ' is-empty')} key={i}>
                        <span className="lead-rank">{i + 1}</span>
                        <div className="lead-main">
                          <div className="lead-name" title={a ? a.name : ''}>{a ? a.name : '—'}</div>
                          <div className="lead-track"><div className="lead-fill" style={{ width: a ? Math.max(3, (a.views / topMax) * 100) + '%' : '0%' }} /></div>
                        </div>
                        <div className="lead-val">{a ? nf(a.views) : '—'}<span className="muted"> views</span></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* ===== Recent activity (full width) ===== */}
        <div className="log-card dash-log">
          <div className="dash-log-head">
            <div className="log-title">
              Recent activity
              <WsStatus status={wsStatus} />
            </div>
          </div>
          <div className="dash-log-cols">
            <span>Entity</span><span>Category</span><span>Action</span><span className="ta-right">When</span>
          </div>
          <div className="dash-log-rows">
            {logs.loading ? (
              <LogSkeleton rows={6} />
            ) : !logs.items.length ? (
              <div className="dash-ph">No activity recorded yet. Create or edit something and it shows here.</div>
            ) : (
              logs.items.map((r) => {
                const st = ACTION_STATE[r.action] || 'idle'
                return (
                  <div className="dash-log-row" key={r.id} title={r.message}>
                    <div className="dl-entity">
                      <span className={'dl-dot dl-' + st} />
                      <div className="dl-entity-text">
                        <span className="dl-name">{r.entity_name || '—'}</span>
                        {r.message && <span className="dl-detail">{r.message}</span>}
                      </div>
                    </div>
                    <div><span className={'dl-type dl-type-' + r.category}>{r.category}</span></div>
                    <div><span className={'dl-state dl-state-' + st}>{ACTION_LABEL[r.action] || r.action}</span></div>
                    <div className="dl-time ta-right">{timeAgo(r.created_at)}</div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
