import { Routes, Route, Navigate } from 'react-router-dom'
import SignIn from './pages/SignIn.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Users from './pages/Users.jsx'
import Roles from './pages/Roles.jsx'
import Profile from './pages/Profile.jsx'
import Cameras from './pages/Cameras.jsx'
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
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  )
}
