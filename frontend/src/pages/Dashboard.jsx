import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { auth } from '../lib/api.js'

/* ----------------------- Mock data (UI shell, KIOSK domain) ----------------------- */
// Once the dashboard is wired to real endpoints these constants get replaced by
// fetches against /api/applications, /cameraapi/, etc. Names + counts here are
// shaped to match the real backend models (Application, Camera, Device, User).

const TRENDING = [
  { id: 'app-lobby',  name: 'ATM Lobby',       state: 'v2.4.1',  metric: '243 sessions', delta: 'Active',    icon: 'app'    },
  { id: 'app-mall',   name: 'Mall Kiosk',      state: 'v2.3.7',  metric: '982 sessions', delta: 'Deploying', icon: 'app'    },
  { id: 'cam-front',  name: 'Front Cam #14',   state: '4K',      metric: '12 viewers',   delta: 'Live',      icon: 'camera' },
  { id: 'dev-rtu',    name: 'Drive-Thru RTU',  state: 'Online',  metric: 'fw 8.2.0',     delta: '+1d',       icon: 'device' },
]

// 24h smoothed sessions series (relative units, 1400–1900 = active sessions).
const ACTIVITY = [
  18, 14, 12, 11, 13, 18, 26, 38, 52, 71, 86, 82,
  68, 58, 49, 47, 53, 64, 78, 72, 60, 48, 33, 24,
]

const ACTIVITY_LOG = [
  { entity: 'ATM Lobby',      type: 'Application', action: 'Deployed v2.4.1',    actor: 'CI · pipeline #482', value: '243 sessions', time: '4d 19h ago',  state: 'ok'    },
  { entity: 'Front Cam #14',  type: 'Camera',      action: 'Person detected',    actor: 'AI · confidence 0.83', value: '12 viewers',   time: '10d 9h ago',  state: 'warn'  },
  { entity: 'Mall Kiosk',     type: 'Application', action: 'Service restarted',  actor: 'Manual · Sai',         value: '982 sessions', time: '12d 8h ago',  state: 'ok'    },
  { entity: 'Drive-Thru RTU', type: 'Device',      action: 'Firmware updated',   actor: 'Schedule · 02:00',     value: 'fw 8.2.0',     time: '12d 8h ago',  state: 'ok'    },
  { entity: 'Site B Gateway', type: 'Device',      action: 'Heartbeat missed',   actor: 'Monitor · 60s',        value: 'offline 4m',   time: '12d 8h ago',  state: 'err'   },
]

const TIMEFRAMES = ['1H', '4H', '1D', '1W', '1M', '6M']

/* ----------------------- Helpers ----------------------- */

/** Tiny inline icon set so each tile/row is self-contained. */
function MiniIcon({ name, size = 18 }) {
  const s = size
  const stroke = '#F36A1E'
  const sw = 1.7
  switch (name) {
    case 'lock':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" stroke={stroke} strokeWidth={sw} />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <circle cx="12" cy="15.4" r="1.4" fill={stroke} />
        </svg>
      )
    case 'camera':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="7" width="14" height="11" rx="2.2" stroke={stroke} strokeWidth={sw} />
          <path d="M17 11 L21 8.5 V16.5 L17 14" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      )
    case 'leaf':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 19 Q5 8 19 5 Q18 17 7 19 Z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M5 19 L13 11" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      )
    case 'bulb':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M9 17h6M10 20h4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <path d="M7 11a5 5 0 1 1 9 3l-1 2H9l-1-2A5 5 0 0 1 7 11Z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      )
    case 'rocket':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 19 L8 16 M19 5l-9 9 1.5 4-7-1.5L13 4z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )
    case 'app':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" stroke={stroke} strokeWidth={sw} />
          <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" stroke={stroke} strokeWidth={sw} />
          <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" stroke={stroke} strokeWidth={sw} />
          <rect x="13" y="13" width="7.5" height="7.5" rx="1.6" stroke={stroke} strokeWidth={sw} />
        </svg>
      )
    case 'device':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="5.5" width="17" height="11" rx="2" stroke={stroke} strokeWidth={sw} />
          <path d="M9 20h6M12 16.5V20" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <circle cx="7" cy="11" r="1.2" fill={stroke} />
          <path d="M10.5 11h7" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      )
    case 'search':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="6.5" stroke="#6b6258" strokeWidth={sw} />
          <path d="m16 16 4 4" stroke="#6b6258" strokeWidth={sw} strokeLinecap="round" />
        </svg>
      )
    case 'swap':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M7 5v14m0 0-3-3m3 3 3-3M17 19V5m0 0-3 3m3-3 3 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'refresh':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 12a8 8 0 0 1 14.5-4.7M20 12a8 8 0 0 1-14.5 4.7M18 4v4h-4M6 20v-4h4" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'info':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="#9c9389" strokeWidth="1.5" />
          <path d="M12 11v5M12 8v.5" stroke="#9c9389" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'chevron':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="m6 9 6 6 6-6" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'arrow':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return null
  }
}

