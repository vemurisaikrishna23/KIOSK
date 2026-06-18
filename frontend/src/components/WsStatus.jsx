/**
 * Shared WebSocket connection indicator.
 *
 * Props:
 *   status    — 'live' | 'connecting' | 'reconnecting' | 'offline' | 'idle'
 *               (also accepts 'connected' / 'disconnected' as aliases)
 *   liveLabel — text shown when connected (default "Live").
 *
 * There is no manual reconnect: every socket auto-retries with exponential
 * backoff until it reconnects, so the badge just reflects the live state.
 *
 * Uses the existing .ws-status / .ws-dot styles.
 */
export default function WsStatus({ status = 'idle', liveLabel = 'Live', className = '' }) {
  const norm = status === 'connected' ? 'live' : status === 'disconnected' ? 'offline' : status
  const text = norm === 'live' ? liveLabel
    : norm === 'connecting' ? 'Connecting…'
    : norm === 'reconnecting' ? 'Reconnecting…'
    : 'Offline'
  return (
    <span className={'ws-status ws-' + norm + (className ? ' ' + className : '')}>
      <span className="ws-dot" aria-hidden="true" />
      {text}
    </span>
  )
}
