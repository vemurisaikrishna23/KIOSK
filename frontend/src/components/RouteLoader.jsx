import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

/* Same logo mark used by the landing-page intro loader. */
function KioskMark() {
  return (
    <svg className="pf-mark" width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#F36A1E" />
      <rect x="9"  y="11" width="8"  height="18" rx="2" fill="#fff" />
      <rect x="20" y="11" width="11" height="8"  rx="2" fill="#fff" fillOpacity="0.85" />
      <rect x="20" y="21" width="11" height="8"  rx="2" fill="#fff" />
    </svg>
  )
}

/**
 * RouteLoader — replays the landing page's intro-loader animation on every
 * route change (and on initial load) so all pages share the same loading
 * effect. Mounted once at the app root.
 *
 * The marketing landing route ("/") renders its own intro loader, so we
 * skip the global one there to avoid a double overlay.
 */
export default function RouteLoader() {
  const location = useLocation()
  const skip = location.pathname === '/'
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0) // bump per navigation → replays inner animations

  useEffect(() => {
    if (skip) return undefined
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setLoaded(false)
    setTick((n) => n + 1)
    const t = setTimeout(() => setLoaded(true), reduce ? 150 : 850)
    return () => clearTimeout(t)
  }, [location.pathname, skip])

  if (skip) return null

  return (
    <div className={'pf-loader app-route-loader' + (loaded ? ' is-done' : '')} aria-hidden={loaded} role="status">
      <div className="pf-loader-fx" aria-hidden="true">
        <span className="pf-loader-orb pf-loader-orb-a" />
        <span className="pf-loader-orb pf-loader-orb-b" />
      </div>
      <div className="pf-loader-inner" key={tick}>
        <div className="pf-loader-mark">
          <span className="pf-loader-ring" />
          <KioskMark />
        </div>
        <span className="pf-loader-name">Kiosk</span>
        <div className="pf-loader-bar"><span /></div>
        <span className="pf-loader-tag">Loading…</span>
      </div>
    </div>
  )
}