/* ----------------------- Activity Chart ----------------------- */

function ActivityChart({ data, peakIndex }) {
  // Viewport
  const W = 760
  const H = 280
  const PADDING = { top: 30, right: 20, bottom: 40, left: 56 }
  const innerW = W - PADDING.left - PADDING.right
  const innerH = H - PADDING.top - PADDING.bottom

  // Scale
  const maxY = Math.max(...data) * 1.1
  const minY = 0
  const stepX = innerW / (data.length - 1)
  const xOf = (i) => PADDING.left + i * stepX
  const yOf = (v) => PADDING.top + innerH - ((v - minY) / (maxY - minY)) * innerH

  // Build smoothed-ish path using straight segments (clean & readable like the ref)
  const pts = data.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
  const linePath = `M ${pts.join(' L ')}`
  const areaPath =
    `M ${xOf(0)},${yOf(0)} ` +
    `L ${pts.join(' L ')} ` +
    `L ${xOf(data.length - 1)},${yOf(0)} Z`

  // Y-axis tick labels
  const yTicks = [1400, 1500, 1600, 1700, 1800, 1900].map((v, i, arr) => {
    const t = (arr.length - 1 - i) / (arr.length - 1)
    return { label: v.toFixed(2), y: PADDING.top + t * innerH }
  })

  // X-axis labels (synthesized clock times)
  const xLabels = ['5:58 PM', '10:00 PM', '2:23 AM', '6:35 AM', '10:47 AM', '3:00 PM']
  const xLabelXs = xLabels.map((_, i) => xOf((data.length - 1) * (i / (xLabels.length - 1))))

  // Peak tooltip — peak concurrent sessions across all applications
  const px = xOf(peakIndex)
  const py = yOf(data[peakIndex])
  const peakValue = String(Math.round(1400 + (data[peakIndex] / 100) * 500))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="kiosk-chart-svg" aria-hidden="true">
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F36A1E" stopOpacity="0.32" />
          <stop offset="1" stopColor="#F36A1E" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Y-axis ticks */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PADDING.left} x2={W - PADDING.right} y1={t.y} y2={t.y} stroke="#F1E6D6" strokeDasharray="3 4" />
          <text x={PADDING.left - 10} y={t.y + 3} fontSize="10" fill="#9c9389" textAnchor="end" fontFamily="Manrope, system-ui">
            {t.label}
          </text>
        </g>
      ))}

      {/* Area + line */}
      <path d={areaPath} fill="url(#area-fill)" />
      <path d={linePath} fill="none" stroke="#F36A1E" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

      {/* Peak tooltip */}
      <line x1={px} x2={px} y1={py} y2={H - PADDING.bottom} stroke="#F36A1E" strokeDasharray="3 4" strokeWidth="1" opacity="0.7" />
      <g transform={`translate(${px} ${py - 30})`}>
        <rect x="-30" y="-14" width="60" height="22" rx="11" fill="#F36A1E" />
        <text x="0" y="0.5" textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Manrope, system-ui">
          {peakValue}
        </text>
      </g>
      <circle cx={px} cy={py} r="4.5" fill="#fff" stroke="#F36A1E" strokeWidth="2" />

      {/* X-axis labels */}
      {xLabels.map((lab, i) => (
        <text key={lab} x={xLabelXs[i]} y={H - PADDING.bottom + 22} fontSize="10" fill="#9c9389" textAnchor="middle" fontFamily="Manrope, system-ui">
          {lab}
        </text>
      ))}

      {/* Y-axis unit marker — sessions across applications */}
      <text x={PADDING.left - 32} y={PADDING.top + innerH / 2} fontSize="13" fontWeight="700" fill="#F36A1E" fontFamily="Manrope, system-ui">sess.</text>
    </svg>
  )
}

