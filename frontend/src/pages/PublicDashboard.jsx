import DashboardDetail from './DashboardDetail.jsx'

/**
 * Public-mode wrapper around DashboardDetail.
 *
 * Mounted at /public/applications/:appId/dashboards/:dashboardId so it
 * shares the same URL shape as the authenticated editor — just with a
 * /public prefix. DashboardDetail reads `useParams()` itself; we only
 * pass the `publicMode` flag which makes it:
 *   - skip the sign-in redirect
 *   - load via the public one-shot endpoint
 *   - treat the viewer as read-only (no edit / delete / preview)
 *   - hide the TopBar and theme picker
 *
 * WebSocket control still works — the dashboard WS doesn't require auth.
 */
export default function PublicDashboard() {
  return <DashboardDetail publicMode />
}
