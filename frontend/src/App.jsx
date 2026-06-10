import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import SignIn from './pages/SignIn.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Users from './pages/Users.jsx'
import Roles from './pages/Roles.jsx'
import Profile from './pages/Profile.jsx'
import Cameras from './pages/Cameras.jsx'
import Applications from './pages/Applications.jsx'
import ApplicationDetail from './pages/ApplicationDetail.jsx'
import DeviceDetail from './pages/DeviceDetail.jsx'
import DashboardDetail from './pages/DashboardDetail.jsx'
import PublicLanding from './pages/PublicLanding.jsx'
import PublicApplications from './pages/PublicApplications.jsx'
import PublicDashboard from './pages/PublicDashboard.jsx'
import SslCertificate from './pages/SslCertificate.jsx'
import RouteLoader from './components/RouteLoader.jsx'
import { auth } from './lib/api.js'

function RequireAuth({ children }) {
  return auth.isAuthenticated() ? children : <Navigate to="/signin" replace />
}

function RedirectIfAuthed({ children }) {
  return auth.isAuthenticated() ? <Navigate to="/dashboard" replace /> : children
}

/**
 * Kiosk lockdown — blocks right-click, text selection, drag, and the common
 * devtools / view-source keyboard shortcuts so the deployed kiosk behaves like
 * a sealed appliance. Form fields stay fully editable.
 */
function useKioskGuards() {
  useEffect(() => {
    const isEditable = (el) => {
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }

    const onContextMenu = (e) => { e.preventDefault() }
    const onSelectStart = (e) => { if (!isEditable(e.target)) e.preventDefault() }
    const onDragStart = (e) => { if (!isEditable(e.target)) e.preventDefault() }

    const onKeyDown = (e) => {
      const k = (e.key || '').toLowerCase()
      // F12 → devtools
      if (k === 'f12') { e.preventDefault(); return }
      // Ctrl/Cmd + Shift + I / J / C → devtools / inspector / console
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k)) {
        e.preventDefault(); return
      }
      // Ctrl/Cmd + U → view source
      if ((e.ctrlKey || e.metaKey) && k === 'u') { e.preventDefault(); return }
      // Ctrl/Cmd + S → save page (only outside editable fields)
      if ((e.ctrlKey || e.metaKey) && k === 's' && !isEditable(e.target)) {
        e.preventDefault()
      }
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('selectstart', onSelectStart)
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('selectstart', onSelectStart)
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

export default function App() {
  useKioskGuards()
  return (
    <>
    <RouteLoader />
    <Routes>
      <Route
        path="/signin"
        element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>}
      />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route
        path="/dashboard"
        element={<RequireAuth><Dashboard /></RequireAuth>}
      />
      <Route
        path="/users"
        element={<RequireAuth><Users /></RequireAuth>}
      />
      <Route
        path="/roles"
        element={<RequireAuth><Roles /></RequireAuth>}
      />
      <Route
        path="/profile"
        element={<RequireAuth><Profile /></RequireAuth>}
      />
      <Route
        path="/cameras"
        element={<RequireAuth><Cameras /></RequireAuth>}
      />
      <Route
        path="/applications"
        element={<RequireAuth><Applications /></RequireAuth>}
      />
      <Route
        path="/applications/:id"
        element={<RequireAuth><ApplicationDetail /></RequireAuth>}
      />
      <Route
        path="/applications/:appId/devices/:deviceId"
        element={<RequireAuth><DeviceDetail /></RequireAuth>}
      />
      <Route
        path="/applications/:appId/dashboards/:dashboardId"
        element={<RequireAuth><DashboardDetail /></RequireAuth>}
      />
      <Route
        path="/ssl-certificate"
        element={<RequireAuth><SslCertificate /></RequireAuth>}
      />
      {/* Public (no auth) — marketing landing + live demo list + view-only dashboard. */}
      <Route path="/" element={<PublicLanding />} />
      <Route path="/public" element={<PublicApplications />} />
      <Route
        path="/public/applications/:appId/dashboards/:dashboardId"
        element={<PublicDashboard />}
      />
      {/* Fallback: send unknown URLs to the public landing rather than
          to /signin, so visitors aren't pushed into an auth wall. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