/* ----------------------- Page ----------------------- */

export default function Dashboard() {
  const navigate = useNavigate()
  const user = auth.getUser()

  const [tf, setTf] = useState('1D')
  const [scope, setScope] = useState('Applications') // Applications | Cameras

  if (!user) {
    navigate('/signin', { replace: true })
    return null
  }

  const headlineMetric = useMemo(() => {
    const last = ACTIVITY[ACTIVITY.length - 1]
    const prev = ACTIVITY[0]
    const pct = ((last - prev) / prev) * 100
    return { value: '1,859', delta: '+61', pct: pct.toFixed(2) }
  }, [])

  const peakIndex = ACTIVITY.indexOf(Math.max(...ACTIVITY))

  return (
    <div className="kiosk-app">
      {/* ========== TOP BAR ========== */}
      <TopBar />

      {/* ========== BODY GRID ========== */}
      <div className="kiosk-body">

        {/* ============== LEFT COLUMN ============== */}
        <main className="kiosk-main">

          {/* Trending row */}
          <div className="trending-row">
            <div className="trending-head">
              <span className="trending-title">Trending now</span>
              <MiniIcon name="rocket" size={18} />
            </div>
            {TRENDING.map((d) => (
              <div className="trend-card" key={d.id}>
                <div className="trend-ic"><MiniIcon name={d.icon} size={20} /></div>
                <div className="trend-info">
                  <div className="trend-name">{d.name}</div>
                  <div className="trend-meta">
                    <span className="trend-state">{d.state}</span>
                    <span className="trend-delta">{d.delta}</span>
                    <span className="trend-info-ic"><MiniIcon name="info" size={12} /></span>
                  </div>
                </div>
                <button type="button" className="trend-cart" aria-label="Open device" title="Open device">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14m-5-5 5 5-5 5" stroke="#14161C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
            <a href="#" className="trending-more">
              View more <MiniIcon name="arrow" size={14} />
            </a>
          </div>

          {/* ===== Hero metric + Chart ===== */}
          <div className="hero-card">
            <div className="hero-head">
              <div className="hero-id">
                <span className="hero-token">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="#FFE9D5" stroke="#F36A1E" strokeWidth="1.6" />
                    <path d="M8 13l3 3 5-7" stroke="#F36A1E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="hero-pair">APPLICATIONS <span className="muted">/ sessions</span></span>
              </div>
              <div className="hero-stats">
                <span className="hero-value">{headlineMetric.value} <span className="muted">sessions</span></span>
                <span className="hero-delta">{headlineMetric.delta} ({headlineMetric.pct}%)</span>
              </div>
              <div className="tf-pill" role="tablist" aria-label="Timeframe">
                {TIMEFRAMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tf === t}
                    className={'tf-opt' + (tf === t ? ' is-active' : '')}
                    onClick={() => setTf(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-wrap">
              <ActivityChart data={ACTIVITY} peakIndex={peakIndex} />
            </div>
          </div>

          {/* ===== Activity Log ===== */}
          <div className="log-card">
            <div className="log-head">
              <div className="log-title">Activity History</div>
              <div className="log-cols">
                <span>Entity <MiniIcon name="chevron" size={12} /></span>
                <span>Trigger <MiniIcon name="chevron" size={12} /></span>
                <span>Type <MiniIcon name="chevron" size={12} /></span>
                <span>Action <MiniIcon name="chevron" size={12} /></span>
                <span>Value <MiniIcon name="chevron" size={12} /></span>
                <span>Time <MiniIcon name="chevron" size={12} /></span>
              </div>
            </div>
            <div className="log-rows">
              {ACTIVITY_LOG.map((r, i) => (
                <div className="log-row" key={i}>
                  <div className="log-device">
                    <span className="log-dot" aria-hidden="true" />
                    <span>{r.entity}</span>
                  </div>
                  <div className="log-actor">{r.actor}</div>
                  <div className="log-type"><span className={'type-chip type-' + r.type.toLowerCase()}>{r.type}</span></div>
                  <div className="log-action">{r.action}</div>
                  <div className={'log-power state-' + r.state}>{r.value}</div>
                  <div className="log-time">{r.time}</div>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* ============== RIGHT COLUMN (Control panel) ============== */}
        <aside className="kiosk-side">
          <div className="side-head">
            <div className="side-title">Quick Control</div>
            <div className="side-toggle" role="tablist" aria-label="Quick control scope">
              {['Applications', 'Cameras'].map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={scope === s}
                  className={'side-toggle-opt' + (scope === s ? ' is-active' : '')}
                  onClick={() => setScope(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <p className="side-lede">Deploy, restart or stream any kiosk asset instantly.</p>

          <div className="side-search">
            <MiniIcon name="search" size={16} />
            <input type="text" placeholder={'Search ' + scope.toLowerCase()} aria-label={'Search ' + scope.toLowerCase()} />
          </div>

          <div className="side-rate">
            <span className="rate-pill">1 APP ≈ 240 sessions / day</span>
            <button type="button" className="rate-refresh" aria-label="Refresh">
              <MiniIcon name="refresh" size={14} />
            </button>
          </div>

          {/* Featured Application */}
          <div className="side-row">
            <div className="side-row-left">
              <span className="side-row-ic"><MiniIcon name="app" size={18} /></span>
              <div>
                <div className="side-row-name">ATM Lobby</div>
                <div className="side-row-sub">v2.4.1 · Active</div>
              </div>
            </div>
            <div className="side-row-right">
              <div className="side-row-val">243<span className="muted"> sess</span></div>
              <div className="side-row-sub">uptime 12d 04h</div>
            </div>
          </div>

          <button type="button" className="side-swap-btn" aria-label="Switch focus">
            <MiniIcon name="swap" size={16} />
          </button>

          {/* Featured Camera */}
          <div className="side-row">
            <div className="side-row-left">
              <span className="side-row-ic"><MiniIcon name="camera" size={18} /></span>
              <div>
                <div className="side-row-name">Front Cam #14</div>
                <div className="side-row-sub">4K · 30fps · Recording</div>
              </div>
            </div>
            <div className="side-row-right">
              <div className="side-row-val">12<span className="muted"> viewers</span></div>
              <div className="side-row-sub">stream 1.8 Mbps</div>
            </div>
          </div>

          {/* Filter chips */}
          <div className="side-chips">
            <button type="button" className="chip is-muted">All regions <MiniIcon name="chevron" size={12} /></button>
            <button type="button" className="chip is-muted">Status <MiniIcon name="chevron" size={12} /></button>
          </div>

          <div className="side-mini-meta">
            <span>Health score <MiniIcon name="info" size={12} /></span>
            <button type="button" className="mini-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="8" width="3" height="12" rx="1" fill="#F36A1E" />
                <rect x="10" y="4" width="3" height="16" rx="1" fill="#F36A1E" />
                <rect x="16" y="11" width="3" height="9" rx="1" fill="#F36A1E" />
              </svg>
              Top events
            </button>
          </div>

          <div className="side-mode-pill">
            <span className="mode-ic" aria-hidden="true">✓</span>
            Auto-deploy enabled
          </div>

          <div className="side-info-card">
            <div className="info-title">More information</div>
            <div className="info-row"><span>Average session</span><MiniIcon name="info" size={12} /></div>
            <div className="info-row"><span>Failed deploys</span><MiniIcon name="info" size={12} /></div>
            <div className="info-row"><span>Camera drop-offs</span><MiniIcon name="info" size={12} /></div>
          </div>

          <button type="button" className="side-cta">Register Application</button>
        </aside>
      </div>

      <footer className="kiosk-foot">© 2026 myaccess Inc. · KIOSK IoT Platform</footer>
    </div>
  )
}
