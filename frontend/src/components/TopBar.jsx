import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import Avatar from './Avatar.jsx'
import { auth } from '../lib/api.js'

const NAV = [
  { label: 'Dashboard',    to: '/dashboard' },
  { label: 'Users',        to: '/users'     },
  { label: 'Roles',        to: '/roles'     },
  { label: 'Cameras',      to: '/cameras' },
  { label: 'Applications', to: '/applications' },
  { label: 'SSL Cert',     to: '/ssl-certificate', perm: 'ssl_certificate_view' },
  { label: 'Contact',      to: '/contact-submissions', perm: 'contact_submission_view' },
  { label: 'Company',      to: '/company-information', perm: 'company_info_view' },
  // Hidden for now — Activity Log page. Re-enable by uncommenting.
  // { label: 'Activity',     to: '/activity-logs', perm: 'activity_log_view' },
]

// Must match the `.kiosk-nav` gap in CSS — used to measure item fit.
const NAV_GAP = 28
// Width reserved for the "More ▾" button (incl. trailing gap) when overflowing.
const MORE_RESERVE = 96

/**
 * Shared top bar used on every authenticated page.
 *
 * On desktop the nav shows as many items as fit on one line; any that would
 * overflow collapse into a "More ▾" dropdown (so links are never cut off).
 * On compact/tablet widths (≤960px) the whole nav moves behind a hamburger.
 *
 * Props:
 *   centerSlot — optional React node placed between the nav and the user
 *                info (e.g. the Dashboard's Live/History pill).
 */
