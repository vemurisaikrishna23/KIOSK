/**
 * Deterministic gradient + geometric-shape avatar generator.
 *
 * Same seed (user id / email / name) → same avatar, every time, everywhere
 * the user appears. Runs entirely client-side as inline SVG — no network
 * calls, no privacy leaks, no rate limits.
 *
 * The space is intentionally small (8 palettes × 6 patterns = 48 unique
 * combinations) so distinct users land on visually-different avatars
 * without the look getting noisy.
 */

const PALETTES = [
  ['#F36A1E', '#FFB082'], // brand peach → orange
  ['#1FAE6B', '#9CE3B6'], // mint green
  ['#4A7BFF', '#A4BEFF'], // sky blue
  ['#A65EB8', '#E5BBF0'], // grape
  ['#E0463D', '#F0978F'], // coral red
  ['#C77A14', '#F0C977'], // amber honey
  ['#1B998B', '#7FD4C8'], // teal
  ['#D63384', '#F0A3CB'], // rose pink
]

function djb2(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/* ----------------------- shape pattern set ----------------------- */
/* Each pattern returns one or more SVG nodes drawn over the gradient
   background.  Use light translucent whites so the design works across
   every palette without re-tuning per-color. */

function patternTwoBubbles(h) {
  const dx = (h % 6) - 2
  return [
    <circle key="a" cx={14 + dx} cy={14} r="6.5" fill="rgba(255,255,255,0.55)" />,
    <circle key="b" cx={32 - dx} cy={32} r="10"  fill="rgba(255,255,255,0.32)" />,
  ]
}
function patternHalfMoon(h) {
  const flip = (h % 2) === 0
  return (
    <path
      d={flip ? 'M0 24 a24 24 0 0 1 48 0 Z' : 'M0 24 a24 24 0 0 0 48 0 Z'}
      fill="rgba(255,255,255,0.28)"
    />
  )
}
function patternTriangles(h) {
  const skew = (h % 5) - 2
  return [
    <polygon key="a" points={`24,8 38,32 ${10 + skew},32`} fill="rgba(255,255,255,0.32)" />,
    <polygon key="b" points={`24,18 32,32 ${16 - skew},32`} fill="rgba(255,255,255,0.45)" />,
  ]
}
function patternDiamond(h) {
  const r = 14 + (h % 4)
  return [
    <polygon key="a" points={`24,${24 - r} ${24 + r},24 24,${24 + r} ${24 - r},24`} fill="rgba(255,255,255,0.30)" />,
    <circle key="b" cx="24" cy="24" r="4.5" fill="rgba(255,255,255,0.55)" />,
  ]
}
function patternWave(h) {
  const up = 6 + (h % 5)
  return (
    <path
      d={`M0 ${28 + up} Q 12 ${18 + up} 24 ${28 + up} T 48 ${28 + up} V 48 H 0 Z`}
      fill="rgba(255,255,255,0.33)"
    />
  )
}
function patternDotsCluster(h) {
  const j = (h % 4) - 1
  return [
    <circle key="a" cx={14 + j} cy="14" r="3.2" fill="rgba(255,255,255,0.55)" />,
    <circle key="b" cx={32 - j} cy="20" r="4.2" fill="rgba(255,255,255,0.40)" />,
    <circle key="c" cx={20 + j} cy="34" r="5.2" fill="rgba(255,255,255,0.30)" />,
  ]
}

const PATTERNS = [
  patternTwoBubbles,
  patternHalfMoon,
  patternTriangles,
  patternDiamond,
  patternWave,
  patternDotsCluster,
]

export default function Avatar({ seed = '', size = 36, title, className = '' }) {
  const s = String(seed || 'kiosk')
  const h = djb2(s)
  const [c1, c2] = PALETTES[h % PALETTES.length]
  const pattern = PATTERNS[Math.floor(h / PALETTES.length) % PATTERNS.length]
  const gradId = `av-g-${h}`

  return (
    <span
      className={'avatar-svg ' + className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={title || 'user avatar'}
      title={title}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="24" fill={`url(#${gradId})`} />
        {pattern(h)}
      </svg>
    </span>
  )
}
