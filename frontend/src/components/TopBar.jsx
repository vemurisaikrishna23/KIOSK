import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import Avatar from './Avatar.jsx'
import { auth } from '../lib/api.js'

const NAV = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Users',     to: '/users'     },
  { label: 'Roles',     to: '/roles'     },
  { label: 'Cameras',      to: '/cameras' },
  { label: 'Applications', to: '#' },
]

/**
 * Shared top bar used on every authenticated page.
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

  // Hamburger / drawer state for narrow viewports.
  const [menuOpen, setMenuOpen] = useState(false)

  // Auto-close the drawer when navigating to a different route, when the
  // viewport grows back to desktop size, or when Escape is pressed.
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false) }
    function onResize() { if (window.innerWidth > 920) setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  function logout() {
    auth.clear()
    navigate('/signin', { replace: true })
  }

  return (
    <header className={'kiosk-topbar' + (centerSlot ? '' : ' no-center') + (menuOpen ? ' menu-open' : '')}>
      <Link to="/dashboard" className="kiosk-brand" aria-label="myaccess home">
        <img src="/logos/myaccess.svg" alt="myaccess" className="logo-wordmark" />
      </Link>

      <nav className={'kiosk-nav' + (menuOpen ? ' is-open' : '')}>
        {NAV.map((n) =>
          n.to === '#' ? (
            <span
              key={n.label}
              className="nav-link is-disabled"
              aria-disabled="true"
              title="Coming soon"
            >
              {n.label}
            </span>
          ) : (
            <NavLink
              key={n.label}
              to={n.to}
              className={({ isActive }) =>
                'nav-link' + (isActive ? ' is-active' : '')
              }
              onClick={() => setMenuOpen(false)}
            >
              {n.label}
            </NavLink>
          )
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
