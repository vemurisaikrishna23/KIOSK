import { useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * Public marketing landing for the Smart Kiosk Control Dashboard.
 *
 * Content sourced from the product brief — STRICTLY filtered to the
 * sections that apply to a public visitor:
 *   • Public Kiosk Portal (no-login access, touch UI, live status)
 *   • End-user benefits
 *   • Public-facing use cases (kiosks, info displays, public services)
 *   • Sectors served
 *
 * Admin-only material (application management, device management,
 * dashboard designer, user/role management, activity logs, internal
 * tech stack, role-based admin controls) is intentionally excluded.
 */
export default function PublicLanding() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const els = document.querySelectorAll('.pf-reveal')
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="pf-page">
      {/* ─────────── NAV ─────────── */}
      <header className="pf-nav">
        <Link to="/" className="pf-brand" aria-label="Smart Kiosk Control Dashboard">
          <KioskMark />
          <span className="pf-brand-name">Smart Kiosk</span>
        </Link>
        <nav className="pf-nav-links">
          <a href="#about">About</a>
          <a href="#portal">Public Portal</a>
          <a href="#benefits">Benefits</a>
          <a href="#usecases">Use cases</a>
        </nav>
        <div className="pf-nav-actions">
          <Link to="/public" className="pf-nav-cta">
            Open Demos
          </Link>
        </div>
      </header>

      {/* ─────────── HERO ─────────── */}
      <section className="pf-hero-wrap">
        <div className="pf-hero">
          {/* Animated decorative layer */}
          <div className="pf-hero-fx" aria-hidden="true">
            <div className="pf-orb pf-orb-1" />
            <div className="pf-orb pf-orb-2" />
            <div className="pf-orb pf-orb-3" />
            <div className="pf-dots" />
            <svg className="pf-hero-wave" viewBox="0 0 400 80" preserveAspectRatio="none">
              <path d="M0 60 Q 100 20, 200 60 T 400 60 L 400 80 L 0 80 Z" fill="rgba(255, 255, 255, 0.18)" />
            </svg>
          </div>

          <div className="pf-hero-text">
            <div className="pf-hero-eyebrow">
              <span className="pf-pill pf-pill-anim">
                <span className="pf-pill-dot" />ENTERPRISE PLATFORM
              </span>
              <span className="pf-pill pf-pill-outline">BY MYACCESS PRIVATE LIMITED</span>
            </div>
            <h1 className="pf-h1-anim">
              <span className="pf-line-1">Smart Kiosk</span>
              <span className="pf-line-2">Control <span className="pf-hero-mark">Dashboard</span> <Sparkle /></span>
            </h1>
            <p>
              Open any published kiosk application instantly — no sign-in, no setup. The public side of an enterprise platform that manages smart kiosk systems from a centralized interface.
            </p>
            <div className="pf-hero-actions">
              <Link to="/public" className="pf-cta-dark pf-cta-shimmer">
                <ArrowSvg /> Open Live Demos
              </Link>
              <a href="#about" className="pf-cta-link">Find Out More ↓</a>
            </div>
          </div>

          <HeroDashboardPreview />
        </div>
      </section>

      {/* ─────────── ABOUT ─────────── */}
      <section id="about" className="pf-section pf-reveal">
        <h2 className="pf-h2">What is Smart Kiosk<br />Control Dashboard?</h2>

        <div className="pf-about-grid">
          <div className="pf-about-copy">
            <p>
              <strong>Smart Kiosk Control Dashboard</strong> is a web-based enterprise platform developed to manage, monitor, and control smart kiosk systems from one centralized interface.
            </p>
            <p>
              The public side lets end users open published kiosk applications — interact with services, view live data, and access information without any login.
            </p>
          </div>

          <aside className="pf-about-callout">
            <h3>Public side capabilities</h3>
            <ul>
              <li>No-login public kiosk portal</li>
              <li>Live service availability</li>
              <li>Touch-friendly interactions</li>
              <li>Real-time data on display</li>
              <li>Live camera viewing where assigned</li>
              <li>Clean, interactive experience</li>
            </ul>
          </aside>
        </div>
      </section>

      {/* ─────────── PUBLIC KIOSK PORTAL ─────────── */}
      <section id="portal" className="pf-section pf-portal pf-reveal">
        <div className="pf-section-head">
          <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Public Kiosk Portal</span>
          <h2 className="pf-h2-center">Open it. Tap it. Done.</h2>
          <p>The public portal lets anyone access published applications, instantly.</p>
        </div>

        <div className="pf-portal-grid">
          {PORTAL_FEATURES.map((f) => (
            <article key={f.title} className="pf-portal-card">
              <div className="pf-portal-ic">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─────────── BLACK BANNER ─────────── */}
      <section className="pf-section pf-reveal">
        <div className="pf-banner">
          {/* Animated decorative grid + floating dots */}
          <div className="pf-banner-fx" aria-hidden="true">
            <div className="pf-banner-grid" />
            <div className="pf-banner-orb pf-banner-orb-a" />
            <div className="pf-banner-orb pf-banner-orb-b" />
          </div>
          <svg className="pf-banner-squiggle" viewBox="0 0 200 60" fill="none" aria-hidden="true">
            <path d="M5 40 Q 30 8, 60 30 T 130 18 T 195 30"
              stroke="#FBC890" strokeWidth="1.8" strokeLinecap="round" fill="none">
              <animate attributeName="stroke-dasharray" values="0,500;500,0" dur="3s" repeatCount="indefinite" />
            </path>
          </svg>
          <div className="pf-banner-text">
            <h3>Open a published kiosk live.</h3>
            <p>Browse every application published in the public area — no sign-in, fully interactive.</p>
            <Link to="/public" className="pf-cta-white">
              <ArrowSvg dark /> Open Live Demos
            </Link>
          </div>
          <div className="pf-banner-preview" aria-hidden="true">
            <BannerPreview />
          </div>
        </div>
      </section>

      {/* ─────────── END-USER BENEFITS ─────────── */}
      <section id="benefits" className="pf-section pf-reveal">
        <div className="pf-section-head">
          <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />End-user benefits</span>
          <h2 className="pf-h2-center">What you get as a visitor</h2>
        </div>

        <div className="pf-benefit-grid">
          {BENEFITS.map((b) => (
            <article key={b.title} className="pf-benefit-card">
              <span className="pf-benefit-num">{b.num}</span>
              <h3>{b.title}</h3>
              <p>{b.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─────────── USE CASES ─────────── */}
      <section id="usecases" className="pf-section pf-reveal">
        <div className="pf-section-head">
          <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Use cases</span>
          <h2 className="pf-h2-center">Built for every kind of kiosk</h2>
          <p>Smart Kiosk Control Dashboard powers public-facing kiosks across multiple environments.</p>
        </div>

        <div className="pf-uc-grid">
          {USE_CASES.map((u) => (
            <article key={u.title} className="pf-uc-card">
              <div className="pf-uc-ic">{u.icon}</div>
              <h3>{u.title}</h3>
              <p>{u.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─────────── SECTORS ─────────── */}
      <section className="pf-section pf-sectors pf-reveal">
        <h2 className="pf-h2">Where it lives</h2>
        <div className="pf-sector-grid">
          <article className="pf-sector-card">
            <h3>Offices &amp; Industries</h3>
            <p>Centralised monitoring and control for enterprise environments.</p>
          </article>
          <article className="pf-sector-card">
            <h3>Campuses &amp; Public Areas</h3>
            <p>Interactive kiosk portals for students, visitors, and the public.</p>
          </article>
          <article className="pf-sector-card pf-sector-card-wide">
            <h3>Smart Infrastructure</h3>
            <p>Scalable IoT-based service delivery for smart buildings and cities.</p>
          </article>
        </div>
      </section>

      {/* ─────────── FINAL CTA ─────────── */}
      <section className="pf-section pf-finalcta pf-reveal">
        <div className="pf-finalcta-rays" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <h2 className="pf-h2 pf-finalcta-title">Ready to try a kiosk?<br />Open one live now</h2>
        <p className="pf-finalcta-sub">Browse every published application. No account, no demo request — just tap a tile and start using it.</p>
        <Link to="/public" className="pf-cta-dark pf-cta-lg pf-cta-shimmer pf-cta-pulse">
          <ArrowSvg /> Open Live Demos
        </Link>
      </section>

      {/* ─────────── FOOTER ─────────── */}
      <footer className="pf-footer">
        <div className="pf-footer-inner">
          <div className="pf-footer-brand">
            <KioskMark dark />
            <span className="pf-brand-name">Smart Kiosk Control Dashboard</span>
          </div>

          <div className="pf-footer-cols">
            <div className="pf-footer-col">
              <h4>Explore</h4>
              <Link to="/public">Live demos</Link>
              <a href="#portal">Public portal</a>
              <a href="#benefits">Benefits</a>
            </div>
            <div className="pf-footer-col">
              <h4>About</h4>
              <a href="#about">What it is</a>
              <a href="#usecases">Use cases</a>
            </div>
            <div className="pf-footer-col pf-footer-meta">
              <h4>Product</h4>
              <span>by MYACCESS PRIVATE LIMITED</span>
              <span>© {new Date().getFullYear()}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* =====================================================================
   Inline assets
   ===================================================================== */
function KioskMark({ dark = false }) {
  return (
    <svg className="pf-mark" width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#FBC890" />
      <rect x="9"  y="11" width="8"  height="18" rx="2" fill="#14161C" />
      <rect x="20" y="11" width="11" height="8"  rx="2" fill="#14161C" fillOpacity="0.85" />
      <rect x="20" y="21" width="11" height="8"  rx="2" fill="#14161C" />
    </svg>
  )
}
function Sparkle() {
  return (
    <svg className="pf-sparkle" width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 L13.4 9.2 L20 12 L13.4 14.8 L12 21 L10.6 14.8 L4 12 L10.6 9.2 Z" fill="#14161C" />
    </svg>
  )
}
function ArrowSvg({ dark = false }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6"
        stroke={dark ? '#14161C' : '#fff'}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* Hero preview — a single elegant mock window. */
function HeroDashboardPreview() {
  return (
    <div className="pf-hero-preview">
      <div className="pf-preview-window">
        <header className="pf-preview-chrome">
          <span className="pf-preview-dot" />
          <span className="pf-preview-dot" />
          <span className="pf-preview-dot" />
          <span className="pf-preview-host">live · kiosk.public</span>
          <span className="pf-preview-status">
            <span className="pf-preview-status-dot" /> SYNCED
          </span>
        </header>
        <div className="pf-preview-body">
          <div className="pf-preview-list">
            <PreviewRow tint="peach" label="Temperature" value="22.4°" />
            <PreviewRow tint="mint"  label="Wi-Fi"       value="128 Mbps" />
            <PreviewRow tint="lav"   label="Light"       value="ON" />
            <PreviewRow tint="honey" label="Camera"      value="Live" />
          </div>
          <div className="pf-preview-hero">
            <div className="pf-preview-hero-label">SERVICES LIVE</div>
            <div className="pf-preview-hero-num">42</div>
            <svg className="pf-preview-spark" viewBox="0 0 140 60" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="pf-spark-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#FBC890" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#FBC890" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 48 C 20 42, 32 32, 50 28 S 84 14, 102 12 S 132 4, 140 2"
                stroke="#14161C" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M0 48 C 20 42, 32 32, 50 28 S 84 14, 102 12 S 132 4, 140 2 L140 60 L0 60 Z"
                fill="url(#pf-spark-fill)" />
            </svg>
            <div className="pf-preview-tabs">
              <button className="pf-mock-tab is-active">Day</button>
              <button className="pf-mock-tab">Week</button>
              <button className="pf-mock-tab">Month</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
function PreviewRow({ tint, label, value }) {
  return (
    <div className="pf-preview-row">
      <span className={'pf-mock-dot pf-dot-' + tint} />
      <span className="pf-preview-row-label">{label}</span>
      <span className="pf-preview-row-val">{value}</span>
    </div>
  )
}
function BannerPreview() {
  return (
    <div className="pf-banner-mock">
      <div className="pf-banner-mock-head">
        <span className="pf-banner-mock-dot" />
        Live · public
      </div>
      <div className="pf-banner-mock-big">42</div>
      <div className="pf-banner-mock-label">services live</div>
      <div className="pf-banner-mock-rows">
        <div><span /><span>Temp</span><b>22.4°</b></div>
        <div><span /><span>Wi-Fi</span><b>128 Mbps</b></div>
        <div><span /><span>Cam</span><b>1080p</b></div>
      </div>
    </div>
  )
}

/* =====================================================================
   Public-only data — pulled from the product brief.
   ===================================================================== */

const PORTAL_FEATURES = [
  {
    title: 'No-Login Public Access',
    desc: 'End users access published applications without any credentials.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M14 7V5a3 3 0 0 0-6 0v2" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="4.5" y="9" width="15" height="11" rx="2" stroke="#14161C" strokeWidth="1.6" />
        <path d="M9 14h6" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Touch-Friendly UI',
    desc: 'Designed for touchscreen kiosk hardware with flip-card interactions.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M9 11V6a2 2 0 0 1 4 0v6" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 9.5V8a2 2 0 0 1 4 0v4" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M17 10.5V9.5a2 2 0 0 1 4 0v7c0 3-2 5-5 5h-3c-2 0-3.5-1-4.5-2.5L4 13.5a2 2 0 0 1 3-2.5l2 1.5" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Live Status Indication',
    desc: 'Real-time service availability shown on every public application card.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" fill="#14161C" />
        <path d="M16 8a5.6 5.6 0 0 1 0 8M8 8a5.6 5.6 0 0 0 0 8" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M19 5a10 10 0 0 1 0 14M5 5a10 10 0 0 0 0 14" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
]

const BENEFITS = [
  { num: '01', title: 'Simple kiosk interface',  desc: 'Clean, focused layouts that don\'t get in the way of the task.' },
  { num: '02', title: 'No login required',       desc: 'Tap any tile and you\'re in. No signup, no demo request.' },
  { num: '03', title: 'Touch-friendly',          desc: 'Hit-targets sized for fingers, not pointers.' },
  { num: '04', title: 'Real-time visibility',    desc: 'Service status and live data appear without page reloads.' },
  { num: '05', title: 'Interactive experience',  desc: 'Toggles, sliders, and buttons fire the moment you tap them.' },
]

const USE_CASES = [
  {
    title: 'Smart Office Kiosks',
    desc: 'Reception, room booking, internal services, employee directory.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke="#14161C" strokeWidth="1.6" /><path d="M7 9h10M7 13h7" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Visitor Management',
    desc: 'Check in, badge print prompts, host notifications — fully self-serve.',
    icon: <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="9" r="3.5" stroke="#14161C" strokeWidth="1.6" /><path d="M5 20c1-4 5-6 7-6s6 2 7 6" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Public Information Kiosks',
    desc: 'Maps, directories, announcements, and live status displays.',
    icon: <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="#14161C" strokeWidth="1.6" /><path d="M12 8v0M12 11v5" stroke="#14161C" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Service Request Kiosks',
    desc: 'Submit requests, raise tickets, get queue numbers — without a counter.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="14" rx="2" stroke="#14161C" strokeWidth="1.6" /><path d="M8 9h8M8 13h5M8 17h6" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Smart Campus Dashboards',
    desc: 'Student-facing schedules, room availability, library status.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M3 10l9-5 9 5-9 5-9-5z" stroke="#14161C" strokeWidth="1.6" strokeLinejoin="round" /><path d="M7 12v5c2.5 2 7 2 10 0v-5" stroke="#14161C" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Facility &amp; Access Displays',
    desc: 'Door status, occupancy, access points — visible at a glance.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3.5" width="14" height="17" rx="2" stroke="#14161C" strokeWidth="1.6" /><circle cx="15" cy="12" r="1.2" fill="#14161C" /></svg>,
  },
]
