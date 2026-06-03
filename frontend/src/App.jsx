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
import { auth } from './lib/api.js'

function RequireAuth({ children }) {
  return auth.isAuthenticated() ? children : <Navigate to="/signin" replace />
}

function RedirectIfAuthed({ children }) {
  return auth.isAuthenticated() ? <Navigate to="/dashboard" replace /> : children
}

export default function App() {
  return (
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
  )
}
