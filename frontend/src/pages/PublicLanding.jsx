import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CustomCursor from '../components/CustomCursor.jsx'
import { api } from '../lib/api.js'
import { mapSrcFromEmbed, coordsFromCode } from './CompanyInformation.jsx'

/**
 * Public marketing landing for the Smart Kiosk Control Dashboard.
 *
 * Regenerated to a richer, scroll-driven marketing layout (reference-inspired)
 * while staying inside the KIOSK peach + orange + ink theme and the existing
 * `pf-` design system. Sections:
 *   • Hero with live stats + floating widget preview
 *   • The Live Experience Protocol — animated step flow
 *   • Intelligence at Your Fingertips — feature grid
 *   • Project Live Feeds — live demo tiles
 *   • Next-Gen Control at Scale — dark banner with load chart
 *   • Designed for Everyone — audience cards
 *   • Request a Demo Cluster — contact form
 *
 * Public-only material: no admin/internal management surfaces are exposed.
 */
export default function PublicLanding() {
  // Scroll-reveal: staggered children animate in as each section enters view.
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

  // Thin scroll-progress bar + nav shadow once the page leaves the top.
  const [progress, setProgress] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement
      const max = h.scrollHeight - h.clientHeight
      setProgress(max > 0 ? (h.scrollTop / max) * 100 : 0)
      setScrolled(h.scrollTop > 12)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Intro loader → fades out, then the hero plays its staged entrance.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => setLoaded(true), reduce ? 200 : 1300)
    return () => clearTimeout(t)
  }, [])

  // Mobile nav drawer — collapses the section links behind a hamburger on
  // narrow viewports. Closes on navigation (anchor click) and on Escape.
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={'pf-page' + (loaded ? ' is-loaded' : '') + (scrolled ? ' is-scrolled' : '')}>
      <CustomCursor />
      {/* ─────────── INTRO LOADER ─────────── */}
      <div className={'pf-loader' + (loaded ? ' is-done' : '')} aria-hidden={loaded} role="status">
        <div className="pf-loader-fx" aria-hidden="true">
          <span className="pf-loader-orb pf-loader-orb-a" />
          <span className="pf-loader-orb pf-loader-orb-b" />
        </div>
        <div className="pf-loader-inner">
          <div className="pf-loader-mark">
            <span className="pf-loader-ring" />
            <KioskMark />
          </div>
          <span className="pf-loader-name">Kiosk</span>
          <div className="pf-loader-bar"><span /></div>
          <span className="pf-loader-tag">Booting live dashboard…</span>
        </div>
      </div>

      <div className="pf-scrollbar" style={{ width: progress + '%' }} aria-hidden="true" />

      {/* ─────────── NAV ─────────── */}
      <div className="pf-nav-wrap">
        <header className={'pf-nav' + (navOpen ? ' is-open' : '')}>
          <Link to="/" className="pf-brand" aria-label="MYACCESS">
            <img src="/logos/myaccess.svg" alt="MYACCESS" className="pf-brand-logo" />
          </Link>
          <nav className="pf-nav-links" onClick={() => setNavOpen(false)}>
            <a href="#platform">Platform</a>
            <a href="#steps">How It Works</a>
            <a href="#widgets">Designer</a>
            <a href="#architecture">Architecture</a>
            <Link to="/public" className="pf-nav-links-explore">Explore Applications</Link>
          </nav>
          <Link to="/public" className="pf-nav-explore">Explore Applications</Link>
          <button
            type="button"
            className="pf-nav-burger"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((o) => !o)}
          >
            <span /><span /><span />
          </button>
        </header>
        {navOpen && <button type="button" className="pf-nav-backdrop" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
      </div>

      {/* ─────────── HERO ─────────── */}
      <section id="top" className="pf-hero-wrap">
        <div className="pf-hero">
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
              <span className="pf-pill pf-pill-soft">
                <span className="pf-pill-dot pf-pill-dot-accent" />LIVE IoT ECOSYSTEM
              </span>
            </div>
            <h1 className="pf-h1-anim pf-hero-h1">
              <span className="pf-line-1">Kiosk Live Demo</span>
              <span className="pf-line-2"><span className="pf-hero-mark">Dashboard</span></span>
            </h1>
            <p>
              Experience real-time project monitoring, device control, and
              dynamic dashboard interaction. Manage your hardware infrastructure
              from anywhere with zero latency.
            </p>
            <div className="pf-hero-actions">
              <Link to="/public" className="pf-cta-accent pf-cta-shimmer">
                Get Started Now
              </Link>
              <a href="#platform" className="pf-cta-outline">View Documentation</a>
            </div>

            <div className="pf-hero-stats">
              {HERO_STATS.map((s) => (
                <div key={s.label} className="pf-hero-stat">
                  <span className="pf-hero-stat-num">{s.value}</span>
                  <span className="pf-hero-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          <HeroDashboardPreview />

          <a href="#control" className="pf-hero-scroll" aria-label="Scroll to explore">
            <span /> Scroll
          </a>
        </div>
      </section>

      {/* ─────────── UNIFIED CONTROL DASHBOARD ─────────── */}
      <ControlDashboardSection />

      {/* ─────────── PLATFORM (intro + uniqueness, tabbed) ─────────── */}
      <PlatformShowcase />

      {/* ─────────── HOW IT WORKS (interactive product tour) ─────────── */}
      <OnboardingTour />

      {/* ─────────── DASHBOARD DESIGNER · WIDGET LIBRARY ─────────── */}
      <section id="widgets" className="pf-section pf-wgsec pf-reveal">
        <div className="pf-section-head">
          <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Dashboard Designer</span>
          <h2 className="pf-h2-center">Design dashboards <span className="pf-s2-accent">dynamically</span></h2>
          <p>Drag in widgets and bind them to live device payloads — 30+ widget types across six categories, from gauges to camera tiles.</p>
        </div>

        <div className="pf-wg-cats">
          {WIDGET_CATS.map((c) => (
            <span key={c.name} className="pf-wg-cat"><b>{c.count}</b>{c.name}</span>
          ))}
        </div>

        <div className="pf-widgets-grid">
          {WIDGETS.map((w, i) => (
            <div key={w.name} className="pf-widget" style={{ '--i': i }}>
              <div className="pf-widget-prev">{w.preview}</div>
              <div className="pf-widget-meta">
                <span className="pf-widget-name">{w.name}</span>
                <span className="pf-widget-cat">{w.cat}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────── REAL-TIME CONTROL ARCHITECTURE ─────────── */}
      <section id="architecture" className="pf-section pf-rt pf-reveal">
        <div className="pf-rt-panel">
          <div className="pf-rt-bg" aria-hidden="true">
            <div className="pf-rt-gridfx" />
            <span className="pf-rt-glow pf-rt-glow-a" />
            <span className="pf-rt-glow pf-rt-glow-b" />
          </div>

          <div className="pf-section-head pf-rt-head">
            <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Real-Time Control Architecture</span>
            <h2 className="pf-h2-center">Control &amp; Monitoring System</h2>
            <p>The control system is built for real-time interaction between the web dashboard and connected kiosk or IoT devices.</p>
          </div>

          {/* flow diagram */}
          <div className="pf-rt-flow">
            {FLOW.map((n, i) => (
              <Fragment key={n.label}>
                <div className="pf-rt-node" style={{ '--i': i }}>
                  <div className="pf-rt-ic">{n.icon}</div>
                  <span className="pf-rt-node-label">{n.label}</span>
                  <span className="pf-rt-node-sub">{n.sub}</span>
                </div>
                {i < FLOW.length - 1 && (
                  <div className="pf-rt-link" style={{ '--i': i }} aria-hidden="true">
                    <span className="pf-rt-line" />
                    <span className="pf-rt-arrow" />
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {/* capabilities + JSON exchange */}
          <div className="pf-rt-lower">
            <div className="pf-rt-caps">
              <h3>Platform control capabilities</h3>
              <ul>
                {RT_CAPS.map((c) => <li key={c}><CheckSvg /> {c}</li>)}
              </ul>
            </div>

            <div className="pf-rt-cards">
              <CodeCard title="command · send" side="cmd" data={{ device: 'KSK-001', path: 'light/status', value: true }} />
              <div className="pf-rt-exchange" aria-hidden="true">
                <span className="pf-rt-ex-line" />
                <span className="pf-rt-ex-badge"><span className="pf-rt-ex-dot" />live exchange</span>
              </div>
              <CodeCard title="response · received" side="res" data={{ status: 'success', light: 'ON', response: 'Command executed' }} />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── WHY THIS PRODUCT? ─────────── */}
      <section id="why" className="pf-section pf-s4 pf-reveal">
        <div className="pf-s4-panel">
          {/* Background visual: blueprint grid + IoT node network + kiosk totems */}
          <div className="pf-s4-bg" aria-hidden="true">
            <div className="pf-s4-gridfx" />
            <span className="pf-s4-orb pf-s4-orb-a" />
            <span className="pf-s4-orb pf-s4-orb-b" />
            <svg className="pf-s4-net" viewBox="0 0 1200 440" preserveAspectRatio="xMidYMid slice" fill="none">
              <g className="pf-s4-links" stroke="rgba(243,106,30,0.22)" strokeWidth="1.4" strokeLinecap="round">
                <line x1="120" y1="90" x2="300" y2="170" />
                <line x1="300" y1="170" x2="210" y2="320" />
                <line x1="300" y1="170" x2="480" y2="100" />
                <line x1="480" y1="100" x2="580" y2="250" />
                <line x1="580" y1="250" x2="740" y2="150" />
                <line x1="740" y1="150" x2="910" y2="95" />
                <line x1="740" y1="150" x2="980" y2="260" />
                <line x1="980" y1="260" x2="1080" y2="150" />
                <line x1="910" y1="95" x2="1080" y2="150" />
                <line x1="580" y1="250" x2="660" y2="360" />
                <line x1="980" y1="260" x2="660" y2="360" />
              </g>
              <g className="pf-s4-nodes" fill="#F36A1E">
                <circle cx="120" cy="90" r="5" />
                <circle cx="300" cy="170" r="6" />
                <circle cx="210" cy="320" r="4.5" />
                <circle cx="480" cy="100" r="5" />
                <circle cx="580" cy="250" r="6" />
                <circle cx="740" cy="150" r="5.5" />
                <circle cx="910" cy="95" r="5" />
                <circle cx="980" cy="260" r="6" />
                <circle cx="1080" cy="150" r="5" />
                <circle cx="660" cy="360" r="5" />
              </g>
              <g className="pf-s4-kiosks" fill="rgba(20,22,28,0.05)">
                <rect x="66" y="300" width="48" height="128" rx="9" />
                <rect x="74" y="312" width="32" height="44" rx="4" fill="rgba(243,106,30,0.10)" />
                <rect x="1096" y="288" width="52" height="140" rx="9" />
                <rect x="1105" y="300" width="34" height="48" rx="4" fill="rgba(243,106,30,0.10)" />
              </g>
            </svg>
          </div>

          <div className="pf-section-head pf-s4-head">
            <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Why This Product?</span>
            <h2 className="pf-h2-center">
              Why Modern Kiosk Systems Need a <span className="pf-s2-accent">Unified Control Platform</span>
            </h2>
            <p>
              Organizations run kiosks for services, access control, monitoring, displays,
              automation, and public interaction. Managing them manually breaks down when
              devices, cameras, apps, and dashboards live in separate systems.
            </p>
            <p>
              This product closes the gap — bringing application management, device
              monitoring, real-time control, camera access, public dashboards, and admin
              security into one unified platform.
            </p>
          </div>

          <div className="pf-s4-cards">
            {NEED_POINTS.map((c, i) => (
              <article key={c.title} className="pf-s4-card" style={{ '--i': i }}>
                <div className={'pf-s3-ic pf-s3-ic-' + c.tint}>{c.icon}</div>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── PROJECT LIVE FEEDS (commented out) ───────────
      <section id="feeds" className="pf-section pf-reveal">
        <div className="pf-feeds-head">
          <div>
            <h2 className="pf-h2">Project Live Feeds</h2>
            <p>Our active deployments currently streaming data.</p>
          </div>
          <Link to="/public" className="pf-cta-link-dark">View All Projects →</Link>
        </div>

        <div className="pf-feeds-grid">
          {LIVE_FEEDS.map((f, i) => (
            <article key={f.title} className="pf-feed-card" style={{ '--i': i }}>
              <div className={'pf-feed-thumb pf-feed-thumb-' + f.tint}>
                <span className={'pf-feed-badge pf-feed-badge-' + (f.status === 'LIVE' ? 'live' : f.status === 'ACTIVE' ? 'active' : 'standby')}>
                  <span className="pf-feed-badge-dot" />{f.status}
                </span>
                <div className="pf-feed-thumb-ic">{f.icon}</div>
              </div>
              <div className="pf-feed-body">
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
                <Link to="/public" className="pf-feed-launch">Launch Console</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      ─────────── */}

      {/* ─────────── NEXT-GEN CONTROL AT SCALE (commented out) ───────────
      <section id="scale" className="pf-section pf-reveal">
        <div className="pf-scale">
          <div className="pf-scale-bg" aria-hidden="true">
            <div className="pf-scale-grid" />
            <span className="pf-scale-glow pf-scale-glow-a" />
            <span className="pf-scale-glow pf-scale-glow-b" />
          </div>

          <div className="pf-scale-main">
            <div className="pf-scale-text">
              <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Enterprise Scale</span>
              <h2 className="pf-h2">Next-Gen Control at Scale</h2>
              <p>From a single kiosk to a fleet across sites — monitor, control, and publish with real-time telemetry and zero-downtime deploys.</p>
              <ul className="pf-scale-feats">
                <li><CheckSvg /> Real-time Telemetry</li>
                <li><CheckSvg /> Enterprise Security</li>
                <li><CheckSvg /> Zero-downtime Deploys</li>
              </ul>
              <Link to="/public" className="pf-cta-accent pf-cta-shimmer">Explore the Platform</Link>
            </div>

            <div className="pf-scale-card">
              <div className="pf-scale-card-head">
                <span>System Load</span>
                <span className="pf-scale-state"><span className="pf-scale-state-dot" />Normal</span>
              </div>
              <div className="pf-scale-chart" aria-hidden="true">
                {LOAD_BARS.map((h, i) => (
                  <span key={i} style={{ '--h': h + '%', '--i': i }} className={i === 4 ? 'is-peak' : ''} />
                ))}
              </div>
              <div className="pf-scale-card-foot">
                <span><i className="pf-scale-dot-on" /> Data</span>
                <span><i className="pf-scale-dot-off" /> Alerts</span>
              </div>
            </div>
          </div>

          <div className="pf-scale-stats">
            {SCALE_STATS.map((s) => (
              <div key={s.label} className="pf-scale-stat">
                <span className="pf-scale-stat-num">{s.value}</span>
                <span className="pf-scale-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      ─────────── */}

      {/* ─────────── CONTACT US ─────────── */}
      <section className="pf-section pf-reveal">
        <ContactSection />
      </section>

      {/* ─────────── FOOTER ─────────── */}
      <footer className="pf-footer">
        <div className="pf-footer-inner">
          <div className="pf-footer-brand-col">
            <div className="pf-footer-brand">
              <KioskMark dark />
              <span className="pf-brand-name">Smart Kiosk</span>
            </div>
            <p className="pf-footer-tag">
              Empowering industries with real-time IoT visualization and intelligent
              hardware management solutions.
            </p>
          </div>

          <div className="pf-footer-cols">
            <div className="pf-footer-col">
              <h4>Platform</h4>
              <a href="#platform">What it is</a>
              <a href="#control">Control Dashboard</a>
              <a href="#widgets">Dashboard Designer</a>
              <a href="#architecture">Architecture</a>
            </div>
            <div className="pf-footer-col">
              <h4>Explore</h4>
              <a href="#steps">How It Works</a>
              <a href="#why">Why Us</a>
              <a href="#architecture">Architecture</a>
            </div>
            <div className="pf-footer-col">
              <h4>Get Started</h4>
              <Link to="/public">Live Demos</Link>
              <a href="#contact">Contact Us</a>
              <span className="pf-footer-meta-line">by MYACCESS PRIVATE LIMITED</span>
            </div>
          </div>
        </div>
        <div className="pf-footer-base">
          <span>© {new Date().getFullYear()} Smart Kiosk Control Dashboard. All rights reserved.</span>
          <span className="pf-footer-status"><span className="pf-footer-status-dot" /> All Systems Operational</span>
        </div>
      </footer>
    </div>
  )
}

/* =====================================================================
   Contact Us — posts to the public Contact intake and renders the active
   company info (email / phone / office + office map) loaded from the API.
   Falls back to sensible defaults if no company info is configured yet.
   ===================================================================== */
const CONTACT_FALLBACK = {
  email: 'naveen@myaccessio.com',
  phone: '+91 00000 00000',
  company_name: 'MYACCESS PRIVATE LIMITED',
  address: '',
  map_embed_code: '',
}

/**
 * Resolve the cleanest possible map src for the public page:
 *  1. mapSrcFromEmbed() — a precise pin from coordinates in the pasted
 *     link/embed, or the embed src verbatim.
 *  2. Fall back to geocoding the office address into a pin.
 */
function publicMapSrc(company) {
  const src = mapSrcFromEmbed(company.map_embed_code)
  if (src) return src
  const q = String(company.address || company.company_name || '').trim()
  if (q) return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`
  return null
}

function ContactSection() {
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [company, setCompany] = useState(CONTACT_FALLBACK)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Pull the active company info; keep the fallback if none is configured.
  useEffect(() => {
    let alive = true
    api.publicGetCompanyInformation()
      .then((resp) => {
        if (!alive) return
        const c = resp?.company
        if (c) {
          setCompany({
            email: c.email || CONTACT_FALLBACK.email,
            phone: c.phone || CONTACT_FALLBACK.phone,
            company_name: c.company_name || CONTACT_FALLBACK.company_name,
            address: c.address || '',
            map_embed_code: c.map_embed_code || '',
          })
        }
      })
      .catch(() => { /* keep fallback */ })
    return () => { alive = false }
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setErr(null)
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setErr('Please fill in your name, email, and message.')
      return
    }
    setBusy(true)
    try {
      await api.publicSubmitContact(form)
      setSent(true)
    } catch (e2) {
      setErr(e2?.message || 'Could not send your message. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const mapSrc = publicMapSrc(company)
  const mapCoords = coordsFromCode(company.map_embed_code)
  const mapQuery = mapCoords || (company.address || company.company_name || '')
  const phoneHref = 'tel:' + String(company.phone || '').replace(/[^\d+]/g, '')

  return (
    <div id="contact" className="pf-contact">
      <div className="pf-contact-head">
        <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Contact Us</span>
        <h2 className="pf-h2-center">Get in <span className="pf-s2-accent">touch</span></h2>
        <p>Have a question or want to work with us? Send us a message and our team will get back to you shortly.</p>
      </div>

      <div className="pf-contact-card">
        {sent ? (
          <div className="pf-demo-done" role="status">
            <div className="pf-demo-done-ic"><CheckSvg big /></div>
            <h3>Message sent</h3>
            <p>Thanks for reaching out — our team will get back to you shortly.</p>
          </div>
        ) : (
          <form className="pf-contact-form" onSubmit={onSubmit}>
            <div className="pf-demo-row">
              <label className="pf-field">
                <span>Full Name</span>
                <input type="text" name="name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="John Doe" autoComplete="name" required />
              </label>
              <label className="pf-field">
                <span>Email</span>
                <input type="email" name="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="john@company.com" autoComplete="email" required />
              </label>
            </div>
            <label className="pf-field">
              <span>Subject</span>
              <input type="text" name="subject" value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="How can we help?" />
            </label>
            <label className="pf-field">
              <span>Message</span>
              <textarea name="message" rows={5} value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Write your message…" required />
            </label>
            {err && <div className="pf-contact-error" role="alert">{err}</div>}
            <button type="submit" className="pf-contact-submit pf-cta-shimmer" disabled={busy}>
              {busy ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}
      </div>

      <div className="pf-contact-methods">
        <a className="pf-contact-method" href={`mailto:${company.email}`}>
          <span className="pf-contact-ic"><MailSvg /></span>
          <span className="pf-contact-method-text">
            <b>Email</b>
            <span className="pf-contact-value">{company.email}</span>
          </span>
        </a>
        <a className="pf-contact-method" href={phoneHref}>
          <span className="pf-contact-ic"><PhoneSvg /></span>
          <span className="pf-contact-method-text">
            <b>Phone</b>
            <span className="pf-contact-value">{company.phone}</span>
          </span>
        </a>
        <span className="pf-contact-method pf-contact-method-office">
          <span className="pf-contact-ic"><PinSvg /></span>
          <span className="pf-contact-method-text">
            <b>Office</b>
            <span className="pf-contact-value">{company.company_name}</span>
            {company.address ? <span className="pf-contact-address">{company.address}</span> : null}
          </span>
        </span>
      </div>

      {mapSrc && (
        <div className="pf-contact-map">
          <iframe
            title="Office location"
            src={mapSrc}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
          <a
            className="pf-contact-map-link"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps →
          </a>
        </div>
      )}
    </div>
  )
}

/* =====================================================================
   Section 2 — Unified Control Dashboard.
   One clean dashboard card (no scattered popups). The status events live
   in an in-panel "Live Activity" feed whose highlight gently cycles, and
   the KPIs count up the first time the section scrolls into view.
   ===================================================================== */
function useInView(threshold = 0.3) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return undefined }
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { setInView(true); io.disconnect() }
    }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return [ref, inView]
}

function CountUp({ end, decimals = 0, suffix = '', run = false, duration = 1300 }) {
  const [val, setVal] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    if (!run) return undefined
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setVal(end); return undefined }
    let start = null
    const step = (t) => {
      if (start === null) start = t
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(end * eased)
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [run, end, duration])
  return <>{val.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>
}

function ControlDashboardSection() {
  const [stageRef, inView] = useInView(0.35)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (!inView) return undefined
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return undefined
    const id = setInterval(() => setActive((a) => (a + 1) % STATUS_CARDS.length), 2200)
    return () => clearInterval(id)
  }, [inView])

  return (
    <section id="control" className="pf-section pf-s2 pf-reveal">
      <div className="pf-s2-grid">
        <div className="pf-s2-text">
          <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />Unified Control Plane</span>
          <h2 className="pf-h2">
            Command every kiosk from <span className="pf-s2-accent">one live dashboard</span>
          </h2>
          <p>
            Connect devices, push commands, stream cameras, and update payloads in
            real time — while role-based access keeps every action secure. One calm,
            readable control surface for your whole fleet.
          </p>
          <ul className="pf-s2-points">
            <li><CheckSvg /> Live device payloads over WebSocket</li>
            <li><CheckSvg /> Push put / patch / post commands instantly</li>
            <li><CheckSvg /> Publish dashboards with role-based access</li>
          </ul>
          <div className="pf-s2-actions">
            <Link to="/public" className="pf-cta-accent pf-cta-shimmer">Open Live Demo</Link>
            <a href="#platform" className="pf-cta-outline">Explore Features</a>
          </div>
        </div>

        <div className="pf-s2-stage" ref={stageRef}>
          <div className="pf-s2-glow" aria-hidden="true" />

          <div className="pf-s2-dash">
            <div className="pf-s2-dash-top">
              <span className="pf-s2-dash-title"><span className="pf-s2-dash-logo" />Control Center</span>
              <span className="pf-s2-dash-live"><span className="pf-s2-dash-live-dot" />LIVE</span>
            </div>

            <div className="pf-s2-kpis">
              {S2_KPIS.map((k) => (
                <div key={k.label} className="pf-s2-kpi">
                  <span className="pf-s2-kpi-label">{k.label}</span>
                  <span className="pf-s2-kpi-num">
                    <CountUp end={k.end} decimals={k.decimals} suffix={k.suffix} run={inView} />
                  </span>
                  <span className="pf-s2-kpi-trend">{k.trend}</span>
                </div>
              ))}
            </div>

            <div className="pf-s2-chartcard">
              <div className="pf-s2-chart-head">
                <span>Payload Activity</span>
                <span className="pf-s2-chart-val">1.2k/min</span>
              </div>
              <div className="pf-s2-bars">
                {S2_BARS.map((h, i) => (
                  <i key={i} style={{ '--h': h + '%', '--i': i }} className={i === 5 ? 'is-peak' : ''} />
                ))}
              </div>
            </div>

            <div className="pf-s2-feed">
              <div className="pf-s2-feed-head">
                <span>Live Activity</span>
                <span className="pf-s2-feed-count"><span className="pf-s2-feed-count-dot" />{STATUS_CARDS.length} events</span>
              </div>
              <div className="pf-s2-feed-list">
                {STATUS_CARDS.map((c, i) => (
                  <div key={c.title} className={'pf-s2-event' + (i === active ? ' is-active' : '')}>
                    <span className={'pf-s2-event-ic pf-s2-event-ic-' + c.tint}>{c.icon}</span>
                    <span className="pf-s2-event-text">
                      <span className="pf-s2-event-title">{c.title}</span>
                      <span className="pf-s2-event-sub">{c.sub}</span>
                    </span>
                    <span className="pf-s2-event-time">{i === active ? 'now' : c.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* =====================================================================
   Platform — combines "What is Smart Kiosk Control Dashboard?" with
   "Product Uniqueness" into one tabbed showcase. Switching tabs plays a
   short skeleton/loading effect, then the cards animate in staggered.
   ===================================================================== */
function PlatformShowcase() {
  const PLATFORM_TABS = [
    { key: 'about',  label: 'What it is',         loadingLabel: 'capabilities',    data: CAPABILITIES },
    { key: 'unique', label: 'What sets us apart', loadingLabel: 'differentiators', data: UNIQUE_FEATURES },
  ]
  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [stageRef, inView] = useInView(0.2)
  const startedRef = useRef(false)
  const timerRef = useRef(0)

  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // initial load effect once the section scrolls into view
  useEffect(() => {
    if (!inView || startedRef.current) return undefined
    startedRef.current = true
    if (reduceMotion()) { setLoading(false); return undefined }
    timerRef.current = window.setTimeout(() => setLoading(false), 650)
    return () => clearTimeout(timerRef.current)
  }, [inView])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function switchTab(i) {
    if (i === tab) return
    setTab(i)
    if (reduceMotion()) { setLoading(false); return }
    setLoading(true)
    clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setLoading(false), 480)
  }

  const active = PLATFORM_TABS[tab]

  return (
    <section id="platform" className="pf-section pf-px pf-reveal">
      <div className="pf-px-bg" aria-hidden="true">
        <span className="pf-px-glow" />
      </div>

      <div className="pf-section-head pf-px-head">
        <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />The Platform</span>
        <h2 className="pf-h2-center">
          What is <span className="pf-s2-accent">Smart Kiosk Control Dashboard</span>?
        </h2>
        <p>
          A web-based enterprise platform to manage, monitor, and control smart kiosks
          from one interface. Most systems give you only a public screen — this gives
          you both sides.
        </p>
        <div className="pf-s5-split">
          <span className="pf-s5-split-pill"><i className="pf-s5-dot-admin" />Admin-side control platform</span>
          <span className="pf-s5-split-plus">+</span>
          <span className="pf-s5-split-pill"><i className="pf-s5-dot-public" />Public-side kiosk experience</span>
        </div>
      </div>

      <div className="pf-px-tabswrap">
        <div className="pf-px-tabs" role="tablist">
          {PLATFORM_TABS.map((t, i) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className={'pf-px-tab' + (i === tab ? ' is-active' : '')}
              onClick={() => switchTab(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pf-px-stage" ref={stageRef}>
        {loading ? (
          <>
            <div className="pf-px-cards" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="pf-px-skel" style={{ '--i': i }} />
              ))}
            </div>
            <div className="pf-px-loading" role="status">
              <span /><span /><span /> Loading {active.loadingLabel}…
            </div>
          </>
        ) : (
          <div className="pf-px-cards" key={active.key}>
            {active.data.map((c, i) => (
              <article key={c.title} className="pf-px-card" style={{ '--i': i }}>
                <div className="pf-px-ic">{c.icon}</div>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/* =====================================================================
   "See it in action" — screenshot-style rendered mockups of the real
   product screens, framed in a browser chrome. Pure CSS/markup, so they
   stay crisp at any size and match the app's dark-sidebar + light-content
   look (no image assets).
   ===================================================================== */
function BrowserFrame({ url, children }) {
  return (
    <div className="pf-shot">
      <div className="pf-shot-chrome">
        <span className="pf-shot-dot" />
        <span className="pf-shot-dot" />
        <span className="pf-shot-dot" />
        <span className="pf-shot-urlbar"><LockMini /> {url}</span>
      </div>
      <div className="pf-shot-screen">{children}</div>
    </div>
  )
}
function LockMini() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="#9aa0ae" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#9aa0ae" strokeWidth="2" />
    </svg>
  )
}

/* shared chrome: dark sidebar with nav icons */
function ScrShell({ active = 0, children }) {
  return (
    <div className="pf-scr">
      <div className="pf-scr-side">
        <span className="pf-scr-logo" />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={'pf-scr-navi' + (i === active ? ' is-active' : '')} />
        ))}
      </div>
      <div className="pf-scr-body">{children}</div>
    </div>
  )
}

function AppsScreen() {
  return (
    <ScrShell active={1}>
      <div className="pf-scr-head">
        <span className="pf-scr-title">Applications</span>
        <span className="pf-scr-search" />
        <span className="pf-scr-cta">+ New</span>
      </div>
      <div className="pf-scr-apps">
        {[
          { n: 'Lobby Display', s: 'live' },
          { n: 'Visitor Check-in', s: 'live' },
          { n: 'Cafeteria Menu', s: 'draft' },
          { n: 'Wayfinder Map', s: 'live' },
        ].map((a) => (
          <div key={a.n} className="pf-scr-app">
            <span className="pf-scr-app-ic" />
            <span className="pf-scr-app-name">{a.n}</span>
            <span className={'pf-scr-app-tag pf-scr-app-tag-' + a.s}>{a.s === 'live' ? 'Published' : 'Draft'}</span>
          </div>
        ))}
      </div>
    </ScrShell>
  )
}

function DesignerScreen() {
  return (
    <ScrShell active={3}>
      <div className="pf-scr-head">
        <span className="pf-scr-title">Dashboard Designer</span>
        <span className="pf-scr-search" />
        <span className="pf-scr-cta">Save</span>
      </div>
      <div className="pf-scr-designer">
        <div className="pf-scr-palette">
          {['Gauge', 'Toggle', 'Chart', 'Value', 'Camera'].map((w) => (
            <span key={w} className="pf-scr-chip">{w}</span>
          ))}
        </div>
        <div className="pf-scr-canvas">
          <div className="pf-scr-w pf-scr-w-gauge">
            <svg viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="16" stroke="rgba(20,22,28,0.10)" strokeWidth="5" /><circle cx="22" cy="22" r="16" stroke="#F36A1E" strokeWidth="5" strokeLinecap="round" strokeDasharray="100" strokeDashoffset="34" transform="rotate(-90 22 22)" /></svg>
          </div>
          <div className="pf-scr-w pf-scr-w-toggle"><span className="pf-scr-switch"><i /></span></div>
          <div className="pf-scr-w pf-scr-w-bars"><i style={{ height: '40%' }} /><i style={{ height: '70%' }} /><i style={{ height: '55%' }} /><i style={{ height: '88%' }} /><i style={{ height: '62%' }} /></div>
          <div className="pf-scr-w pf-scr-w-val"><b>24.5°</b><span /></div>
        </div>
      </div>
    </ScrShell>
  )
}

function CameraScreen() {
  return (
    <ScrShell active={2}>
      <div className="pf-scr-head">
        <span className="pf-scr-title">Cameras</span>
        <span className="pf-scr-search" />
        <span className="pf-scr-cta">+ Add</span>
      </div>
      <div className="pf-scr-cams">
        <div className="pf-scr-cam-main">
          <span className="pf-scr-cam-rec"><i />REC</span>
          <span className="pf-scr-cam-cross" />
          <span className="pf-scr-cam-meta">cam1 · WebRTC · 3 viewers</span>
        </div>
        <div className="pf-scr-cam-list">
          {[
            { n: 'cam1 · Front', on: true },
            { n: 'cam2 · Lobby', on: true },
            { n: 'cam3 · Gate', on: false },
          ].map((c) => (
            <div key={c.n} className="pf-scr-cam-row">
              <span className={'pf-scr-cam-dot' + (c.on ? ' is-on' : '')} />
              <span>{c.n}</span>
            </div>
          ))}
        </div>
      </div>
    </ScrShell>
  )
}

/* application detail — assign camera + add devices on one page */
function AssignScreen() {
  return (
    <ScrShell active={1}>
      <div className="pf-scr-head">
        <span className="pf-scr-title">Lobby Display</span>
        <span className="pf-scr-search" />
        <span className="pf-scr-cta">Save</span>
      </div>
      <div className="pf-scr-assign">
        <div className="pf-scr-panel">
          <div className="pf-scr-panel-h">Camera <span className="pf-scr-app-tag pf-scr-app-tag-live">Assigned</span></div>
          <div className="pf-scr-cam-main pf-scr-assign-cam">
            <span className="pf-scr-cam-rec"><i />LIVE</span>
            <span className="pf-scr-cam-cross" />
            <span className="pf-scr-cam-meta">cam1 · WebRTC</span>
          </div>
        </div>
        <div className="pf-scr-panel">
          <div className="pf-scr-panel-h">Devices · 3 <span className="pf-scr-mini-add">+ Add</span></div>
          <div className="pf-scr-cam-list">
            {[
              { n: 'kiosk-front-01', on: true },
              { n: 'relay-01', on: true },
              { n: 'sensor-02', on: false },
            ].map((d) => (
              <div key={d.n} className="pf-scr-cam-row">
                <span className={'pf-scr-cam-dot' + (d.on ? ' is-on' : '')} />
                <span>{d.n}</span>
                <span className="pf-scr-dev-proto">websocket</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrShell>
  )
}

/* publish — toggle on + public link + live preview */
function PublishScreen() {
  return (
    <ScrShell active={1}>
      <div className="pf-scr-head">
        <span className="pf-scr-title">Lobby Display</span>
        <span className="pf-scr-search" />
        <span className="pf-scr-pub-live"><i />Live</span>
      </div>
      <div className="pf-scr-publish">
        <div className="pf-scr-pub-row">
          <span className="pf-scr-pub-text">
            <b>Publish application</b>
            <i>Public, no-login kiosk access</i>
          </span>
          <span className="pf-scr-switch pf-scr-switch-lg"><i /></span>
        </div>
        <div className="pf-scr-pub-url"><LockMini /> kiosk.public/lobby-display</div>
        <div className="pf-scr-pub-prev">
          <div className="pf-scr-w pf-scr-w-gauge">
            <svg viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="16" stroke="rgba(20,22,28,0.10)" strokeWidth="5" /><circle cx="22" cy="22" r="16" stroke="#F36A1E" strokeWidth="5" strokeLinecap="round" strokeDasharray="100" strokeDashoffset="28" transform="rotate(-90 22 22)" /></svg>
          </div>
          <div className="pf-scr-w pf-scr-w-bars"><i style={{ height: '50%' }} /><i style={{ height: '78%' }} /><i style={{ height: '60%' }} /><i style={{ height: '90%' }} /></div>
          <div className="pf-scr-w pf-scr-w-val"><b>24.5°</b><span /></div>
        </div>
      </div>
    </ScrShell>
  )
}

/* JSON code card (terminal style) for the architecture exchange. */
function CodeCard({ title, side, data }) {
  const entries = Object.entries(data)
  return (
    <div className={'pf-rt-code pf-rt-code-' + side}>
      <div className="pf-rt-code-head">
        <span className="pf-rt-code-dot" /><span className="pf-rt-code-dot" /><span className="pf-rt-code-dot" />
        <span className="pf-rt-code-title">{title}</span>
      </div>
      <div className="pf-rt-pre">
        <div className="pf-rt-ln"><span className="p">{'{'}</span></div>
        {entries.map(([k, v], i) => (
          <div key={k} className="pf-rt-ln pf-rt-ind">
            <span className="k">"{k}"</span><span className="p">: </span>
            {typeof v === 'string'
              ? <span className="s">"{v}"</span>
              : <span className="b">{String(v)}</span>}
            {i < entries.length - 1 && <span className="p">,</span>}
          </div>
        ))}
        <div className="pf-rt-ln"><span className="p">{'}'}</span></div>
      </div>
    </div>
  )
}

/* Interactive product tour — the matching live page renders in the frame
   as you move (or auto-advance) through each onboarding step. */
function OnboardingTour() {
  const [stageRef, inView] = useInView(0.25)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (!inView) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    const t = setTimeout(() => setActive((a) => (a + 1) % TOUR_STEPS.length), 3600)
    return () => clearTimeout(t)
  }, [inView, active])

  const step = TOUR_STEPS[active]

  return (
    <section id="steps" className="pf-section pf-tour pf-reveal">
      <div className="pf-section-head">
        <span className="pf-eyebrow"><span className="pf-eyebrow-dot" />How It Works</span>
        <h2 className="pf-h2-center">Go live in <span className="pf-s2-accent">five simple steps</span></h2>
        <p>From onboarding hardware to publishing a public kiosk — watch each step render live.</p>
      </div>

      <div className="pf-tour-grid" ref={stageRef}>
        <div className="pf-tour-steps" role="tablist">
          {TOUR_STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={'pf-tour-step' + (i === active ? ' is-active' : '')}
              onClick={() => setActive(i)}
            >
              <span className="pf-tour-num">{i + 1}</span>
              <span className="pf-tour-step-text">
                <span className="pf-tour-step-title">{s.title}</span>
                <span className="pf-tour-step-desc">{s.desc}</span>
              </span>
              {i === active && <span key={active} className="pf-tour-prog" aria-hidden="true" />}
            </button>
          ))}
        </div>

        <div className="pf-tour-stage">
          <div key={active} className="pf-tour-screen-wrap">
            <BrowserFrame url={step.url}>{step.screen}</BrowserFrame>
          </div>
          <span className="pf-tour-tag"><span className="pf-tour-tag-dot" />{step.tag}</span>
        </div>
      </div>
    </section>
  )
}

/* ----- Onboarding tour steps (How it works) — each renders a live page ----- */
const TOUR_STEPS = [
  {
    title: 'Onboard a camera',
    desc: 'Add a camera with its protocol (RTSP / WebRTC / ONVIF) and stream path.',
    url: 'app.kiosk/cameras', tag: 'Live in seconds', screen: <CameraScreen />,
  },
  {
    title: 'Onboard an application',
    desc: 'Create a kiosk application to hold its devices, cameras, and dashboards.',
    url: 'app.kiosk/applications', tag: 'One container per kiosk', screen: <AppsScreen />,
  },
  {
    title: 'Assign camera & add devices',
    desc: 'Link the camera and connect IoT devices — all on a single page.',
    url: 'app.kiosk/applications/lobby-display', tag: 'Camera + devices, one page', screen: <AssignScreen />,
  },
  {
    title: 'Design the dashboard',
    desc: 'Drag in gauges, toggles, charts, and camera tiles bound to live data.',
    url: 'app.kiosk/dashboards/designer', tag: 'Drag-and-drop widgets', screen: <DesignerScreen />,
  },
  {
    title: 'Publish',
    desc: 'Publish for public, no-login kiosk access — instantly live.',
    url: 'app.kiosk/applications/lobby-display', tag: 'Public, no-login access', screen: <PublishScreen />,
  },
]

/* =====================================================================
   Hero preview — a realistic desktop monitor running a dark dashboard,
   with floating glass widgets (temperature + network) layered over it.
   ===================================================================== */
function HeroDashboardPreview() {
  // Live ticking telemetry — gives the mock a real-time "alive" feel.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 2200)
    return () => clearInterval(id)
  }, [])
  const temp = (24.5 + Math.sin(tick / 2) * 0.3).toFixed(1)

  return (
    <div className="pf-hero-preview">
      <div className="pf-monitor">
        <div className="pf-monitor-screen">
          <div className="pf-screen">
            {/* live scan line sweeping the screen */}
            <span className="pf-screen-scan" aria-hidden="true" />
            {/* screen chrome */}
            <div className="pf-screen-top">
              <div className="pf-screen-traffic"><i /><i /><i /></div>
              <div className="pf-screen-tabs"><span className="is-active" /><span /><span /></div>
              <div className="pf-screen-live"><span className="pf-screen-live-dot" />LIVE</div>
            </div>
            <div className="pf-screen-body">
              {/* sidebar */}
              <div className="pf-screen-side">
                <span className="pf-screen-logo" />
                <span /><span /><span className="is-active" /><span /><span />
              </div>
              {/* content */}
              <div className="pf-screen-main">
                <div className="pf-screen-search" />
                <div className="pf-screen-grid">
                  <div className="pf-screen-card pf-screen-card-tall">
                    <Donut value={72} />
                    <div className="pf-screen-lines"><span /><span /><span /></div>
                  </div>
                  <div className="pf-screen-card">
                    <Donut value={48} small />
                  </div>
                  <div className="pf-screen-card">
                    <Donut value={88} small ring="muted" />
                  </div>
                  <div className="pf-screen-card pf-screen-card-rows">
                    <span /><span /><span /><span />
                  </div>
                  <div className="pf-screen-card pf-screen-card-bars">
                    <i style={{ '--h': '40%' }} />
                    <i style={{ '--h': '70%' }} />
                    <i style={{ '--h': '52%' }} />
                    <i style={{ '--h': '92%' }} className="is-peak" />
                    <i style={{ '--h': '62%' }} />
                    <i style={{ '--h': '78%' }} />
                    <i style={{ '--h': '46%' }} />
                  </div>
                  <div className="pf-screen-card pf-screen-card-wave">
                    <svg viewBox="0 0 120 40" preserveAspectRatio="none" fill="none">
                      <path className="pf-wave-base" d="M0 30 C 18 24, 26 12, 44 14 S 80 6, 98 10 S 116 4, 120 6"
                        stroke="rgba(243,106,30,0.35)" strokeWidth="2" strokeLinecap="round" />
                      <path className="pf-wave-pulse" d="M0 30 C 18 24, 26 12, 44 14 S 80 6, 98 10 S 116 4, 120 6"
                        stroke="#FF8A47" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="pf-monitor-neck" />
        <div className="pf-monitor-base" />
      </div>

      {/* Floating glass widgets over the monitor */}
      <div className="pf-float-chip pf-float-temp">
        <div className="pf-float-temp-top">
          <ThermoSvg />
          <span className="pf-float-chip-label">Living Room</span>
        </div>
        <span className="pf-float-chip-val">{temp}°C</span>
        <span className="pf-float-temp-bar"><i /></span>
      </div>
      <div className="pf-float-chip pf-float-net">
        <span className="pf-float-net-wifi" aria-hidden="true"><WifiSvg /></span>
        <span className="pf-float-net-text">
          <span className="pf-float-chip-label">Network Status</span>
          <span className="pf-float-chip-sub">Stable Connection</span>
          <span className="pf-float-net-bars"><i /><i /><i /><i /></span>
        </span>
      </div>
    </div>
  )
}

/* Tiny SVG donut chart used inside the screen mock. */
function Donut({ value = 70, small = false, ring = 'accent' }) {
  const r = 16
  const c = 2 * Math.PI * r
  const off = c * (1 - value / 100)
  const stroke = ring === 'muted' ? '#3a8fb0' : '#F36A1E'
  return (
    <svg className={'pf-donut' + (small ? ' pf-donut-sm' : '')} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <circle cx="22" cy="22" r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
      <circle cx="22" cy="22" r={r} stroke={stroke} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 22 22)" />
    </svg>
  )
}

/* =====================================================================
   Inline icon assets
   ===================================================================== */
function KioskMark({ dark = false }) {
  return (
    <svg className="pf-mark" width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#F36A1E" />
      <rect x="9"  y="11" width="8"  height="18" rx="2" fill="#fff" />
      <rect x="20" y="11" width="11" height="8"  rx="2" fill="#fff" fillOpacity="0.85" />
      <rect x="20" y="21" width="11" height="8"  rx="2" fill="#fff" />
    </svg>
  )
}
function ThermoSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 13.5V5a2 2 0 0 0-4 0v8.5a4 4 0 1 0 4 0z" stroke="#F36A1E" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="17" r="1.6" fill="#F36A1E" />
    </svg>
  )
}
function WifiSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" stroke="#168A52" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="19.2" r="1.4" fill="#168A52" />
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
function ChevronSvg() {
  return (
    <svg className="pf-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function CheckSvg({ big = false }) {
  return (
    <svg width={big ? 28 : 16} height={big ? 28 : 16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth={big ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function MailSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function PhoneSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V18a2 2 0 0 1-2 2A14 14 0 0 1 4 6a2 2 0 0 1 1-2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}
function PinSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21c5-5.5 7-8.5 7-12a7 7 0 1 0-14 0c0 3.5 2 6.5 7 12z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

/* =====================================================================
   Data
   ===================================================================== */
const HERO_STATS = [
  { value: '2.4k+', label: 'Devices Live' },
  { value: '99.9%', label: 'Uptime' },
  { value: '15ms',  label: 'Latency' },
]

const LIVE_FEEDS = [
  {
    title: 'CCTV Smart Grid', status: 'LIVE', tint: 'a',
    desc: 'Metropolitan surveillance with facial recognition and motion detection.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M3 8l13-3 1 4-13 3-1-4z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /><path d="M4 12v5h6v-3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="18" cy="9" r="2.4" stroke="#fff" strokeWidth="1.6" /></svg>,
  },
  {
    title: 'Industrial IoT Hub', status: 'ACTIVE', tint: 'b',
    desc: 'Real-time pressure and temperature monitoring for smart factories.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="5" width="14" height="14" rx="2" stroke="#fff" strokeWidth="1.6" /><path d="M9 9h6M9 12h6M9 15h3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Automated Robotics', status: 'STANDBY', tint: 'c',
    desc: 'Precision robotic arm control and telemetry via cloud infrastructure.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="8" y="3.5" width="8" height="6" rx="2" stroke="#fff" strokeWidth="1.6" /><path d="M12 9.5v5l-5 5M12 14.5l5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
]

const LOAD_BARS = [38, 54, 46, 66, 88, 58, 72, 50]

const SCALE_STATS = [
  { value: '10k+', label: 'Devices supported' },
  { value: '99.9%', label: 'Uptime SLA' },
  { value: '<15ms', label: 'Command latency' },
  { value: '24/7', label: 'Live monitoring' },
]

/* ----- Unified Control Dashboard (2nd section) -----
   Content mirrors the real product entities: Applications, Devices,
   Cameras, Dashboards, payloads (put/patch/post) over WebSocket. */
const S2_KPIS = [
  { label: 'Devices',      end: 248,  decimals: 0, suffix: '',  trend: '+12 online' },
  { label: 'Applications', end: 24,   decimals: 0, suffix: '',  trend: '6 live' },
  { label: 'Uptime',       end: 99.9, decimals: 1, suffix: '%', trend: 'stable' },
]

const S2_BARS = [42, 60, 50, 74, 64, 92, 70, 80, 58]

const STATUS_CARDS = [
  {
    title: 'Device Connected', sub: 'kiosk-front-01 · websocket', time: 'now', tint: 'orange',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Command Sent', sub: 'patch · payload/relay/power', time: '4s', tint: 'blue',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M5 8l4 4-4 4M12 16h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Camera Online', sub: 'cam1 · WebRTC · 3 viewers', time: '12s', tint: 'green',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M16 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Payload Updated', sub: 'put · temperature → 24.5°C', time: '34s', tint: 'honey',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Dashboard Published', sub: 'Lobby Display · role-secured', time: '1m', tint: 'violet',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="M3.5 9h17M8 21h8M12 17.5V21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
]

/* ----- Platform Introduction (3rd section) — capability cards ----- */
const CAPABILITIES = [
  {
    title: 'Centralized Management', tint: 'orange',
    desc: 'Apps, devices, cameras, dashboards, and roles in one place.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /></svg>,
  },
  {
    title: 'IoT Connectivity', tint: 'amber',
    desc: 'Connect devices by unique ID with live communication.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Live Camera Monitoring', tint: 'honey',
    desc: 'Watch camera streams from the web dashboard.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M16 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Custom Dashboards', tint: 'orange',
    desc: 'Build real-time widgets, charts, gauges, and controls.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h6M4 12h10M4 17h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="17" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.7" /><circle cx="18.5" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.7" /></svg>,
  },
  {
    title: 'Public Access Portal', tint: 'amber',
    desc: 'Public users open published apps — no login needed.',
    icon: <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="currentColor" strokeWidth="1.7" /></svg>,
  },
  {
    title: 'Role-Based Control', tint: 'honey',
    desc: 'Protect admin controls with roles and permissions.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
]

/* ----- Why This Product? (4th section) — business need points ----- */
const NEED_POINTS = [
  {
    title: 'Application Management', tint: 'orange',
    desc: 'Create, publish, and manage kiosk applications from a single interface.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M3 8h18M7 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Device Monitoring', tint: 'amber',
    desc: 'Track live device status and payload data in real time.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h3l2-5 4 10 2-5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Real-Time Control', tint: 'honey',
    desc: 'Send commands to connected hardware instantly using WebSocket.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Admin Security', tint: 'orange',
    desc: 'Role-based permissions protect internal controls from public access.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 11v3M9.5 11.5a2.5 2.5 0 1 1 5 0V13h-5v-1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Public Kiosk Access', tint: 'amber',
    desc: 'A simple, touch-friendly interface without exposing admin features.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M10 18.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Better Operations', tint: 'honey',
    desc: 'Cut manual work, speed up monitoring, and improve the kiosk experience.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M4 17l5-5 4 4 7-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 8h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
]

/* ----- Product Uniqueness (5th section) — dark feature cards ----- */
const UNIQUE_FEATURES = [
  {
    title: 'Centralized App Management',
    desc: 'All kiosk applications are managed from one place.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /></svg>,
  },
  {
    title: 'Real-Time IoT Control',
    desc: 'WebSocket-based live device command and response.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Drag-and-Drop Dashboard',
    desc: 'Custom widget designer with dynamic device binding.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="6.5" y="6.5" width="5" height="5" rx="1" fill="currentColor" /><path d="M14 7h4M14 10h4M6.5 15h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  },
  {
    title: 'Live Camera Integration',
    desc: 'Camera streams linked directly to kiosk applications.',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M16 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>,
  },
  {
    title: 'Public Dashboard Access',
    desc: 'No login required for public-facing kiosk portals.',
    icon: <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="currentColor" strokeWidth="1.7" /></svg>,
  },
  {
    title: 'Role-Based Security',
    desc: 'Granular permissions protect every admin function.',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
]

/* ----- Dashboard widget library (real widget types from the designer) ----- */
const WIDGET_CATS = [
  { name: 'Data Cards', count: 8 },
  { name: 'Controls', count: 11 },
  { name: 'Gauges & Dials', count: 6 },
  { name: 'Charts', count: 3 },
  { name: 'Tanks & Fills', count: 3 },
  { name: 'Logs', count: 3 },
]

const WIDGETS = [
  {
    name: 'Solid Gauge', cat: 'Gauge',
    preview: (
      <svg className="pf-wg-svg" viewBox="0 0 64 40" fill="none">
        <path d="M8 34 A24 24 0 0 1 56 34" stroke="rgba(20,22,28,0.10)" strokeWidth="6" strokeLinecap="round" />
        <path d="M8 34 A24 24 0 0 1 56 34" stroke="#F36A1E" strokeWidth="6" strokeLinecap="round" strokeDasharray="76" strokeDashoffset="29" />
      </svg>
    ),
  },
  {
    name: 'Toggle Card', cat: 'Control',
    preview: <span className="pf-wg-toggle"><i /></span>,
  },
  {
    name: 'Bar Chart', cat: 'Chart',
    preview: <span className="pf-wg-bars"><i style={{ height: '40%' }} /><i style={{ height: '70%' }} /><i style={{ height: '52%' }} /><i style={{ height: '90%' }} /></span>,
  },
  {
    name: 'Donut Chart', cat: 'Chart',
    preview: (
      <svg className="pf-wg-svg" viewBox="0 0 44 44" fill="none" style={{ width: '40px' }}>
        <circle cx="22" cy="22" r="15" stroke="rgba(20,22,28,0.10)" strokeWidth="7" />
        <circle cx="22" cy="22" r="15" stroke="#F36A1E" strokeWidth="7" strokeLinecap="round" strokeDasharray="94" strokeDashoffset="32" transform="rotate(-90 22 22)" />
      </svg>
    ),
  },
  {
    name: 'Level Tank', cat: 'Fill',
    preview: <span className="pf-wg-tank"><i style={{ height: '58%' }} /></span>,
  },
  {
    name: 'Battery', cat: 'Fill',
    preview: <span className="pf-wg-batt"><span className="pf-wg-batt-body"><i style={{ width: '68%' }} /></span><span className="pf-wg-batt-tip" /></span>,
  },
  {
    name: 'Level Control', cat: 'Control',
    preview: <span className="pf-wg-slider"><span className="pf-wg-slider-fill" style={{ width: '60%' }} /><span className="pf-wg-slider-knob" /></span>,
  },
  {
    name: 'Stepper', cat: 'Control',
    preview: <span className="pf-wg-stepper"><span>−</span><b>24</b><span>+</span></span>,
  },
  {
    name: 'Trend Card', cat: 'Data',
    preview: <span className="pf-wg-trend"><b>1.2k</b><em>▲ 8%</em></span>,
  },
  {
    name: 'Progress Card', cat: 'Data',
    preview: <span className="pf-wg-progwrap"><span className="pf-wg-prog"><i style={{ width: '72%' }} /></span></span>,
  },
  {
    name: 'Action Card', cat: 'Control',
    preview: <span className="pf-wg-btn">Run command</span>,
  },
  {
    name: 'Event Timeline', cat: 'Log',
    preview: (
      <span className="pf-wg-log">
        <span><i className="ok" /><b /></span>
        <span><i className="warn" /><b /></span>
        <span><i className="err" /><b /></span>
      </span>
    ),
  },
]

/* ----- Real-time control architecture ----- */
const FLOW = [
  {
    label: 'Admin Dashboard', sub: 'Web UI',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M3 8h18M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  },
  {
    label: 'WebSocket', sub: 'Live channel',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>,
  },
  {
    label: 'Backend Server', sub: 'Django API',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="3" y="14" width="18" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M7 7h.01M7 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  },
  {
    label: 'Connected Device', sub: 'Kiosk / IoT',
    icon: <svg viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  },
  {
    label: 'Live Response', sub: 'Instant',
    icon: <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2-6 4 13 2-7h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
]

const RT_CAPS = [
  'Receive live payload updates from devices',
  'Highlight changed values in real time',
  'Send command actions to devices',
  'Patch specific payload paths',
  'Delete selected payload fields',
  'Refresh latest payload from the device',
  'Automatically reconnect when connection drops',
  'Show command response instantly',
]