export default function TopBar({ centerSlot = null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = auth.getUser()
  const displayName = user?.name || user?.email || 'User'
  const roleName = user?.roles?.[0]?.name || 'Member'

  const items = NAV.filter((n) => !n.perm || auth.hasPerm(n.perm))

  // Hamburger / drawer state for narrow viewports.
  const [menuOpen, setMenuOpen] = useState(false)
  // "More" overflow dropdown state (desktop).
  const [moreOpen, setMoreOpen] = useState(false)
  // How many nav items fit inline; the rest go into "More".
  const [visibleCount, setVisibleCount] = useState(items.length)
  // Whether we're in the compact (hamburger) breakpoint.
  const [isCompact, setIsCompact] = useState(
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 960px)').matches
      : false,
  )

  const navRef = useRef(null)
  const burgerRef = useRef(null)
  const measureRef = useRef(null)
  const moreRef = useRef(null)

  // Track the compact breakpoint (hamburger takes over there).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)')
    const onChange = () => setIsCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Measure how many items fit on the nav line; overflow → "More".
  useLayoutEffect(() => {
    if (isCompact) { setVisibleCount(items.length); return undefined }
    const nav = navRef.current
    const measure = measureRef.current
    if (!nav || !measure) return undefined

    let cancelled = false
    const recompute = () => {
      if (cancelled) return
      const avail = nav.clientWidth
      if (!avail) return
      const widths = Array.from(measure.children).map(
        (el) => el.getBoundingClientRect().width,
      )
      const totalAll =
        widths.reduce((a, b) => a + b, 0) + NAV_GAP * Math.max(0, widths.length - 1)
      if (totalAll <= avail) { setVisibleCount(widths.length); return }
      let used = 0
      let count = 0
      for (let i = 0; i < widths.length; i++) {
        const add = widths[i] + (count > 0 ? NAV_GAP : 0)
        if (used + add + NAV_GAP + MORE_RESERVE <= avail) {
          used += add
          count++
        } else break
      }
      setVisibleCount(count)
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(nav)
    window.addEventListener('resize', recompute)
    // Re-measure once the web font finishes loading (widths can shift).
    if (document.fonts?.ready) document.fonts.ready.then(recompute)
    return () => {
      cancelled = true
      ro.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [isCompact, items.length])

  // Close the drawer / More menu when navigating to a different route.
  useEffect(() => { setMenuOpen(false); setMoreOpen(false) }, [location.pathname])

  // Escape closes both popups.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { setMenuOpen(false); setMoreOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close the mobile drawer on any click/tap outside the menu (and burger).
  useEffect(() => {
    if (!menuOpen) return undefined
    function onPointerDown(e) {
      const t = e.target
      if (navRef.current?.contains(t)) return
      if (burgerRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  // Close the "More" dropdown on outside click.
  useEffect(() => {
    if (!moreOpen) return undefined
    function onPointerDown(e) {
      if (moreRef.current?.contains(e.target)) return
      setMoreOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [moreOpen])

  function logout() {
    auth.clear()
    navigate('/signin', { replace: true })
  }

  function renderLink(n) {
    if (n.to === '#') {
      return (
        <span
          key={n.label}
          className="nav-link is-disabled"
          aria-disabled="true"
          title="Coming soon"
        >
          {n.label}
        </span>
      )
    }
    return (
      <NavLink
        key={n.label}
        to={n.to}
        className={({ isActive }) => 'nav-link' + (isActive ? ' is-active' : '')}
        onClick={() => { setMenuOpen(false); setMoreOpen(false) }}
      >
        {n.label}
      </NavLink>
    )
  }

  const visibleItems = isCompact ? items : items.slice(0, visibleCount)
  const overflowItems = isCompact ? [] : items.slice(visibleCount)
  const moreActive = overflowItems.some(
    (n) => n.to !== '#' && location.pathname.startsWith(n.to),
  )

  return (
    <header className={'kiosk-topbar' + (centerSlot ? '' : ' no-center') + (menuOpen ? ' menu-open' : '')}>
      <Link to="/dashboard" className="kiosk-brand" aria-label="myaccess home">
        <img src="/logos/myaccess.svg" alt="myaccess" className="logo-wordmark" />
      </Link>

      <nav ref={navRef} id="kiosk-nav-drawer" className={'kiosk-nav' + (menuOpen ? ' is-open' : '')}>
        {/* Hidden measurement row — all items, used to compute how many fit. */}
        <div className="kiosk-nav-measure" ref={measureRef} aria-hidden="true">
          {items.map((n) => (
            <span key={n.label} className="nav-link">{n.label}</span>
          ))}
        </div>

        {visibleItems.map((n) => renderLink(n))}

        {overflowItems.length > 0 && (
          <div className={'kiosk-more' + (moreOpen ? ' is-open' : '')} ref={moreRef}>
            <button
              type="button"
              className={'nav-link kiosk-more-btn' + (moreActive ? ' is-active' : '')}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              More <span className="kiosk-more-chev" aria-hidden="true">▾</span>
            </button>
            {moreOpen && (
              <div className="kiosk-more-menu" role="menu">
                {overflowItems.map((n) => renderLink(n))}
              </div>
            )}
          </div>
        )}
      </nav>

      {centerSlot ? <div className="kiosk-center-slot">{centerSlot}</div> : null}

      <div className="kiosk-top-right">
        <Link to="/profile" className="kiosk-user" aria-label="Open profile">
          <div className="name">{displayName}</div>
          <div className="sub">{roleName}</div>
        </Link>
        <Link to="/profile" aria-label="Open profile" className="kiosk-avatar-link">
          <Avatar
            seed={user?.id ?? user?.email ?? displayName}
            size={38}
            title={displayName}
            className="kiosk-avatar"
          />
        </Link>
        <button type="button" className="btn-logout" onClick={logout}>Log out</button>
        <button
          ref={burgerRef}
          type="button"
          className="kiosk-burger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="kiosk-nav-drawer"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className={'burger-bar' + (menuOpen ? ' a' : '')} />
          <span className={'burger-bar' + (menuOpen ? ' b' : '')} />
          <span className={'burger-bar' + (menuOpen ? ' c' : '')} />
        </button>
      </div>

      {menuOpen && (
        <button
          type="button"
          className="kiosk-nav-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </header>
  )
}
