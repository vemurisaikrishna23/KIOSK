import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Responsive, WidthProvider } from 'react-grid-layout'
import TopBar from '../components/TopBar.jsx'
import { PermissionDenied } from './Cameras.jsx'
import { api, auth, ApiError, parseApiErrors } from '../lib/api.js'

const ResponsiveGrid = WidthProvider(Responsive)

/* Container 2's drag/resize grid mirrors the visible cell grid exactly:
   11 cols × 7 rows, 6 px gap. RGL needs cols + rowHeight in pixels; we
   measure the container at runtime and compute rowHeight so RGL items
   land on the exact same cells the user sees. */
/* Container 2 grid — fixed-size square cells (50 × 50 px) with a 6 px
   gutter. The number of columns and rows adapts to whatever fits in
   the container so cells always look identical across viewports. */
const C2_CELL_SIZE = 50
const C2_GAP = 6
const C2_MIN_ROWS = 7
const C2_BREAKPOINTS = { lg: 1, md: 0 }   // single breakpoint — geometry is identical at all sizes
const C2_RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne']
// Fixed column count — keeps every saved widget at the same width
// proportion regardless of the dashboard panel's actual pixel width.
// A widget at w=4 always occupies 4/12 of the panel; cells scale
// horizontally with the container. Previously we measured the container
// and varied this, which made the same w-value look very different
// after a window resize / HMR / parent layout change.
const C2_COLS = 12
const DEFAULT_WIDGET_LAYOUT = { w: 4, h: 3, minW: 3, minH: 2 }

/* Per-variant default + minimum sizes (in cell units).
   minW/minH stop the card from being resized below a readable size.
   Defaults set the size when a fresh widget is dropped on the grid. */
const VARIANT_LAYOUT_DEFAULTS = {
  simple_value:        { w: 4, h: 3, minW: 3, minH: 3 },
  simple_icon:         { w: 4, h: 3, minW: 4, minH: 3 },
  comparison:          { w: 5, h: 3, minW: 4, minH: 3 },
  multivalue_grid:     { w: 6, h: 4, minW: 5, minH: 4 },
  multivalue_row:      { w: 6, h: 3, minW: 5, minH: 3 },
  multivalue_assorted: { w: 5, h: 3, minW: 4, minH: 3 },
  trend:               { w: 4, h: 3, minW: 4, minH: 3 },
  progress:            { w: 4, h: 3, minW: 3, minH: 3 },
  status:              { w: 4, h: 3, minW: 3, minH: 3 },
}
function variantLayoutDefaults(variant) {
  return (variant && VARIANT_LAYOUT_DEFAULTS[variant]) || DEFAULT_WIDGET_LAYOUT
}
function getWidgetLayout(c, idx, cols = 11) {
  const variant = c?.config?.variant
  const defaults = variantLayoutDefaults(variant)
  const stored = c?.config?.layout
  if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
    return {
      i: String(c.id),
      x: stored.x,
      y: stored.y,
      w: Math.max(defaults.minW, stored.w ?? defaults.w),
      h: Math.max(defaults.minH, stored.h ?? defaults.h),
      minW: defaults.minW,
      minH: defaults.minH,
    }
  }
  const perRow = Math.max(1, Math.floor(cols / defaults.w))
  return {
    i: String(c.id),
    x: (idx % perRow) * defaults.w,
    y: Math.floor(idx / perRow) * defaults.h,
    w: defaults.w,
    h: defaults.h,
    minW: defaults.minW,
    minH: defaults.minH,
  }
}

/* Preset palettes — card backgrounds + icon glyph colors. Tuned to
   match the reference: vibrant warm-peach gradients (Music/Temperature
   card vibe) + a fresh mint-green (Wi-Fi card vibe), plus more options
   in the same family so dashboards can vary without clashing. */
const CARD_COLORS = [
  // Warm peaches & creams
  { id: 'peach',    label: 'Peach',    bg: 'linear-gradient(135deg, #FFE9CE 0%, #FBC890 100%)', text: '#4A2E18', sub: '#9A6A40' },
  { id: 'apricot',  label: 'Apricot',  bg: 'linear-gradient(135deg, #FFE0B8 0%, #F8B373 100%)', text: '#4A2A0E', sub: '#9F6730' },
  { id: 'coral',    label: 'Coral',    bg: 'linear-gradient(135deg, #FFD3C0 0%, #F8A78D 100%)', text: '#4A1E14', sub: '#9B5849' },
  { id: 'rose',     label: 'Rose',     bg: 'linear-gradient(135deg, #FCDDE2 0%, #F4B0BB 100%)', text: '#4A1A26', sub: '#9F5566' },
  { id: 'cream',    label: 'Cream',    bg: 'linear-gradient(135deg, #FBF3E2 0%, #E9D5AC 100%)', text: '#3D2A18', sub: '#7F6536' },
  { id: 'sand',     label: 'Sand',     bg: 'linear-gradient(135deg, #F2E6CC 0%, #D6B889 100%)', text: '#3D2810', sub: '#7E5C30' },
  // Fresh greens (Wi-Fi card vibe)
  { id: 'mint',     label: 'Mint',     bg: 'linear-gradient(135deg, #DEF2E0 0%, #A4DDAB 100%)', text: '#173B22', sub: '#476D4F' },
  { id: 'sage',     label: 'Sage',     bg: 'linear-gradient(135deg, #DCE9D2 0%, #A5C895 100%)', text: '#23381A', sub: '#5C7546' },
  { id: 'aqua',     label: 'Aqua',     bg: 'linear-gradient(135deg, #D5EEED 0%, #97D2D2 100%)', text: '#0F343A', sub: '#3E7376' },
  // Cool tones
  { id: 'sky',      label: 'Sky',      bg: 'linear-gradient(135deg, #DCEAFC 0%, #A0C5F1 100%)', text: '#0F2E50', sub: '#406A92' },
  { id: 'lavender', label: 'Lavender', bg: 'linear-gradient(135deg, #E8E0F5 0%, #BDA9E0 100%)', text: '#2A1D52', sub: '#5F4B8F' },
  // Neutrals
  { id: 'slate',    label: 'Slate',    bg: 'linear-gradient(135deg, #E6EBF2 0%, #B8C3D2 100%)', text: '#22293A', sub: '#586377' },
  { id: 'charcoal', label: 'Charcoal', bg: 'linear-gradient(135deg, #3D3935 0%, #58504A 100%)', text: '#F4ECE0', sub: '#B6AC9D' },
  { id: 'white',    label: 'White',    bg: '#FFFFFF',                                          text: '#14161C', sub: '#9AA1AE' },
  // Bold dark→light gradients (the "starts dark, fades light" look from
  // the reference Music/Temperature cards). All keep dark text against
  // the lighter end of the gradient, which is where the data sits.
  { id: 'sunset',   label: 'Sunset',   bg: 'linear-gradient(135deg, #FFAA70 0%, #FFE9CE 100%)', text: '#3D1E0A', sub: '#8B5A35' },
  { id: 'twilight', label: 'Twilight', bg: 'linear-gradient(135deg, #B59FE2 0%, #F0E8FB 100%)', text: '#2A1858', sub: '#6B5A95' },
  { id: 'forest',   label: 'Forest',   bg: 'linear-gradient(135deg, #7BB991 0%, #E2F2E8 100%)', text: '#16402A', sub: '#456E58' },
  { id: 'ocean',    label: 'Ocean',    bg: 'linear-gradient(135deg, #88B5E8 0%, #E2EEFB 100%)', text: '#0F2D52', sub: '#4D6E94' },
  { id: 'berry',    label: 'Berry',    bg: 'linear-gradient(135deg, #E89AAA 0%, #FCE2E7 100%)', text: '#4A1A2C', sub: '#945362' },
  { id: 'caramel',  label: 'Caramel',  bg: 'linear-gradient(135deg, #C19272 0%, #F8EAD8 100%)', text: '#3A2510', sub: '#7F5A36' },
  { id: 'plum',     label: 'Plum',     bg: 'linear-gradient(135deg, #A57CC2 0%, #EEE6F8 100%)', text: '#2A1052', sub: '#6B4A8F' },
]
const ICON_COLORS = [
  { id: 'orange', label: 'Orange', hex: '#F36A1E' },
  { id: 'amber',  label: 'Amber',  hex: '#D89834' },
  { id: 'green',  label: 'Green',  hex: '#1FAE6B' },
  { id: 'teal',   label: 'Teal',   hex: '#0D9488' },
  { id: 'blue',   label: 'Blue',   hex: '#2D6EE0' },
  { id: 'indigo', label: 'Indigo', hex: '#6B4FCC' },
  { id: 'pink',   label: 'Pink',   hex: '#D946A0' },
  { id: 'slate',  label: 'Slate',  hex: '#475569' },
]
function getCardColor(id)   { return CARD_COLORS.find((c) => c.id === id) || CARD_COLORS[0] }
function getIconColor(id)   { return ICON_COLORS.find((c) => c.id === id) || ICON_COLORS[0] }

/* Repeating SVG tile patterns — layered as a background-image over
   the card gradient at very low opacity so they read as texture, not
   decoration (matches the reference Temperature card). Tile sizes are
   intentionally small (24–80 px) so elements feel clustered. Inspired
   by Hero Patterns (heropatterns.com) — public domain / CC0. The CSS
   wrapper opacity (.cv-pattern) further dampens the whole layer so the
   pattern stays subtle on every palette. `__COLOR__` is replaced with
   the card's text color so the pattern follows the palette. */
/* All tiles are intentionally large (90–130 px) with multiple shapes
   placed at non-grid positions. The repeat still tiles, but because
   shapes inside one tile don't sit on a regular grid the eye reads
   it as scattered/random instead of striped rows. Combined with the
   very low overlay opacity in .cv-pattern, the result is the "barely
   there" texture seen on the reference Temperature card. */
const PATTERNS = [
  { id: '',         label: 'None',     size: 0,  svg: null },
  {
    id: 'twinkle',  label: 'Twinkle',  size: 130,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='130' height='130' viewBox='0 0 130 130'>
      <g fill='__COLOR__'>
        <path opacity='0.50' d='M18 22 L19.4 26 L23 27 L19.4 28 L18 32 L16.6 28 L13 27 L16.6 26 Z'/>
        <path opacity='0.35' d='M83 14 L84 17 L87 18 L84 19 L83 22 L82 19 L79 18 L82 17 Z'/>
        <path opacity='0.45' d='M42 58 L43.2 61 L46 62 L43.2 63 L42 66 L40.8 63 L38 62 L40.8 61 Z'/>
        <path opacity='0.30' d='M104 50 L105 52 L107 53 L105 54 L104 56 L103 54 L101 53 L103 52 Z'/>
        <path opacity='0.45' d='M60 102 L61 104 L63 105 L61 106 L60 108 L59 106 L57 105 L59 104 Z'/>
        <path opacity='0.40' d='M22 90 L23 93 L26 94 L23 95 L22 98 L21 95 L18 94 L21 93 Z'/>
        <path opacity='0.30' d='M114 110 L115 112 L117 113 L115 114 L114 116 L113 114 L111 113 L113 112 Z'/>
        <circle opacity='0.25' cx='66' cy='36' r='0.8'/>
        <circle opacity='0.30' cx='10' cy='62' r='0.8'/>
        <circle opacity='0.25' cx='96' cy='80' r='0.8'/>
        <circle opacity='0.25' cx='52' cy='124' r='0.8'/>
        <circle opacity='0.25' cx='124' cy='30' r='0.8'/>
      </g></svg>`,
  },
  {
    id: 'jupiter',  label: 'Jupiter',  size: 90,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'>
      <g fill='__COLOR__'>
        <circle opacity='0.40' cx='12' cy='18' r='1.1'/>
        <circle opacity='0.30' cx='44' cy='8' r='0.9'/>
        <circle opacity='0.35' cx='70' cy='32' r='1'/>
        <circle opacity='0.30' cx='28' cy='52' r='0.9'/>
        <circle opacity='0.35' cx='80' cy='66' r='1'/>
        <circle opacity='0.30' cx='14' cy='78' r='0.9'/>
        <circle opacity='0.30' cx='54' cy='80' r='0.9'/>
      </g></svg>`,
  },
  {
    id: 'bubbles',  label: 'Bubbles',  size: 110,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'>
      <g fill='none' stroke='__COLOR__' stroke-width='0.7'>
        <circle opacity='0.35' cx='16' cy='22' r='3.2'/>
        <circle opacity='0.25' cx='82' cy='14' r='1.6'/>
        <circle opacity='0.30' cx='48' cy='44' r='2.2'/>
        <circle opacity='0.30' cx='94' cy='62' r='2.6'/>
        <circle opacity='0.28' cx='28' cy='78' r='1.8'/>
        <circle opacity='0.30' cx='68' cy='96' r='2'/>
        <circle opacity='0.25' cx='10' cy='98' r='1.2'/>
      </g></svg>`,
  },
  {
    id: 'plus',     label: 'Plus',     size: 100,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'>
      <g stroke='__COLOR__' stroke-width='0.8' stroke-linecap='round' fill='none'>
        <path opacity='0.30' d='M16 12 V18 M13 15 H19'/>
        <path opacity='0.28' d='M64 28 V34 M61 31 H67'/>
        <path opacity='0.30' d='M34 52 V58 M31 55 H37'/>
        <path opacity='0.25' d='M86 64 V70 M83 67 H89'/>
        <path opacity='0.30' d='M14 78 V84 M11 81 H17'/>
        <path opacity='0.28' d='M56 90 V96 M53 93 H59'/>
      </g></svg>`,
  },
  {
    id: 'confetti', label: 'Confetti', size: 120,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>
      <g fill='__COLOR__'>
        <circle opacity='0.30' cx='14' cy='18' r='1.2'/>
        <rect opacity='0.28' x='62' y='14' width='2.2' height='2.2' rx='0.5' transform='rotate(20 63 15)'/>
        <path opacity='0.35' d='M90 30 L91 32 L93 33 L91 34 L90 36 L89 34 L87 33 L89 32 Z'/>
        <circle opacity='0.25' cx='38' cy='44' r='0.9'/>
        <rect opacity='0.25' x='8' y='62' width='2' height='2' rx='0.4' transform='rotate(-15 9 63)'/>
        <circle opacity='0.30' cx='100' cy='70' r='1'/>
        <path opacity='0.30' d='M50 84 L51 86 L53 87 L51 88 L50 90 L49 88 L47 87 L49 86 Z'/>
        <circle opacity='0.25' cx='72' cy='102' r='1.1'/>
        <rect opacity='0.28' x='20' y='100' width='2.2' height='2.2' rx='0.5' transform='rotate(10 21 101)'/>
      </g></svg>`,
  },
  {
    id: 'diamonds', label: 'Diamonds', size: 100,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'>
      <g fill='__COLOR__'>
        <path opacity='0.28' d='M18 16 L22 20 L18 24 L14 20 Z'/>
        <path opacity='0.22' d='M70 12 L73 15 L70 18 L67 15 Z'/>
        <path opacity='0.26' d='M44 46 L48 50 L44 54 L40 50 Z'/>
        <path opacity='0.24' d='M84 60 L87 63 L84 66 L81 63 Z'/>
        <path opacity='0.28' d='M22 80 L26 84 L22 88 L18 84 Z'/>
        <path opacity='0.22' d='M62 88 L65 91 L62 94 L59 91 Z'/>
      </g></svg>`,
  },
  {
    id: 'waves',    label: 'Waves',    size: 130,
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='130' height='90' viewBox='0 0 130 90'>
      <g stroke='__COLOR__' stroke-width='0.8' fill='none'>
        <path opacity='0.30' d='M-5 22 Q20 10 45 22 T 95 22 T 145 22'/>
        <path opacity='0.20' d='M-5 58 Q25 46 55 58 T 115 58 T 175 58'/>
      </g></svg>`,
  },
]
function getPattern(id) { return PATTERNS.find((p) => p.id === id) || PATTERNS[0] }
function makePatternUrl(svg, color) {
  if (!svg) return null
  const filled = svg.replace(/__COLOR__/g, color)
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(filled.replace(/\s+/g, ' ').trim())}")`
}
/* Pattern value is either a built-in preset id (e.g. 'twinkle') or a
   full URL to an SVG hosted somewhere (Hero Patterns, Iconify, your
   own backend, etc.). Detect URL vs id so the renderer can do the
   right thing. */
function isPatternUrl(p) {
  return typeof p === 'string' && /^(https?:\/\/|\/)/.test(p)
}
function hexToRgba(hex, alpha = 0.18) {
  const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6})$/i)
  if (!m) return `rgba(243, 106, 30, ${alpha})`
  const v = m[1]
  const r = parseInt(v.slice(0,2),16), g = parseInt(v.slice(2,4),16), b = parseInt(v.slice(4,6),16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
function cardStyleFor(colorId) {
  const c = getCardColor(colorId)
  return {
    background: c.bg,
    color: c.text,
    '--cv-sub-color': c.sub,
  }
}

/* =====================================================================
   DashboardDetail
   ---------------
   Static "Smart CCTV" dashboard layout matching the reference mockup.
   The only piece bound to real data is the top-left camera tile, which
   plays back whatever cameras are linked to the parent application.
   Everything else (music player, temperature, Wi-Fi, lights, speaker,
   AC) is dummy content for visual demonstration.

   Layout:
     ┌────────────────────────┬────────────────────────┐
     │                        │  music                 │
     │   camera (real)        ├────────────┬───────────┤
     │                        │  temp      │  wifi     │
     ├────────────────────────┴────────────┴───────────┤
     │  light       │   speaker    │   air conditioner │
     └─────────────────────────────────────────────────┘

   Cards scale fluidly with the viewport via `1fr` grid tracks; the
   layout never reflows so alignment stays exactly as designed.
   ===================================================================== */

export default function DashboardDetail() {
  const { appId, dashboardId } = useParams()
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView   = auth.hasPerm('application_view')
  const canUpdate = auth.hasPerm('application_update')
  const canDelete = auth.hasPerm('application_delete')

  const [dashboard, setDashboard] = useState(null)
  const [appCameras, setAppCameras] = useState([])
  const [allCameras, setAllCameras] = useState([])
  const [devices, setDevices]       = useState([])
  const [components, setComponents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCamId, setSelectedCamId] = useState(null)
  const [previewMode, setPreviewMode] = useState(false)
  const previewShellRef = useRef(null)
  const [widgetModal, setWidgetModal] = useState(null)     // {mode:'create'|'edit', form}
  const [pickerOpen, setPickerOpen] = useState(false)      // category-picker popup (opens from "+")
  const [editingWidget, setEditingWidget] = useState(null) // existing card-widget being edited
  const [confirmDelete, setConfirmDelete] = useState(null) // component being deleted
  const [toast, setToast] = useState(null)

  // Container 2 grid geometry — column count is fixed (see C2_COLS).
  // The visible cell grid renders C2_COLS columns with `1fr` widths so
  // every cell takes an equal share of the panel. Row height stays at
  // 50 px so vertical units feel consistent.
  const c2Cols = C2_COLS
  const c2RowH = C2_CELL_SIZE

  // Persist drag / resize back to the server by patching each widget's
  // config.layout = {x, y, w, h}. Two modes:
  //   - debounced (default 200 ms) — used by onLayoutChange so rapid
  //     intermediate layouts don't spam the backend
  //   - immediate flush — used by onDragStop / onResizeStop so the
  //     moment the user lets go, the position is committed
  //
  // A per-widget sequence counter guards against out-of-order PATCH
  // responses: if a newer flushLayout was issued before an older one
  // returned, the older response is discarded so it can't overwrite
  // the newer in-memory layout with stale server data.
  const layoutPersistRef = useRef({})
  const layoutSeqRef = useRef({})
  const flushLayout = useCallback(async (id, x, y, w, h) => {
    const target = components.find((c) => String(c.id) === String(id))
    if (!target) return
    const nextConfig = { ...(target.config || {}), layout: { x, y, w, h } }
    const mySeq = (layoutSeqRef.current[id] || 0) + 1
    layoutSeqRef.current[id] = mySeq
    try {
      const resp = await api.updateDashboardComponent(target.id, { config: nextConfig })
      // A newer flush already happened — drop this stale response.
      if (layoutSeqRef.current[id] !== mySeq) return
      const updated = resp?.component
      if (updated) setComponents((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch {/* keep on-screen position; user can drag again to retry */}
  }, [components])
  const persistWidgetLayout = useCallback((id, x, y, w, h) => {
    const sig = `${x},${y},${w},${h}`
    if (layoutPersistRef.current[id]?.sig === sig) return
    // Also bail out if the layout matches what the server already has
    // (i.e. the initial-mount onLayoutChange that re-emits the saved
    // positions). Avoids spurious PATCHes on every page load.
    const target = components.find((c) => String(c.id) === String(id))
    const saved = target?.config?.layout
    if (saved && saved.x === x && saved.y === y && saved.w === w && saved.h === h) {
      layoutPersistRef.current[id] = { sig, timer: null }
      return
    }
    if (layoutPersistRef.current[id]?.timer) clearTimeout(layoutPersistRef.current[id].timer)
    const timer = setTimeout(() => { flushLayout(id, x, y, w, h) }, 200)
    layoutPersistRef.current[id] = { sig, timer }
  }, [flushLayout, components])
  const commitWidgetLayoutNow = useCallback((id, x, y, w, h) => {
    // Cancel any pending debounced save for this id and PATCH right now.
    if (layoutPersistRef.current[id]?.timer) clearTimeout(layoutPersistRef.current[id].timer)
    layoutPersistRef.current[id] = { sig: `${x},${y},${w},${h}`, timer: null }
    flushLayout(id, x, y, w, h)
  }, [flushLayout])

  // RGL layout lives as state so the snap result from a drag isn't
  // immediately overwritten by a stale derived value on the next render.
  // We seed from components on mount + when components change, but
  // preserve any user-positioned entries already in state — only new
  // components get a fresh default position.
  const [c2Layout, setC2Layout] = useState([])
  useEffect(() => {
    setC2Layout((prev) => {
      const prevById = new Map(prev.map((l) => [l.i, l]))
      return components.map((c, idx) => {
        const existing = prevById.get(String(c.id))
        if (existing) return existing
        return getWidgetLayout(c, idx, c2Cols)
      })
    })
  }, [components, c2Cols])

  // The number of rows the visible cell grid renders. Defaults to 7
  // when there are no widgets, then grows to fit whatever widgets the
  // user has placed below the default region. Container scrolls
  // vertically when this exceeds the visible stage height.
  // c2Rows = how many rows the cell grid renders. Only grows when
  // a widget extends past the visible area. The CSS-`auto-fill` cell
  // grid handles the default fit; we still need this number to size
  // the scrollable stage content and to inform RGL.
  // c2Rows = how many rows the cell grid renders. The visible default
  // is C2_MIN_ROWS; the grid only extends below that when a widget
  // genuinely occupies a lower row. No buffer / no empty extras.
  const c2Rows = useMemo(() => {
    let maxBottom = 0
    for (const it of c2Layout) maxBottom = Math.max(maxBottom, (it.y || 0) + (it.h || 0))
    return Math.max(C2_MIN_ROWS, maxBottom)
  }, [c2Layout])

  const c2StageH = c2Rows * C2_CELL_SIZE + Math.max(0, c2Rows - 1) * C2_GAP

  function onC2LayoutChange(curr) {
    // Immediate UI update — RGL now has snapped (integer) x/y/w/h, so
    // the widget lands on the nearest cell instead of holding the mid-
    // drag pixel position.
    setC2Layout(curr)
    for (const item of curr) {
      persistWidgetLayout(item.i, item.x, item.y, item.w, item.h)
    }
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Esc exits preview — common pattern for fullscreen-style views.
  useEffect(() => {
    if (!previewMode) return undefined
    const handler = (e) => { if (e.key === 'Escape') setPreviewMode(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewMode])

  // Scale-to-fit in preview: the dashboard is laid out at its natural
  // ~1480 × 760 px size and a CSS transform shrinks it to fit the viewport
  // while keeping the exact layout (no card reflow, no cuts, no headers).
  useEffect(() => {
    const shell = previewShellRef.current
    if (!shell) return undefined
    if (!previewMode) {
      shell.style.transform = ''
      return undefined
    }
    function fit() {
      const baseW = 1480
      const baseH = 760
      const innerW = Math.max(320, window.innerWidth)
      const innerH = Math.max(320, window.innerHeight)
      const scale = Math.min(1, innerW / baseW, innerH / baseH)
      shell.style.transform = `translate(-50%, -50%) scale(${scale})`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [previewMode])

  /* ---- loaders ---- */
  const loadAll = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const [d, links, devs, comps] = await Promise.all([
        api.getDashboard(dashboardId),
        api.listAppCameras({ application: appId }),
        api.listDevices({ application: appId }),
        api.listDashboardComponents({ dashboard: dashboardId }),
      ])
      setDashboard(d)
      setAppCameras(links?.links ?? (Array.isArray(links) ? links : []))
      setDevices(devs?.devices ?? (Array.isArray(devs) ? devs : []))
      setComponents(comps?.components ?? (Array.isArray(comps) ? comps : []))
    } catch (e) {
      if (e?.status === 404) setError('Dashboard not found.')
      else if (e?.network)  setError('Could not reach the server.')
      else                  setError('Failed to load dashboard.')
    } finally {
      setLoading(false)
    }
  }, [appId, dashboardId, canView])

  const reloadComponents = useCallback(async () => {
    try {
      const comps = await api.listDashboardComponents({ dashboard: dashboardId })
      setComponents(comps?.components ?? (Array.isArray(comps) ? comps : []))
    } catch {}
  }, [dashboardId])

  const loadCatalog = useCallback(async () => {
    if (!canView) return
    try {
      const resp = await api.listCameras()
      const list = resp?.cameras ?? (Array.isArray(resp) ? resp : (resp?.results || []))
      setAllCameras(list)
    } catch {
      setAllCameras([])
    }
  }, [canView])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  // Stable key over the current set of (device, path) bindings. Used
  // to re-key the WebSocket — when the user adds a new card widget on
  // a fresh device or path, we tear down + reconnect so the backend
  // consumer can rebuild its bindings and start forwarding events for
  // that new binding. useMemo returns the same string when only the
  // layout (not bindings) changed, so drag/resize doesn't reconnect.
  const wsBindingsKey = useMemo(() => {
    const parts = []
    for (const c of components) {
      for (const b of c?.config?.bindings || []) {
        if (b?.device_id && b?.payload_path) {
          parts.push(`${b.device_id}:${String(b.payload_path).replace(/^\/+|\/+$/g, '')}`)
        }
      }
    }
    return parts.sort().join('|')
  }, [components])

  // ---- Live device-payload updates over WebSocket ----
  // The backend's DashboardRealtimeConsumer joins every device this
  // dashboard binds to and forwards a single `dashboard_event` per
  // payload change. We apply each event to the matching device in our
  // local `devices` state — card widgets re-render automatically because
  // they read values through `devicesById`.
  useEffect(() => {
    if (!canView || !dashboardId) return undefined

    const loc   = typeof window !== 'undefined' ? window.location : null
    const host  = loc?.hostname || 'localhost'
    const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
    const url   = `${proto}//${host}:8001/ws/dashboards/${dashboardId}/`

    let cancelled       = false
    let reconnectTimer  = null
    let attempt         = 0
    let ws              = null

    function applyEvent(msg) {
      const action = msg.action
      const path   = msg.path || ''
      const value  = msg.payload
      let did      = msg.device_id
      // Fallback when the backend couldn't infer a device_id (e.g. old
      // server that doesn't stamp it, or root-path events on a server
      // that hasn't been restarted). Look up which bound device has a
      // path that matches the event path — if exactly one, use it.
      if (!did) {
        const cleaned = String(path).replace(/^\/+|\/+$/g, '')
        const candidates = new Set()
        for (const c of components) {
          for (const b of c?.config?.bindings || []) {
            const bp = String(b?.payload_path || '').replace(/^\/+|\/+$/g, '')
            if (!b?.device_id || !bp) continue
            if (bp === cleaned || bp.startsWith(cleaned + '/') || cleaned.startsWith(bp + '/') || cleaned === '') {
              candidates.add(Number(b.device_id))
            }
          }
        }
        if (candidates.size === 1) did = Array.from(candidates)[0]
      }
      if (!did) {
        // eslint-disable-next-line no-console
        console.warn('[dashboard-ws] event with no resolvable device_id', { path, action })
        return
      }
      // eslint-disable-next-line no-console
      console.debug('[dashboard-ws] apply', { device_id: did, path, action, value })
      setDevices((prev) => prev.map((d) => {
        if (Number(d.id) !== Number(did)) return d
        return { ...d, payload: applyPayloadAt(d.payload, path, action, value), last_payload_update: msg.timestamp || d.last_payload_update }
      }))
    }

    function scheduleReconnect() {
      if (cancelled) return
      attempt += 1
      const base   = Math.min(30000, 1000 * Math.pow(2, attempt - 1))
      const jitter = base * (0.8 + Math.random() * 0.4)
      reconnectTimer = setTimeout(connect, jitter)
    }

    function connect() {
      if (cancelled) return
      // eslint-disable-next-line no-console
      console.debug('[dashboard-ws] connecting', url)
      try { ws = new WebSocket(url) }
      catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[dashboard-ws] WebSocket constructor threw', err)
        scheduleReconnect(); return
      }

      ws.onopen = () => {
        attempt = 0
        // eslint-disable-next-line no-console
        console.debug('[dashboard-ws] connected')
      }
      ws.onclose = (ev) => {
        // eslint-disable-next-line no-console
        console.debug('[dashboard-ws] closed', ev?.code, ev?.reason)
        if (cancelled) return
        ws = null
        scheduleReconnect()
      }
      ws.onerror = (ev) => {
        // eslint-disable-next-line no-console
        console.warn('[dashboard-ws] error', ev)
        try { ws?.close() } catch {}
      }
      ws.onmessage = (e) => {
        let msg
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg?.type === 'dashboard_event' && msg.event === 'value_changed') {
          applyEvent(msg)
        } else if (msg?.status === 'ok' && msg?.action === 'connected') {
          // eslint-disable-next-line no-console
          console.debug('[dashboard-ws] subscribed to', msg.components?.length ?? 0, 'bindings')
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { ws?.close() } catch {}
    }
  }, [canView, dashboardId, wsBindingsKey])

  // MediaMTX status/viewers poll — same 10s cadence as the rest of the app.
  useEffect(() => {
    if (!canView) return undefined
    let timer = null
    const tick = () => loadCatalog()
    const start = () => { if (!timer) timer = setInterval(tick, 10000) }
    const stop  = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVis = () => { if (document.hidden) stop(); else { tick(); start() } }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [canView, loadCatalog])

  const camerasById = useMemo(() => {
    const m = new Map()
    for (const c of allCameras) m.set(c.id, c)
    return m
  }, [allCameras])

  // Merge the link list with the catalog so each camera entry shows
  // up-to-date status / viewers / webrtc_url. Primary cameras sort first.
  const stageCameras = useMemo(() => {
    const list = appCameras
      .map((link) => {
        const camId = link.camera_details?.id ?? link.camera
        const live = camerasById.get(camId)
        const base = link.camera_details || (typeof link.camera === 'object' ? link.camera : null) || {}
        return {
          id: camId,
          camera_name: live?.camera_name || base.camera_name || `Camera #${camId}`,
          status: live?.status ?? base.status ?? false,
          viewers: live?.viewers ?? base.viewers ?? 0,
          webrtc_url: live?.webrtc_url ?? base.webrtc_url ?? '',
          stream_path: live?.stream_path ?? base.stream_path ?? '',
          is_active: live?.is_active ?? base.is_active ?? true,
          is_primary: !!link.is_primary,
        }
      })
      .filter((c) => c.id != null)
    list.sort((a, b) => (Number(b.is_primary) - Number(a.is_primary)) || a.camera_name.localeCompare(b.camera_name))
    return list
  }, [appCameras, camerasById])

  useEffect(() => {
    if (selectedCamId != null) {
      if (!stageCameras.some((c) => c.id === selectedCamId)) {
        setSelectedCamId(stageCameras[0]?.id ?? null)
      }
      return
    }
    if (stageCameras.length > 0) setSelectedCamId(stageCameras[0].id)
  }, [stageCameras, selectedCamId])

  const activeCamera = useMemo(
    () => stageCameras.find((c) => c.id === selectedCamId) || null,
    [stageCameras, selectedCamId],
  )

  const devicesById = useMemo(() => {
    const m = new Map()
    for (const d of devices) m.set(d.id, d)
    return m
  }, [devices])

  /* ---- widget CRUD ---- */
  function openWidgetCreate() {
    // "+" opens the category picker. The category click will later open
    // the right builder (Cards is the only one wired so far; the rest
    // are placeholders until we build them step-by-step).
    setPickerOpen(true)
  }
  function openWidgetForm() {
    setWidgetModal({
      mode: 'create',
      form: {
        id: null,
        widget_name: '',
        widget_type: 'metric',
        title: '',
        device_id: '',
        payload_path: '',
        label: '',
        unit: '',
        min: '',
        max: '',
        value_type: 'string',
        write_op: 'put',
        write_value: '',
      },
    })
  }
  function openWidgetEdit(c) {
    const cfg = c?.config || {}
    const stat = cfg.static || {}
    const b = (cfg.bindings && cfg.bindings[0]) || {}
    setWidgetModal({
      mode: 'edit',
      form: {
        id: c.id,
        widget_name: c.widget_name || '',
        widget_type: c.widget_type || 'metric',
        title: cfg.title || '',
        device_id: b.device_id ?? '',
        payload_path: b.payload_path ?? '',
        label: b.label ?? '',
        unit: stat.unit ?? '',
        min: stat.min ?? '',
        max: stat.max ?? '',
        value_type: stat.value_type ?? 'string',
        write_op: stat.write_op ?? 'put',
        write_value: stat.write_value ?? '',
      },
    })
  }
  async function saveWidget(form, setSaving, setErrors, setBanner, close) {
    const config = {
      title: form.title || '',
      bindings: form.device_id && form.payload_path ? [{
        device_id: Number(form.device_id),
        payload_path: String(form.payload_path || '').replace(/^\/+|\/+$/g, ''),
        label: form.label || '',
      }] : [],
      static: {},
      ui: {},
    }
    if (form.unit !== '')        config.static.unit = form.unit
    if (form.min !== '')         config.static.min = Number(form.min)
    if (form.max !== '')         config.static.max = Number(form.max)
    if (form.value_type)         config.static.value_type = form.value_type
    if (form.write_op)           config.static.write_op = form.write_op
    if (form.write_value !== '') config.static.write_value = form.write_value

    const payload = {
      dashboard: parseInt(dashboardId, 10),
      widget_name: form.widget_name.trim(),
      widget_type: form.widget_type,
      order: form.id ? undefined : components.length,
      config,
    }
    setSaving(true)
    try {
      let resp, updated, created
      if (form.id) {
        resp = await api.updateDashboardComponent(form.id, payload)
        updated = resp?.component
        if (updated) setComponents((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      } else {
        resp = await api.createDashboardComponent(payload)
        created = resp?.component
        if (created?.id) setComponents((prev) => [...prev, created])
        else await reloadComponents()
      }
      setToast({ type: 'success', text: resp?.message || (form.id ? 'Widget updated.' : 'Widget added.') })
      close()
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['widget_name', 'widget_type', 'order', 'config'])
        const fes = {}
        for (const k of Object.keys(parsed.fields)) if (parsed.fields[k]?.length) fes[k] = parsed.fields[k][0]
        setErrors(fes)
        const top = parsed.form[0] || err?.data?.error || err?.message
        if (Object.keys(fes).length === 0 && top) setBanner({ type: 'error', text: top })
        else if (parsed.form.length) setBanner({ type: 'error', text: parsed.form[0] })
      } else {
        setBanner({ type: 'error', text: 'Network error.' })
      }
    } finally {
      setSaving(false)
    }
  }

  // Save flow for card variants picked through the WidgetPickerModal.
  // The picker builds a full config (with the chosen variant + N bindings
  // + icon refs), so we just POST it as-is rather than reshaping like
  // the legacy form's saveWidget does. We also include an initial
  // layout (x, y, w, h) so the position survives the very first reload
  // — no need to wait for the debounced post-mount PATCH.
  async function saveCardWidget(payload, setSaving, setErrors, setBanner, close) {
    setSaving(true)
    try {
      const defaults = variantLayoutDefaults(payload.config.variant)
      const perRow = Math.max(1, Math.floor(c2Cols / defaults.w))
      const idx = components.length
      const initialLayout = {
        x: (idx % perRow) * defaults.w,
        y: Math.floor(idx / perRow) * defaults.h,
        w: defaults.w,
        h: defaults.h,
      }
      const fullConfig = { ...payload.config, layout: initialLayout }
      const resp = await api.createDashboardComponent({
        dashboard: parseInt(dashboardId, 10),
        widget_name: payload.widget_name.trim(),
        widget_type: payload.widget_type,
        order: components.length,
        config: fullConfig,
      })
      const created = resp?.component
      if (created?.id) setComponents((prev) => [...prev, created])
      else await reloadComponents()
      setToast({ type: 'success', text: resp?.message || 'Widget added.' })
      close()
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['widget_name', 'widget_type', 'order', 'config'])
        const fes = {}
        for (const k of Object.keys(parsed.fields)) if (parsed.fields[k]?.length) fes[k] = parsed.fields[k][0]
        setErrors(fes)
        const top = parsed.form[0] || err?.data?.error || err?.message
        if (Object.keys(fes).length === 0 && top) setBanner({ type: 'error', text: top })
        else if (parsed.form.length) setBanner({ type: 'error', text: parsed.form[0] })
      } else {
        setBanner({ type: 'error', text: 'Network error.' })
      }
    } finally {
      setSaving(false)
    }
  }

  // Edit flow for card variants — PATCHes the existing widget while
  // preserving its layout (position/size) and order so the dashboard
  // doesn't shuffle when settings change. The variant itself stays
  // locked; only the title, bindings, colors, pattern, etc. update.
  async function updateCardWidget(id, payload, setSaving, setErrors, setBanner, close) {
    setSaving(true)
    try {
      const existing = components.find((c) => c.id === id)
      const preservedLayout = existing?.config?.layout
      const fullConfig = { ...payload.config }
      if (preservedLayout) fullConfig.layout = preservedLayout
      const resp = await api.updateDashboardComponent(id, {
        widget_name: payload.widget_name.trim(),
        widget_type: payload.widget_type,
        config: fullConfig,
      })
      const updated = resp?.component
      if (updated) setComponents((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setToast({ type: 'success', text: resp?.message || 'Widget updated.' })
      close()
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['widget_name', 'widget_type', 'config'])
        const fes = {}
        for (const k of Object.keys(parsed.fields)) if (parsed.fields[k]?.length) fes[k] = parsed.fields[k][0]
        setErrors(fes)
        const top = parsed.form[0] || err?.data?.error || err?.message
        if (Object.keys(fes).length === 0 && top) setBanner({ type: 'error', text: top })
        else if (parsed.form.length) setBanner({ type: 'error', text: parsed.form[0] })
      } else {
        setBanner({ type: 'error', text: 'Network error.' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function performWidgetDelete() {
    if (!confirmDelete) return
    try {
      await api.deleteDashboardComponent(confirmDelete.id)
      setComponents((prev) => prev.filter((c) => c.id !== confirmDelete.id))
      setToast({ type: 'success', text: `Widget "${confirmDelete.widget_name}" removed.` })
      setConfirmDelete(null)
    } catch (err) {
      setToast({
        type: 'error',
        text: (err instanceof ApiError && (err?.data?.error || err?.data?.detail)) || 'Delete failed.',
      })
    }
  }

  /* ---- render ---- */
  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page"><PermissionDenied resource="this dashboard" /></div>
      </div>
    )
  }

  return (
    <div className={'kiosk-app' + (previewMode ? ' is-db-preview' : '')}>
      <TopBar />

      <div className={'admin-page db-page' + (previewMode ? ' is-preview' : '')}>
        {!previewMode && (
          <div className="db-page-actions-row">
            <Link to={`/applications/${appId}`} className="back-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Application
            </Link>
            <button
              type="button"
              className="btn-secondary db-preview-btn"
              onClick={() => setPreviewMode(true)}
              title="View the dashboard the way an end-user sees it"
            >
              Preview
            </button>
          </div>
        )}

        {loading ? (
          <div className="admin-empty admin-loading">
            <span className="admin-spinner" aria-hidden="true" />
            <span>Loading dashboard…</span>
          </div>
        ) : error ? (
          <div className="admin-banner error">{error}</div>
        ) : !dashboard ? null : (
          <>
            {!previewMode && (
              <header className="db-head">
                <h1>{dashboard.name}</h1>
                {dashboard.description && <p className="db-head-desc">{dashboard.description}</p>}
              </header>
            )}

            <div className="db-shell" ref={previewShellRef}>
              <div className="db-top">
                {/* Container 1 — Camera (its own panel). */}
                <CameraCard
                  cameras={stageCameras}
                  active={activeCamera}
                  onSelect={setSelectedCamId}
                />
                {/* Container 2 — peach panel; the cell grid fills the entire
                    panel and widgets snap to the same cells via RGL. */}
                <section className="db-group db-group-right db-c2">
                  {/* Stage = scrollable area; stage-content has an exact pixel
                      height matching the grid's row count × cell size so the
                      cell grid + RGL share the same scroll height. When
                      widgets push beyond the default rows, the inner content
                      gets taller and the stage scrolls. */}
                  <div className="db-c2-stage">
                    <div
                      className="db-c2-stage-content"
                      style={{ height: `${c2StageH}px` }}
                    >
                      <CellGrid cols={c2Cols} rows={c2Rows} />
                      {components.length > 0 && (
                        <div className="db-c2-rgl-wrap">
                          <ResponsiveGrid
                            className="db-c2-rgl"
                            layouts={{ lg: c2Layout, md: c2Layout }}
                            breakpoints={C2_BREAKPOINTS}
                            cols={{ lg: c2Cols, md: c2Cols }}
                            rowHeight={c2RowH}
                            margin={[C2_GAP, C2_GAP]}
                            containerPadding={[0, 0]}
                            compactType={null}
                            /* preventCollision=true: the dragged widget
                               cannot be placed where it would overlap
                               another. The placeholder stops at the
                               nearest non-overlapping cell instead of
                               pushing widgets around — minimal motion. */
                            preventCollision
                            isDraggable={canUpdate && !previewMode}
                            isResizable={canUpdate && !previewMode}
                            resizeHandles={C2_RESIZE_HANDLES}
                            draggableHandle=".db-c2-widget-drag"
                            draggableCancel=".row-btn, button"
                            onLayoutChange={onC2LayoutChange}
                            onDragStop={(_layout, _old, newItem) =>
                              commitWidgetLayoutNow(newItem.i, newItem.x, newItem.y, newItem.w, newItem.h)
                            }
                            onResizeStop={(_layout, _old, newItem) =>
                              commitWidgetLayoutNow(newItem.i, newItem.x, newItem.y, newItem.w, newItem.h)
                            }
                          >
                            {components.map((c, idx) => {
                              // data-grid is RGL's per-item layout hint. We
                              // always include it so RGL never auto-places
                              // a widget when the layouts prop hasn't yet
                              // caught up with a new component (which would
                              // overwrite its saved x/y/w/h via the
                              // initial onLayoutChange).
                              const dg = c2Layout.find((l) => l.i === String(c.id)) || getWidgetLayout(c, idx, c2Cols)
                              return (
                                <div
                                  key={String(c.id)}
                                  className="db-c2-rgl-item"
                                  data-grid={dg}
                                >
                                  <DashWidgetView
                                    component={c}
                                    devicesById={devicesById}
                                    canUpdate={canUpdate && !previewMode}
                                    canDelete={canDelete && !previewMode}
                                    onEdit={() => {
                                      // Card-variant widgets go through the new
                                      // CardConfigure flow (preserves variant +
                                      // layout). Legacy non-card widgets fall
                                      // back to the old form.
                                      if (c?.config?.variant && CARD_VARIANT_DEFS[c.config.variant]) {
                                        setEditingWidget(c)
                                      } else {
                                        openWidgetEdit(c)
                                      }
                                    }}
                                    onDelete={() => setConfirmDelete(c)}
                                  />
                                </div>
                              )
                            })}
                          </ResponsiveGrid>
                        </div>
                      )}
                    </div>
                  </div>
                  {canUpdate && !previewMode && (
                    <button
                      type="button"
                      className="db-c2-add"
                      onClick={openWidgetCreate}
                      aria-label="Add widget"
                      title="Add widget"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </section>
              </div>
              {/* Container 3 — empty peach panel, same size as before. */}
              <section className="db-group db-group-bottom" />
            </div>
          </>
        )}
      </div>

      {previewMode && (
        <button
          type="button"
          className="db-preview-exit"
          onClick={() => setPreviewMode(false)}
          aria-label="Exit preview"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Exit preview
        </button>
      )}

      {(pickerOpen || editingWidget) && (
        <WidgetPickerModal
          onClose={() => { setPickerOpen(false); setEditingWidget(null) }}
          devices={devices}
          initialComponent={editingWidget}
          onSubmit={(payload, setSaving, setErrors, setBanner) => {
            if (editingWidget) {
              updateCardWidget(editingWidget.id, payload, setSaving, setErrors, setBanner, () => setEditingWidget(null))
            } else {
              saveCardWidget(payload, setSaving, setErrors, setBanner, () => setPickerOpen(false))
            }
          }}
        />
      )}

      {widgetModal && (
        <WidgetBuilderModal
          initial={widgetModal.form}
          devices={devices}
          onClose={() => setWidgetModal(null)}
          onSubmit={(form, setSaving, setErrors, setBanner) =>
            saveWidget(form, setSaving, setErrors, setBanner, () => setWidgetModal(null))
          }
        />
      )}

      {confirmDelete && (
        <WidgetDeleteConfirm
          widget={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={performWidgetDelete}
        />
      )}

      {toast && (
        <div className={'toast toast-' + toast.type} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  )
}

/* =====================================================================
   DashWidgetView  —  light wrapper used to render a saved widget on
   the dashboard. Looks at component.widget_type, picks the matching
   render component, and adds Edit / Delete chrome when the user has
   permission. Visually compact so it sits on top of the cell grid.
   ===================================================================== */
const WIDGET_TYPE_OPTIONS = [
  { value: 'metric',       label: 'Metric' },
  { value: 'simple_card',  label: 'Simple card' },
  { value: 'gauge',        label: 'Gauge' },
  { value: 'switch',       label: 'Switch' },
  { value: 'button',       label: 'Action button' },
  { value: 'input',        label: 'Input + send' },
  { value: 'json',         label: 'JSON view' },
]
const WRITE_TYPES = ['string', 'int', 'float', 'boolean']

function DashWidgetView({ component, devicesById, canUpdate, canDelete, onEdit, onDelete }) {
  const cfg = component?.config || {}
  const stat = cfg.static || {}
  const variant = cfg.variant
  const title = cfg.title || component.widget_name || '—'

  // Card-variant widgets get the styled CardPreview with the user's
  // chosen color/icon palette. The whole card surface is the drag
  // handle (when editing is allowed), with edit/delete overlaid in the
  // corner. Legacy widgets fall back to the simple text placeholder.
  if (variant && CARD_VARIANT_DEFS[variant]) {
    const options = {
      title,
      color: stat.card_color || 'peach',
      iconColor: stat.icon_color || 'orange',
      icon: stat.icon || '',
      unit: stat.unit || '',
      target: stat.target || '',
      pattern: stat.pattern || '',
      bindings: cfg.bindings || [],
      devicesById,                         // enables live value resolution
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <CardPreview variant={variant} options={options} />
        {(canUpdate || canDelete) && (
          <div className="db-card-actions">
            {canUpdate && (
              <button type="button" className="db-card-action" onClick={onEdit} title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {canDelete && (
              <button type="button" className="db-card-action danger" onClick={onDelete} title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Legacy / non-card widgets — preserve the original placeholder UI.
  const b = (cfg.bindings && cfg.bindings[0]) || {}
  const dev = b.device_id != null ? devicesById.get(Number(b.device_id)) : null
  const placeholder = (() => {
    switch (component.widget_type) {
      case 'metric':
      case 'simple_card':
      case 'gauge':       return `${stat.min != null ? stat.min : 0}${stat.unit || ''}`
      case 'switch':      return 'OFF'
      case 'button':      return stat.write_value ? `Send ${stat.write_value}` : 'Send'
      case 'input':       return 'Enter value…'
      case 'json':        return '{ }'
      default:            return '—'
    }
  })()

  return (
    <article className="db-saved-widget">
      <header className={'db-saved-widget-head' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <div className="db-saved-widget-titles">
          <div className="db-saved-widget-title">{title}</div>
          <div className="db-saved-widget-binding">
            <span className="db-saved-widget-type">{component.widget_type}</span>
            {dev && <span> · {dev.device_name}</span>}
            {b.payload_path && <code> /{b.payload_path}</code>}
          </div>
        </div>
        <div className="db-saved-widget-actions">
          {canUpdate && <button type="button" className="row-btn" onClick={onEdit}>Edit</button>}
          {canDelete && <button type="button" className="row-btn danger" onClick={onDelete}>Delete</button>}
        </div>
      </header>
      <div className="db-saved-widget-value">{placeholder}</div>
    </article>
  )
}

/* =====================================================================
   WidgetBuilderModal — form for creating / editing a widget. Submits
   through the api.createDashboardComponent / updateDashboardComponent
   endpoints via the parent's onSubmit handler.
   ===================================================================== */
function WidgetBuilderModal({ initial, devices, onClose, onSubmit }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  const isWriter = ['switch', 'button', 'input'].includes(form.widget_type)
  const isGauge  = form.widget_type === 'gauge'
  const needsUnit = ['metric', 'simple_card', 'gauge'].includes(form.widget_type)

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!form.widget_name.trim()) fes.widget_name = 'Widget name is required.'
    if (!form.device_id) fes.device_id = 'Pick a device.'
    if (!form.payload_path.trim()) fes.payload_path = 'Payload path is required.'
    if (form.widget_type === 'button' && form.write_value === '') {
      fes.write_value = 'A value to write is required.'
    }
    setErrors(fes)
    if (Object.keys(fes).length > 0) return
    onSubmit(form, setSaving, setErrors, setBanner)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{form.id ? 'Edit Widget' : 'Add Widget'}</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="modal-body">
          <form onSubmit={submit} noValidate>
            {banner && <div className={'admin-banner ' + banner.type}>{banner.text}</div>}

            <div className="form-grid-2">
              <DField label="Widget name" required error={errors.widget_name}>
                <input type="text" value={form.widget_name} disabled={saving} autoFocus
                  onChange={(e) => set('widget_name', e.target.value)}
                  placeholder="engine_temp_card" />
              </DField>
              <DField label="Widget type" required>
                <select value={form.widget_type} disabled={saving}
                  onChange={(e) => set('widget_type', e.target.value)}>
                  {WIDGET_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </DField>
              <DField label="Title (shown on the card)" full>
                <input type="text" value={form.title} disabled={saving}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Engine Temperature" />
              </DField>
            </div>

            <div className="form-grid-2">
              <DField label="Device" required error={errors.device_id}>
                <select value={form.device_id} disabled={saving}
                  onChange={(e) => set('device_id', e.target.value)}>
                  <option value="">Select a device…</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.device_name}</option>
                  ))}
                </select>
              </DField>
              <DField label="Payload path" required error={errors.payload_path}>
                <input type="text" value={form.payload_path} disabled={saving}
                  onChange={(e) => set('payload_path', e.target.value)}
                  placeholder="sensors/temp"
                  autoCapitalize="off" spellCheck={false} />
              </DField>
              <DField label="Label">
                <input type="text" value={form.label} disabled={saving}
                  onChange={(e) => set('label', e.target.value)}
                  placeholder="Engine 1" />
              </DField>
            </div>

            {(needsUnit || isGauge) && (
              <div className="form-grid-2">
                <DField label="Unit">
                  <input type="text" value={form.unit} disabled={saving}
                    onChange={(e) => set('unit', e.target.value)} placeholder="°C" />
                </DField>
                {isGauge && (
                  <>
                    <DField label="Min">
                      <input type="number" value={form.min} disabled={saving}
                        onChange={(e) => set('min', e.target.value)} placeholder="0" />
                    </DField>
                    <DField label="Max">
                      <input type="number" value={form.max} disabled={saving}
                        onChange={(e) => set('max', e.target.value)} placeholder="100" />
                    </DField>
                  </>
                )}
              </div>
            )}

            {isWriter && (
              <div className="form-grid-2">
                <DField label="Write operation">
                  <select value={form.write_op} disabled={saving}
                    onChange={(e) => set('write_op', e.target.value)}>
                    <option value="put">PUT (replace)</option>
                    <option value="patch">PATCH (merge)</option>
                    <option value="post">POST (append event)</option>
                    <option value="delete">DELETE</option>
                  </select>
                </DField>
                {form.write_op !== 'delete' && form.widget_type !== 'switch' && (
                  <DField label="Value type">
                    <select value={form.value_type} disabled={saving}
                      onChange={(e) => set('value_type', e.target.value)}>
                      {WRITE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </DField>
                )}
                {form.widget_type === 'button' && form.write_op !== 'delete' && (
                  <DField label="Value to write" required error={errors.write_value} full>
                    <input type="text" value={form.write_value} disabled={saving}
                      onChange={(e) => set('write_value', e.target.value)}
                      placeholder={form.value_type === 'boolean' ? 'true / false' : 'e.g. 25'} />
                  </DField>
                )}
              </div>
            )}

            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Add Widget')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function WidgetDeleteConfirm({ widget, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  async function go() { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }
  return (
    <div className="modal-overlay" onMouseDown={() => !busy && onCancel()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Remove widget?</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !busy && onCancel()}>×</button>
        </header>
        <div className="modal-body">
          <div className="confirm-body">
            <p className="confirm-lead">Remove <strong>{widget.widget_name}</strong>?</p>
            <p className="confirm-sub">
              Only the widget configuration is deleted. The underlying device payload is untouched.
            </p>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn-danger" onClick={go} disabled={busy} aria-busy={busy}>
              {busy ? 'Working…' : 'Remove'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DField({ label, error, children, full, required }) {
  return (
    <label className={'form-field' + (full ? ' full' : '') + (error ? ' has-error' : '')}>
      <span className="form-label">
        {label}
        {required && <span className="required-star" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && <span className="form-err">{error}</span>}
    </label>
  )
}

/* =====================================================================
   CellGrid  —  visible cell-square grid used inside a container.
   Renders cols × rows pale-lavender squares matching the reference
   builder image. Pure visual surface — no interaction yet.
   ===================================================================== */
function CellGrid({ cols = 10, rows = 7 }) {
  // Renders exactly cols × rows cells. Columns use 1fr (matches RGL
  // exactly), rows are fixed 50 px each (matches RGL rowHeight). The
  // parent sizes itself via inline pixel height = rows × 50 + gutters,
  // so when widgets push past the visible area, more cells appear and
  // the stage scrolls into them. Same cell visuals throughout — the
  // scrolled-in area looks identical to the default visible grid.
  const cells = []
  for (let i = 0; i < cols * rows; i++) cells.push(<span key={i} className="db-cell" />)
  return (
    <div
      className="db-cell-grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, ${C2_CELL_SIZE}px)`,
      }}
    >
      {cells}
    </div>
  )
}

/* =====================================================================
   CameraCard  —  real cameras in a Smart-CCTV styled card
   ===================================================================== */
function CameraCard({ cameras, active, onSelect }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    function onDown(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false) }
    function onKey(e)  { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const showDropdown = cameras.length > 1
  const activeIdx = active ? cameras.findIndex((c) => c.id === active.id) : -1
  function cycle(delta) {
    if (cameras.length < 2) return
    const next = (activeIdx + delta + cameras.length) % cameras.length
    onSelect(cameras[next].id)
  }

  const isOnline = !!active?.status
  const hasStream = active?.is_active && active?.webrtc_url

  return (
    <article className="db-card db-cam-card" ref={rootRef}>
      <header className="db-cam-head">
        <div className="db-cam-head-title">
          <h2>Smart CCTV</h2>
          <span className="db-cam-head-sub">Camera</span>
        </div>
      </header>

      <div className="db-cam-player">
        {hasStream ? (
          <iframe
            className="db-cam-frame"
            src={active.webrtc_url}
            title={`Live — ${active.camera_name}`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="db-cam-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="14" height="11" rx="2" stroke="#cbb89e" strokeWidth="1.5" />
              <path d="M17 11 L21 8.5 V16.5 L17 14" stroke="#cbb89e" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <div className="muted">
              {active == null
                ? 'No camera linked to this application.'
                : !active.is_active
                  ? 'This camera is disabled.'
                  : 'No stream URL configured.'}
            </div>
          </div>
        )}

        {/* LIVE pill (top-left of the player) */}
        <div className="db-cam-live">
          <span className={'db-cam-live-dot ' + (isOnline ? 'is-on' : 'is-off')} aria-hidden="true" />
          {isOnline ? 'Live' : 'Offline'}
        </div>

        {/* Camera switcher (top-right of the player) */}
        {active && (
          <div className="db-cam-switcher">
            {showDropdown && (
              <button type="button" className="db-cam-chev" onClick={() => cycle(-1)} aria-label="Previous camera">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className={'db-cam-select' + (menuOpen ? ' is-open' : '')}
              onClick={() => showDropdown && setMenuOpen((v) => !v)}
              aria-haspopup={showDropdown ? 'listbox' : undefined}
              aria-expanded={showDropdown ? menuOpen : undefined}
            >
              <span className="db-cam-select-name">{active.camera_name}</span>
              {showDropdown && (
                <svg className="db-cam-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            {showDropdown && (
              <button type="button" className="db-cam-chev" onClick={() => cycle(1)} aria-label="Next camera">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {menuOpen && showDropdown && (
              <ul className="db-cam-menu" role="listbox" aria-label="Pick a camera">
                {cameras.map((c) => {
                  const isActive = c.id === active.id
                  const dotCls =
                    !c.is_active ? 'is-disabled' :
                    c.status     ? 'is-on'       : 'is-off'
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={'db-cam-menu-item' + (isActive ? ' is-active' : '')}
                        onClick={() => { onSelect(c.id); setMenuOpen(false) }}
                      >
                        <span className={'db-cam-menu-dot ' + dotCls} aria-hidden="true" />
                        <span className="db-cam-menu-name">{c.camera_name}</span>
                        {c.is_primary && <span className="db-cam-menu-badge">primary</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

      </div>
    </article>
  )
}

/* =====================================================================
   Dummy widget cards — visuals match the mockup, content is static
   ===================================================================== */
function MusicCard() {
  return (
    <article className="db-card db-music-card">
      <div className="db-music-art" aria-hidden="true">
        {/* hat / face silhouette — abstract */}
        <svg viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="64" height="64" rx="8" fill="#3b3a3a" />
          <path d="M16 22 q16 -14 32 0 v6 H16z" fill="#1f1f1f" />
          <rect x="22" y="22" width="20" height="10" rx="2" fill="#bdbdbd" />
          <rect x="28" y="27" width="8" height="3" rx="1" fill="#3b3a3a" />
          <path d="M16 28 h32" stroke="#555" strokeWidth="1" />
        </svg>
      </div>
      <div className="db-music-body">
        <div className="db-music-row">
          <div>
            <div className="db-music-title">Midnight City</div>
            <div className="db-music-artist">M83</div>
          </div>
          <button type="button" className="db-music-menu" aria-label="More">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="5" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="19" r="1.6" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div className="db-music-progress">
          <span className="db-music-time">1:45</span>
          <div className="db-music-bar"><span style={{ width: '47%' }} /></div>
          <span className="db-music-time">3:52</span>
        </div>
        <div className="db-music-transport">
          <button type="button" className="db-music-btn" aria-label="Previous">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 5v14M19 5l-10 7 10 7V5z" fill="currentColor" />
            </svg>
          </button>
          <button type="button" className="db-music-play" aria-label="Pause">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="7" y="5" width="3.5" height="14" rx="1" fill="#fff" />
              <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="#fff" />
            </svg>
          </button>
          <button type="button" className="db-music-btn" aria-label="Next">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 5v14M5 5l10 7-10 7V5z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  )
}

function TemperatureCard() {
  return (
    <article className="db-card db-temp-card">
      <div className="db-card-head">
        <div>
          <h3>Temperature</h3>
          <div className="db-card-sub">Living Room</div>
        </div>
        <span className="db-mini-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 4a2 2 0 0 1 2 2v8.2a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2z" stroke="#C95812" strokeWidth="1.6" />
            <circle cx="12" cy="17" r="2" fill="#F36A1E" />
          </svg>
        </span>
      </div>
      <div className="db-temp-value">
        20<span className="db-temp-unit">°C</span>
      </div>
      <div className="db-temp-deco" aria-hidden="true">
        {/* moon illustration */}
        <svg viewBox="0 0 64 64">
          <circle cx="34" cy="32" r="18" fill="#B5A0DC" />
          <circle cx="40" cy="28" r="18" fill="#F8EDDC" />
          <circle cx="50" cy="14" r="2" fill="#fff" />
          <circle cx="14" cy="20" r="1.5" fill="#fff" />
        </svg>
      </div>
      <div className="db-temp-meta">
        <div>
          <div className="db-meta-label">Humidity</div>
          <div className="db-meta-value">45%</div>
        </div>
        <div>
          <div className="db-meta-label">Feels like</div>
          <div className="db-meta-value">22°C</div>
        </div>
      </div>
    </article>
  )
}

function WifiCard() {
  return (
    <article className="db-card db-wifi-card">
      <div className="db-card-head">
        <div>
          <h3>Wi-Fi</h3>
          <div className="db-card-sub">EvoHaus-5G</div>
        </div>
        <span className="db-mini-icon db-mini-icon-wifi">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 9a14 14 0 0 1 18 0" stroke="#1FAE6B" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M6 12.5a10 10 0 0 1 12 0" stroke="#1FAE6B" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M9 16a6 6 0 0 1 6 0" stroke="#1FAE6B" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="12" cy="19" r="1.2" fill="#1FAE6B" />
          </svg>
        </span>
      </div>
      <div className="db-wifi-signal">
        <div className="db-wifi-track">
          <span style={{ width: '75%' }} />
        </div>
        <span className="db-wifi-pct">75%</span>
      </div>
      <div className="db-wifi-deco" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <rect x="14" y="22" width="36" height="22" rx="4" fill="#F8B681" />
          <rect x="20" y="28" width="24" height="2" fill="#fff" />
          <circle cx="24" cy="36" r="1.5" fill="#fff" />
          <circle cx="32" cy="36" r="1.5" fill="#fff" />
          <circle cx="40" cy="36" r="1.5" fill="#fff" />
          <rect x="22" y="44" width="3" height="6" fill="#F8B681" />
          <rect x="39" y="44" width="3" height="6" fill="#F8B681" />
          <rect x="16" y="14" width="2" height="10" fill="#F8B681" transform="rotate(-25 17 14)" />
          <rect x="46" y="14" width="2" height="10" fill="#F8B681" transform="rotate(25 47 14)" />
        </svg>
      </div>
      <div className="db-wifi-meta">
        <div>
          <div className="db-meta-label">Download</div>
          <div className="db-meta-value">120 Mbps</div>
        </div>
        <div>
          <div className="db-meta-label">Upload</div>
          <div className="db-meta-value">45 Mbps</div>
        </div>
      </div>
    </article>
  )
}

function LightCard() {
  const [on, setOn] = useState(true)
  return (
    <article className="db-card db-light-card">
      <div className="db-card-head">
        <div className="db-card-head-id">
          <span className="db-tile-icon" style={{ background: '#FFE9D5', color: '#C95812' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M9 17h6M10 20h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M7 11a5 5 0 1 1 9 3l-1 2H9l-1-2A5 5 0 0 1 7 11Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h3>Bedroom Light</h3>
            <div className="db-card-sub">Camera</div>
          </div>
        </div>
        <DummyToggle on={on} onChange={setOn} />
      </div>
      <div className="db-light-bulb" aria-hidden="true">
        <svg viewBox="0 0 80 60" preserveAspectRatio="xMidYMid meet">
          <ellipse cx="40" cy="48" rx="28" ry="6" fill="url(#lightHalo)" opacity={on ? 0.6 : 0.15} />
          <path d="M20 18 Q40 -2 60 18 L52 36 L28 36 Z" fill="#2a2a2a" />
          <rect x="32" y="36" width="16" height="3" fill="#2a2a2a" />
          <defs>
            <radialGradient id="lightHalo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFC68A" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#FFC68A" stopOpacity="0" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <div className="db-chip-row">
        <DummyChip icon="sun"  label="Warm" />
        <DummyChip icon="pie"  label="Color" />
        <DummyChip icon="heart" label="Romantic" />
      </div>
    </article>
  )
}

function SpeakerCard() {
  const [on, setOn] = useState(false)
  return (
    <article className="db-card db-speaker-card">
      <div className="db-card-head">
        <div className="db-card-head-id">
          <span className="db-tile-icon" style={{ background: '#F1E6D6', color: '#4e463d' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="15" r="3" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </span>
          <div>
            <h3>Bluetooth Speaker</h3>
            <div className="db-card-sub">Connected</div>
          </div>
        </div>
        <DummyToggle on={on} onChange={setOn} />
      </div>
      <div className="db-speaker-mid">
        <div className="db-speaker-pct">68%</div>
        <div className="db-speaker-deco" aria-hidden="true">
          <svg viewBox="0 0 60 60">
            <rect x="14" y="8" width="32" height="44" rx="14" fill="#1f1f1f" />
            <circle cx="30" cy="22" r="6" fill="#3a3a3a" />
            <circle cx="30" cy="38" r="10" fill="#3a3a3a" />
            <circle cx="30" cy="38" r="3" fill="#0c0c0c" />
          </svg>
        </div>
      </div>
      <div className="db-chip-row">
        <DummyChip icon="battery" label="Battery" />
        <DummyChip icon="clock"   label="Mins" />
      </div>
    </article>
  )
}

function AcCard() {
  const [on, setOn] = useState(true)
  return (
    <article className="db-card db-ac-card">
      <div className="db-card-head">
        <div className="db-card-head-id">
          <span className="db-tile-icon" style={{ background: '#FFE9D5', color: '#C95812' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="6" width="18" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M7 14v3M12 14v4M17 14v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h3>Air Conditioner</h3>
            <div className="db-card-sub">Living Room</div>
          </div>
        </div>
        <DummyToggle on={on} onChange={setOn} />
      </div>
      <ArcGauge value={26} min={15} max={32} unit="°C" />
      <div className="db-chip-row">
        <DummyChip icon="fan"   label="Speed" />
        <DummyChip icon="sun"   label="Mode" />
        <DummyChip icon="clock" label="Timer" />
      </div>
    </article>
  )
}

/* =====================================================================
   Tiny shared bits
   ===================================================================== */
function DummyToggle({ on, onChange }) {
  return (
    <button
      type="button"
      className={'db-toggle' + (on ? ' is-on' : '')}
      onClick={() => onChange?.(!on)}
      aria-pressed={on}
    >
      <span className="db-toggle-knob" />
    </button>
  )
}

function DummyChip({ icon, label }) {
  return (
    <div className="db-chip">
      <span className="db-chip-ic">
        <ChipIcon name={icon} />
      </span>
      <span className="db-chip-label">{label}</span>
    </div>
  )
}

function ChipIcon({ name }) {
  const s = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' }
  const stroke = 'currentColor'
  const sw = 1.7
  switch (name) {
    case 'sun': return (
      <svg {...s}>
        <circle cx="12" cy="12" r="4" stroke={stroke} strokeWidth={sw} />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.5 4.5l1.5 1.5M18 18l1.5 1.5M4.5 19.5l1.5-1.5M18 6l1.5-1.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
    case 'pie': return (
      <svg {...s}>
        <circle cx="12" cy="12" r="8" stroke={stroke} strokeWidth={sw} />
        <path d="M12 12L12 4 A 8 8 0 0 1 19 12 Z" fill={stroke} />
      </svg>
    )
    case 'heart': return (
      <svg {...s}>
        <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      </svg>
    )
    case 'battery': return (
      <svg {...s}>
        <rect x="3" y="8" width="16" height="8" rx="1.8" stroke={stroke} strokeWidth={sw} />
        <rect x="5" y="10" width="9" height="4" rx="0.5" fill="#1FAE6B" />
        <rect x="20" y="10" width="2" height="4" rx="0.5" fill={stroke} />
      </svg>
    )
    case 'clock': return (
      <svg {...s}>
        <circle cx="12" cy="12" r="8" stroke={stroke} strokeWidth={sw} />
        <path d="M12 7v5l3 2" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
    case 'fan': return (
      <svg {...s}>
        <circle cx="12" cy="12" r="2" stroke={stroke} strokeWidth={sw} />
        <path d="M12 4c-2.5 0-4 2-3 5 2 1 4 1 6 0 1-3-.5-5-3-5z" stroke={stroke} strokeWidth={sw} />
        <path d="M20 12c0-2.5-2-4-5-3-1 2-1 4 0 6 3 1 5-.5 5-3z" stroke={stroke} strokeWidth={sw} />
        <path d="M12 20c2.5 0 4-2 3-5-2-1-4-1-6 0-1 3 .5 5 3 5z" stroke={stroke} strokeWidth={sw} />
        <path d="M4 12c0 2.5 2 4 5 3 1-2 1-4 0-6-3-1-5 .5-5 3z" stroke={stroke} strokeWidth={sw} />
      </svg>
    )
    default: return null
  }
}

function ArcGauge({ value, min, max, unit }) {
  // Half-circle gauge from min on the left to max on the right.
  // Sweep is 180°; we compute the angle for `value` and use a stroke-
  // dasharray trick to fill the arc.
  const cx = 80, cy = 60, r = 52
  const startAngle = 180
  const endAngle = 360
  const total = endAngle - startAngle
  const pct = Math.max(0, Math.min(1, (value - min) / Math.max(1, (max - min))))
  const arcSweep = total * pct
  function polar(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }
  const [sx, sy] = polar(startAngle)
  const [ex, ey] = polar(startAngle + arcSweep)
  const largeArc = arcSweep > 180 ? 1 : 0
  return (
    <div className="db-ac-gauge">
      <svg viewBox="0 0 160 80">
        <path d="M28 60 A 52 52 0 0 1 132 60" stroke="#F1E6D6" strokeWidth="8" fill="none" strokeLinecap="round" />
        {arcSweep > 0 && (
          <path
            d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`}
            stroke="#F36A1E"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />
        )}
        <text x="80" y="55" textAnchor="middle" fontSize="22" fontWeight="700" fill="#14161C" fontFamily="Manrope, system-ui">{value}</text>
        <text x="115" y="50" textAnchor="middle" fontSize="9" fill="#8c8377" fontFamily="Manrope, system-ui">{unit}</text>
      </svg>
      <div className="db-ac-range">
        <span>{min}<sup>°C</sup></span>
        <span>{max}<sup>°C</sup></span>
      </div>
    </div>
  )
}

/* =====================================================================
   WidgetPickerModal — popup opened by the "+" button. Side panel lists
   widget-component categories (Cards, Charts, Custom Fill, Dials,
   Image Cards, Tables, Calendar). Only "Cards" is wired right now;
   the rest are placeholder buttons that show a "Coming soon" hint in
   the main area when clicked. The plan is to add each category's
   builder step-by-step.
   ===================================================================== */
const PICKER_CATEGORIES = [
  { id: 'cards',       label: 'Cards' },
  { id: 'charts',      label: 'Charts' },
  { id: 'custom_fill', label: 'Custom Fill' },
  { id: 'dials',       label: 'Dials' },
  { id: 'image_cards', label: 'Image Cards' },
  { id: 'tables',      label: 'Tables' },
  { id: 'calendar',    label: 'Calendar' },
]

function WidgetPickerModal({ onClose, devices, onSubmit, initialComponent }) {
  const isEditing = !!initialComponent
  // Edit mode: jump straight to the variant configure view, skip the
  // gallery, and don't let the user change variant (would invalidate
  // the bindings).
  const [selected, setSelected] = useState('cards')
  const [pickedVariant, setPickedVariant] = useState(
    initialComponent?.config?.variant || null
  )

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const inConfigure = !!pickedVariant

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card widget-picker" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            {isEditing ? 'Edit Widget' : inConfigure ? 'Configure Card Widget' : 'Add Widget'}
          </h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="widget-picker-body">
          <aside className="widget-picker-side">
            <div className="widget-picker-side-title">
              {isEditing ? 'Widget Components' : 'Add Widget Components'}
            </div>
            <div className="widget-picker-side-list">
              {PICKER_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={'widget-picker-cat' + (selected === cat.id ? ' is-active' : '')}
                  onClick={() => {
                    setSelected(cat.id)
                    // Reset the variant pick only in add mode — in
                    // edit mode the sidebar is visual; the user
                    // can't switch categories without losing the
                    // editing context, so clicks just highlight.
                    if (!isEditing) setPickedVariant(null)
                  }}
                >
                  <span className="widget-picker-cat-ic" aria-hidden="true">
                    <PickerIcon name={cat.id} />
                  </span>
                  <span className="widget-picker-cat-label">{cat.label}</span>
                </button>
              ))}
            </div>
          </aside>
          <div className="widget-picker-main">
            {inConfigure ? (
              <CardConfigure
                variant={pickedVariant}
                devices={devices}
                initial={initialComponent}
                onBack={isEditing ? null : () => setPickedVariant(null)}
                onSubmit={onSubmit}
              />
            ) : selected === 'cards' ? (
              <CardVariantGallery onPick={(variant) => setPickedVariant(variant)} />
            ) : (
              <div className="widget-picker-empty">
                <div className="widget-picker-empty-ic" aria-hidden="true">
                  <PickerIcon name={selected} />
                </div>
                <div className="widget-picker-empty-title">
                  {PICKER_CATEGORIES.find((c) => c.id === selected)?.label || 'Pick a component'}
                </div>
                <div className="widget-picker-empty-sub">
                  Coming soon — this component type isn’t available yet.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* =====================================================================
   CARD_VARIANT_DEFS — declarative metadata for each Card variant.
   Drives the field count in CardConfigure and the live preview values.
   Keep field key names stable; bindings are stored in config.bindings
   in the same order as defined here.
   ===================================================================== */
const CARD_VARIANT_DEFS = {
  simple_value: {
    title: 'Simple Card 1',
    fields: [{ key: 'value', label: 'Value source' }],
    hasIcon: false,
    hasUnit: false,
    sampleTitle: 'Engine Temperature',
    sampleSub: 'Temperature',
  },
  simple_icon: {
    title: 'Simple Card 2',
    fields: [{ key: 'value', label: 'Value source' }],
    hasIcon: true,
    hasUnit: false,
    sampleTitle: 'Total Workorders',
    sampleSub: 'Work orders',
  },
  comparison: {
    title: 'Comparison Card',
    fields: [
      { key: 'current',  label: 'Current value source' },
      { key: 'previous', label: 'Previous value source (e.g. Yesterday)' },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Fuel Consumption',
  },
  multivalue_grid: {
    title: 'Multivalue Card 1',
    fields: [
      { key: 'm1', label: 'Minimum' },
      { key: 'm2', label: 'Last Value' },
      { key: 'm3', label: 'Maximum' },
      { key: 'm4', label: 'Average' },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Conf Room Data Trend',
  },
  multivalue_row: {
    title: 'Multivalue Card 2',
    fields: [
      { key: 'm1', label: 'Metric 1', withIcon: true },
      { key: 'm2', label: 'Metric 2', withIcon: true },
      { key: 'm3', label: 'Metric 3', withIcon: true },
    ],
    hasIcon: false,
    hasUnit: true,
    sampleTitle: 'Conf Room Data Trend',
  },
  multivalue_assorted: {
    title: 'Multivalue Card 3 (Assorted)',
    fields: [
      { key: 'm1', label: 'Metric 1', withIcon: true },
      { key: 'm2', label: 'Metric 2', withIcon: true },
    ],
    hasIcon: false,
    hasUnit: false,
    sampleTitle: 'Conf Room Details',
  },
  trend: {
    title: 'Trend Card',
    fields: [
      { key: 'value', label: 'Value source' },
      { key: 'trend', label: 'Trend / delta source (optional)' },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Production Rate',
  },
  progress: {
    title: 'Progress Card',
    fields: [{ key: 'value', label: 'Current value source' }],
    hasIcon: false,
    hasUnit: false,
    hasTarget: true,
    sampleTitle: 'Daily Target',
  },
  status: {
    title: 'Status Card',
    fields: [{ key: 'value', label: 'Status source' }],
    hasIcon: true,
    hasUnit: false,
    sampleTitle: 'Compressor Status',
  },
}

/* =====================================================================
   CardConfigure — second view in the picker. Shows the chosen variant
   as a large "Example" preview at the top, "Change Style" returns to
   the gallery, and below is a form whose field count matches the
   variant (1 binding for simple, 4 for multivalue-grid, etc.).
   ===================================================================== */
function CardConfigure({ variant, devices, onBack, onSubmit, initial }) {
  const def = CARD_VARIANT_DEFS[variant] || CARD_VARIANT_DEFS.simple_value
  const isEditing = !!initial
  // Pull defaults from the existing component when editing so the form
  // opens with the user's last choices already filled in.
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const [widgetName, setWidgetName] = useState(initial?.widget_name || '')
  const [title, setTitle]           = useState(initCfg.title || '')
  const [icon, setIcon]             = useState(initStat.icon || '')
  const [unit, setUnit]             = useState(initStat.unit || '')
  const [target, setTarget]         = useState(initStat.target || '')
  const [cardColor, setCardColor]   = useState(initStat.card_color || 'peach')
  const [iconColor, setIconColor]   = useState(initStat.icon_color || 'orange')
  const [pattern, setPattern]       = useState(initStat.pattern || '')
  const [bindings, setBindings] = useState(() =>
    def.fields.map((_, i) => {
      const ex = initBindings[i]
      return ex
        ? {
            device_id: ex.device_id != null ? String(ex.device_id) : '',
            payload_path: ex.payload_path || '',
            label: ex.label || '',
            icon: ex.icon || '',
          }
        : { device_id: '', payload_path: '', label: '', icon: '' }
    }),
  )
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)

  // Some variants have no icon at all (e.g. Simple Card 1, Progress);
  // for those we hide the icon color picker entirely.
  const hasAnyIcon = def.hasIcon || def.fields.some((f) => f.withIcon)

  // Live-preview options — every field change reflects in the "Example".
  const previewOptions = {
    title:     title || def.sampleTitle,
    color:     cardColor,
    iconColor,
    icon,
    unit,
    target,
    bindings,
    pattern,
  }

  function setBinding(i, k, v) {
    setBindings((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)))
    setErrors((e) => {
      const nk = `bindings.${i}.${k}`
      if (!e[nk]) return e
      const next = { ...e }; delete next[nk]; return next
    })
  }

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!widgetName.trim()) fes.widget_name = 'Widget name is required.'
    bindings.forEach((b, i) => {
      if (!b.device_id)            fes[`bindings.${i}.device_id`]    = 'Pick a device.'
      if (!b.payload_path.trim())  fes[`bindings.${i}.payload_path`] = 'Required.'
    })
    setErrors(fes)
    if (Object.keys(fes).length > 0) return

    const config = {
      title: title || '',
      variant,
      bindings: bindings.map((b, i) => ({
        device_id: Number(b.device_id),
        payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''),
        label: b.label || def.fields[i].label,
        icon: b.icon || '',
      })),
      static: {
        ...(unit       ? { unit }       : {}),
        ...(icon       ? { icon }       : {}),
        ...(target     ? { target }     : {}),
        ...(pattern    ? { pattern }    : {}),
        card_color: cardColor,
        icon_color: iconColor,
      },
      ui: {},
    }
    onSubmit?.({ widget_name: widgetName, widget_type: 'card', config }, setSaving, setErrors, setBanner)
  }

  return (
    <div className="card-config">
      <div className="card-config-preview-col">
        <div className="card-config-example-label">{isEditing ? 'Editing' : 'Example'}</div>
        <div className="card-config-preview-frame">
          <CardPreview variant={variant} options={previewOptions} />
        </div>
        {/* "Change Style" is hidden in edit mode — switching variant
            would invalidate the existing bindings and layout. */}
        {!isEditing && onBack && (
          <button type="button" className="card-config-change" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Change Style
          </button>
        )}
      </div>

      <form className="card-config-form" onSubmit={submit} noValidate>
        {banner && <div className={'admin-banner ' + banner.type}>{banner.text}</div>}

        <div className="card-config-section">
          <div className="card-config-section-head">Widget</div>
          <div className="form-grid-2">
            <DField label="Widget name" required error={errors.widget_name}>
              <input
                type="text"
                value={widgetName}
                disabled={saving}
                onChange={(e) => { setWidgetName(e.target.value); if (errors.widget_name) setErrors((x) => ({ ...x, widget_name: undefined })) }}
                placeholder="engine_temperature"
                autoFocus
              />
            </DField>
            <DField label="Title (shown on the card)">
              <input
                type="text"
                value={title}
                disabled={saving}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={def.sampleTitle}
              />
            </DField>
            {def.hasIcon && (
              <DField label="Icon" full>
                <IconPickerField value={icon} disabled={saving} onChange={setIcon} />
              </DField>
            )}
            {def.hasUnit && (
              <DField label="Unit (e.g. °C, Ltrs)">
                <input type="text" value={unit} disabled={saving}
                  onChange={(e) => setUnit(e.target.value)} placeholder="°C" />
              </DField>
            )}
            {def.hasTarget && (
              <DField label="Target value">
                <input type="number" value={target} disabled={saving}
                  onChange={(e) => setTarget(e.target.value)} placeholder="5000" />
              </DField>
            )}
          </div>
        </div>

        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field">
            <span className="form-label">Card color</span>
            <div className="color-swatches">
              {CARD_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'color-swatch' + (cardColor === c.id ? ' is-active' : '')}
                  style={{ background: c.bg }}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={cardColor === c.id}
                  onClick={() => setCardColor(c.id)}
                  disabled={saving}
                />
              ))}
            </div>
          </div>
          {hasAnyIcon && (
            <div className="form-field">
              <span className="form-label">Icon color</span>
              <div className="color-swatches">
                {ICON_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={'color-swatch color-swatch-solid' + (iconColor === c.id ? ' is-active' : '')}
                    style={{ background: c.hex }}
                    title={c.label}
                    aria-label={c.label}
                    aria-pressed={iconColor === c.id}
                    onClick={() => setIconColor(c.id)}
                    disabled={saving}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="form-field">
            <span className="form-label">Background pattern</span>
            <div className="pattern-swatches">
              {PATTERNS.map((p) => (
                <button
                  key={p.id || 'none'}
                  type="button"
                  className={'pattern-swatch' + (pattern === p.id ? ' is-active' : '')}
                  onClick={() => setPattern(p.id)}
                  disabled={saving}
                  title={p.label}
                  aria-pressed={pattern === p.id}
                >
                  <span
                    className="pattern-swatch-tile"
                    style={p.svg
                      ? { backgroundImage: makePatternUrl(p.svg, '#7B5A2E'), backgroundSize: `${Math.min(p.size, 60)}px ${Math.min(p.size, 60)}px` }
                      : { background: 'repeating-linear-gradient(45deg, #EDE3D5 0 6px, #fff 6px 12px)' }}
                  />
                  <span className="pattern-swatch-label">{p.label}</span>
                </button>
              ))}
            </div>
            <PatternSearchField
              value={isPatternUrl(pattern) ? pattern : ''}
              disabled={saving}
              onChange={(url) => setPattern(url)}
              onClear={() => setPattern('')}
            />
          </div>
        </div>

        <div className="card-config-section">
          <div className="card-config-section-head">
            {def.fields.length === 1
              ? 'Data binding'
              : `${def.fields.length} data bindings`}
          </div>
          {def.fields.map((f, i) => (
            <BindingFields
              key={i}
              field={f}
              binding={bindings[i]}
              devices={devices}
              disabled={saving}
              errors={{
                device_id:    errors[`bindings.${i}.device_id`],
                payload_path: errors[`bindings.${i}.payload_path`],
              }}
              onChange={(k, v) => setBinding(i, k, v)}
            />
          ))}
        </div>

        <div className="modal-foot">
          {!isEditing && onBack && (
            <button type="button" className="btn-secondary" onClick={onBack} disabled={saving}>Back</button>
          )}
          <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
            {saving ? 'Saving…' : (isEditing ? 'Save Changes' : 'Add Widget')}
          </button>
        </div>
      </form>
    </div>
  )
}

function BindingFields({ field, binding, devices, disabled, errors, onChange }) {
  const selectedDevice = devices.find((d) => String(d.id) === String(binding.device_id))
  return (
    <div className="card-config-binding">
      <div className="card-config-binding-label">{field.label}</div>
      <div className="form-grid-2">
        <DField label="Device" required error={errors.device_id}>
          <select value={binding.device_id} disabled={disabled}
            onChange={(e) => onChange('device_id', e.target.value)}>
            <option value="">Select a device…</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.device_name}</option>)}
          </select>
        </DField>
        <DField label="Payload path" required error={errors.payload_path}>
          <PayloadPathField
            device={selectedDevice}
            value={binding.payload_path}
            onChange={(v) => onChange('payload_path', v)}
            disabled={disabled}
          />
        </DField>
        <DField label="Label" full={!field.withIcon}>
          <input type="text" value={binding.label} disabled={disabled}
            onChange={(e) => onChange('label', e.target.value)}
            placeholder={field.label} />
        </DField>
        {field.withIcon && (
          <DField label="Icon">
            <IconPickerField value={binding.icon} disabled={disabled}
              onChange={(v) => onChange('icon', v)} />
          </DField>
        )}
      </div>
    </div>
  )
}

/* =====================================================================
   flattenScalarPaths — walk a device payload and collect only the
   leaves that resolve to a scalar (string / number / boolean). Objects
   are recursed into; arrays are skipped entirely because a card widget
   renders a single value, not a list. Paths use "/" separators to
   match the existing payload_path convention.
   ===================================================================== */
/* Typed-scalar wrapper: an object like { type: 'string', value: 'sai' }
   produced by the Payload editor. We treat the whole wrapper as one
   leaf so the dropdown shows "/test · string" rather than exposing
   "/test/type" and "/test/value" as separate paths. */
function isTypedScalarWrapper(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  if (typeof v.type !== 'string' || !('value' in v)) return false
  const vv = v.value
  return vv === null || ['string', 'number', 'boolean'].includes(typeof vv)
}
function normalizeDeclaredType(declared, value) {
  const d = String(declared || '').toLowerCase()
  if (d === 'int' || d === 'integer')                 return 'int'
  if (d === 'float' || d === 'double' || d === 'number') {
    return typeof value === 'number' && Number.isInteger(value) ? 'int' : 'float'
  }
  if (d === 'string' || d === 'str')                  return 'string'
  if (d === 'bool'   || d === 'boolean')              return 'boolean'
  // fall back to the value's runtime type
  if (typeof value === 'number')  return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'string')  return 'string'
  if (typeof value === 'boolean') return 'boolean'
  return d || 'string'
}

function flattenScalarPaths(obj, prefix = '', out = []) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    // Paths always start with "/" so root-level fields read as
    // "/test · string" instead of just "test".
    const next = `${prefix}/${k}`
    if (v == null) continue
    if (isTypedScalarWrapper(v)) {
      out.push({ path: next, type: normalizeDeclaredType(v.type, v.value) })
      continue
    }
    const t = typeof v
    if (t === 'number')        out.push({ path: next, type: Number.isInteger(v) ? 'int' : 'float' })
    else if (t === 'string')   out.push({ path: next, type: 'string' })
    else if (t === 'boolean')  out.push({ path: next, type: 'boolean' })
    else if (t === 'object' && !Array.isArray(v)) flattenScalarPaths(v, next, out)
    // arrays and any other types are intentionally skipped
  }
  return out
}

/* PayloadPathField — dropdown of detected scalar leaf paths for the
   currently selected device. Auto-switches to a free-form text input
   when the device has no payload yet, or when the user wants to enter
   a custom path that isn't in the list. */
function PayloadPathField({ device, value, onChange, disabled }) {
  const paths = useMemo(() => flattenScalarPaths(device?.payload || {}), [device?.payload])
  const valueInList = useMemo(() => paths.some((p) => p.path === value), [paths, value])
  const [custom, setCustom] = useState(false)

  // If the user has a path that isn't in the device's payload, drop
  // into custom mode so they can keep editing it.
  useEffect(() => {
    if (value && paths.length > 0 && !valueInList) setCustom(true)
  }, [value, paths.length, valueInList])

  const useCustomInput = paths.length === 0 || custom

  if (useCustomInput) {
    return (
      <div className="payload-path-field">
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sensors/temp"
          autoCapitalize="off"
          spellCheck={false}
        />
        {paths.length === 0 && device && (
          <div className="payload-path-hint">
            Device hasn’t reported a payload yet — type the path manually.
          </div>
        )}
        {paths.length > 0 && (
          <button
            type="button"
            className="payload-path-toggle"
            onClick={() => { setCustom(false); onChange('') }}
            disabled={disabled}
          >
            Pick from device payload
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="payload-path-field">
      <select
        value={valueInList ? value : ''}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === '__custom__') { setCustom(true); return }
          onChange(e.target.value)
        }}
      >
        <option value="">Select a path…</option>
        {paths.map((p) => (
          <option key={p.path} value={p.path}>
            {p.path} · {p.type}
          </option>
        ))}
        <option value="__custom__">Custom path…</option>
      </select>
    </div>
  )
}

/* =====================================================================
   PatternSearchField — same UX as IconPickerField but for repeating
   background patterns. Searches the Iconify catalog (free, no key)
   and lets the user pick any glyph to use as a tile. The resulting
   pattern value is a full SVG URL like
       https://api.iconify.design/material-symbols:auto-awesome.svg
   which CvCard recognises (via isPatternUrl) and renders as a
   `background-image` tile, color baked in at pick time.
   ===================================================================== */
const PATTERN_QUICK_QUERIES = ['sparkle', 'dot', 'plus', 'star', 'circle', 'leaf', 'wave']

function PatternSearchField({ value, disabled, onChange, onClear }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e)  { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const q = query.trim()
    if (!q) { setResults([]); return undefined }
    setLoading(true)
    const ac = new AbortController()
    const t = setTimeout(() => {
      fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=60`,
        { signal: ac.signal })
        .then((r) => r.json())
        .then((data) => setResults(Array.isArray(data?.icons) ? data.icons : []))
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 220)
    return () => { ac.abort(); clearTimeout(t) }
  }, [query, open])

  const PATTERN_TINT = '%237B5A2E'   // a warm brown that works as texture on the peach palette
  const isUrl = isPatternUrl(value)
  // Use the same icon-picker chrome so it reads consistently next to the icon search.
  return (
    <div className="icon-picker pattern-search" ref={ref}>
      <button
        type="button"
        className="icon-picker-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        {isUrl ? (
          <>
            <span
              className="icon-picker-glyph pattern-search-tile"
              style={{ backgroundImage: `url("${value}")` }}
              aria-hidden="true"
            />
            <span className="icon-picker-name">Custom pattern (fetched)</span>
          </>
        ) : (
          <span className="icon-picker-placeholder">Search patterns from the server…</span>
        )}
        <svg className="icon-picker-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="icon-picker-popover">
          <input
            className="icon-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pattern motifs (sparkle, dot, plus…)"
            autoFocus
          />
          <div className="pattern-search-quick">
            <span className="pattern-search-quick-head">Quick:</span>
            {PATTERN_QUICK_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                className="pattern-search-quick-btn"
                onClick={() => setQuery(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="icon-picker-grid">
            {loading && <div className="icon-picker-hint">Searching…</div>}
            {!loading && !query.trim() && (
              <div className="icon-picker-hint">
                Type to search the Iconify catalog — the picked glyph tiles as the card background.
              </div>
            )}
            {!loading && query.trim() && results.length === 0 && (
              <div className="icon-picker-hint">No results.</div>
            )}
            {!loading && results.map((id) => {
              const url = `https://api.iconify.design/${id}.svg?color=${PATTERN_TINT}`
              return (
                <button
                  key={id}
                  type="button"
                  className={'icon-picker-cell' + (url === value ? ' is-active' : '')}
                  onClick={() => { onChange?.(url); setOpen(false) }}
                  title={id}
                >
                  <img src={`https://api.iconify.design/${id}.svg?color=${PATTERN_TINT}`} alt="" aria-hidden="true" />
                </button>
              )
            })}
          </div>
          <div className="icon-picker-foot">
            Patterns via <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify</a> · free &amp; open source
            {isUrl && (
              <button type="button" className="icon-picker-clear" onClick={() => { onClear?.(); setOpen(false) }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* =====================================================================
   CvCard — shared wrapper for every preview/saved card. Handles the
   inline palette style and the optional background decoration image
   (Iconify emoji) anchored to the bottom-right corner.
   ===================================================================== */
/* Scatter positions used when a URL-based pattern is selected. The
   same image URL is layered N times with no-repeat, each at a
   pseudo-random position, so the glyph appears sprinkled across the
   card instead of forming a tile grid. */
const SCATTER_POSITIONS = [
  '12% 18%', '78% 26%', '40% 56%', '88% 82%',
  '8% 90%',  '62% 88%', '94% 48%', '32% 14%',
  '54% 36%', '20% 70%',
]
function CvCard({ style, pattern, children }) {
  let patternStyle = null
  if (isPatternUrl(pattern)) {
    // Multi-layer scatter — same URL placed at 10 non-repeating spots.
    const url = `url("${pattern}")`
    patternStyle = {
      backgroundImage: SCATTER_POSITIONS.map(() => url).join(', '),
      backgroundPosition: SCATTER_POSITIONS.join(', '),
      backgroundRepeat: SCATTER_POSITIONS.map(() => 'no-repeat').join(', '),
      backgroundSize: '16px 16px',
    }
  } else if (pattern) {
    const pdef = getPattern(pattern)
    if (pdef.svg) {
      patternStyle = {
        backgroundImage: makePatternUrl(pdef.svg, style?.color || '#14161C'),
        backgroundSize: `${pdef.size}px ${pdef.size}px`,
      }
    }
  }
  return (
    <div className="cv-card" style={style}>
      {patternStyle && <span className="cv-pattern" aria-hidden="true" style={patternStyle} />}
      {children}
    </div>
  )
}

/* =====================================================================
   IconPickerField — searches the Iconify catalog (200,000+ icons from
   MDI / Tabler / Lucide / Heroicons / Phosphor and more). Free public
   API, no auth: https://iconify.design.
     - Search:   https://api.iconify.design/search?query={q}&limit=48
     - Render:   https://api.iconify.design/{prefix}:{name}.svg?color=...
   Stored value is the full id like "mdi:fire" or "tabler:bolt".
   ===================================================================== */
function IconPickerField({ value, disabled, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e)  { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const q = query.trim()
    if (!q) { setResults([]); return undefined }
    setLoading(true)
    const ac = new AbortController()
    const t = setTimeout(() => {
      fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=48`,
        { signal: ac.signal })
        .then((r) => r.json())
        .then((data) => setResults(Array.isArray(data?.icons) ? data.icons : []))
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 220)
    return () => { ac.abort(); clearTimeout(t) }
  }, [query, open])

  const accent = encodeURIComponent('#F36A1E')

  return (
    <div className="icon-picker" ref={ref}>
      <button
        type="button"
        className="icon-picker-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        {value ? (
          <>
            <img className="icon-picker-glyph"
              src={`https://api.iconify.design/${value}.svg?color=${accent}`}
              alt="" aria-hidden="true" />
            <span className="icon-picker-name">{value}</span>
          </>
        ) : (
          <span className="icon-picker-placeholder">Pick an icon…</span>
        )}
        <svg className="icon-picker-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="icon-picker-popover">
          <input
            className="icon-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons (fire, fuel, bell, gauge…)"
            autoFocus
          />
          <div className="icon-picker-grid">
            {loading && <div className="icon-picker-hint">Searching…</div>}
            {!loading && !query.trim() && (
              <div className="icon-picker-hint">
                Type to search the Iconify catalog (200,000+ icons).
              </div>
            )}
            {!loading && query.trim() && results.length === 0 && (
              <div className="icon-picker-hint">No results.</div>
            )}
            {!loading && results.map((id) => (
              <button
                key={id}
                type="button"
                className={'icon-picker-cell' + (id === value ? ' is-active' : '')}
                onClick={() => { onChange?.(id); setOpen(false) }}
                title={id}
              >
                <img src={`https://api.iconify.design/${id}.svg?color=${accent}`} alt="" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="icon-picker-foot">
            Icons via <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify</a> · free &amp; open source
            {value && (
              <button type="button" className="icon-picker-clear" onClick={() => { onChange?.(''); setOpen(false) }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* =====================================================================
   CardVariantGallery — rendered inside the picker when the "Cards"
   category is selected. Shows preview tiles for every card layout the
   builder supports (currently 9: six from the reference mockup plus
   three of our own). Click on a tile fires onPick(variantId).
   ===================================================================== */
const CARD_VARIANTS = [
  { id: 'simple_value',        title: 'Simple Card 1' },
  { id: 'simple_icon',         title: 'Simple Card 2' },
  { id: 'comparison',          title: 'Comparison Card' },
  { id: 'multivalue_grid',     title: 'Multivalue Card 1' },
  { id: 'multivalue_row',      title: 'Multivalue Card 2' },
  { id: 'multivalue_assorted', title: 'Multivalue Card 3 (Assorted)' },
  { id: 'trend',               title: 'Trend Card' },
  { id: 'progress',            title: 'Progress Card' },
  { id: 'status',              title: 'Status Card' },
]

function CardVariantGallery({ onPick }) {
  return (
    <div className="card-gallery">
      {CARD_VARIANTS.map((v) => (
        <button
          key={v.id}
          type="button"
          className="card-variant"
          onClick={() => onPick?.(v.id)}
          aria-label={`Use ${v.title}`}
        >
          <div className="card-variant-title">{v.title}</div>
          <div className="card-variant-preview">
            <CardPreview variant={v.id} />
          </div>
        </button>
      ))}
    </div>
  )
}

function CardPreview({ variant, options }) {
  const opts = options || {}
  switch (variant) {
    case 'simple_value':        return <PreviewSimpleValue options={opts} />
    case 'simple_icon':         return <PreviewSimpleIcon options={opts} />
    case 'comparison':          return <PreviewComparison options={opts} />
    case 'multivalue_grid':     return <PreviewMultivalueGrid options={opts} />
    case 'multivalue_row':      return <PreviewMultivalueRow options={opts} />
    case 'multivalue_assorted': return <PreviewMultivalueAssorted options={opts} />
    case 'trend':               return <PreviewTrend options={opts} />
    case 'progress':            return <PreviewProgress options={opts} />
    case 'status':              return <PreviewStatus options={opts} />
    default: return null
  }
}

/* Resolve common options (title + colors) shared by every preview. */
function useCardChrome(options, defaults) {
  const title     = options.title || defaults.title
  const colorId   = options.color || 'peach'
  const iconColor = getIconColor(options.iconColor).hex
  const style     = cardStyleFor(colorId)
  return { title, iconColor, style, icon: options.icon || defaults.icon, unit: options.unit ?? defaults.unit }
}

/* Pick a binding label or fall back to a sample one. */
function bLabel(options, i, fallback) {
  return options.bindings?.[i]?.label || fallback
}
function bIcon(options, i, fallback) {
  return options.bindings?.[i]?.icon || fallback
}

/* Apply a single dashboard_event diff to a device's payload tree.
   Mirrors the actions that DashboardRealtimeConsumer emits:
     put    — replace the subtree at `path`
     patch  — shallow-merge into the dict at `path`
     post   — `path` already includes the new key; set verbatim
     delete — drop the key at `path` */
function applyPayloadAt(payload, path, action, value) {
  const base = payload && typeof payload === 'object' ? payload : {}
  const cloned = typeof structuredClone === 'function'
    ? structuredClone(base)
    : JSON.parse(JSON.stringify(base))
  const segs = String(path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (segs.length === 0) {
    if (action === 'put')    return value && typeof value === 'object' ? value : {}
    if (action === 'patch')  return { ...cloned, ...(value || {}) }
    if (action === 'delete') return {}
    return cloned
  }
  let ref = cloned
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i]
    if (typeof ref[k] !== 'object' || ref[k] === null || Array.isArray(ref[k])) ref[k] = {}
    ref = ref[k]
  }
  const last = segs[segs.length - 1]
  if (action === 'put' || action === 'post') ref[last] = value
  else if (action === 'patch') {
    const existing = (typeof ref[last] === 'object' && ref[last] !== null) ? ref[last] : {}
    ref[last] = { ...existing, ...(value || {}) }
  } else if (action === 'delete') {
    delete ref[last]
  }
  return cloned
}

/* Walk a device payload by "/"-separated path. Unwraps `{ type, value }`
   wrappers produced by the Payload editor so the widget gets the scalar
   directly. Returns null if the path doesn't resolve to a scalar. */
function resolveBindingValue(binding, devicesById) {
  if (!binding?.device_id || !binding?.payload_path || !devicesById) return null
  const device = devicesById.get(Number(binding.device_id))
  if (!device?.payload) return null
  const segs = String(binding.payload_path).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let node = device.payload
  for (const s of segs) {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return null
    node = node[s]
  }
  // Unwrap typed-scalar wrapper.
  if (node && typeof node === 'object' && !Array.isArray(node)
      && typeof node.type === 'string' && 'value' in node) {
    node = node.value
  }
  if (node === null || node === undefined) return null
  if (typeof node === 'object') return null            // arrays / nested
  return node
}

/* Format any scalar for display: numbers get 2-decimal rounding (or
   integer style when whole), booleans become On/Off, strings pass
   through. */
function formatValue(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number')  return Number.isInteger(v) ? String(v) : v.toFixed(2)
  if (typeof v === 'boolean') return v ? 'On' : 'Off'
  return String(v)
}

/* Pick a binding value (resolved live) or fall back to a sample. The
   picker preview omits `devicesById`, so it always shows the sample. */
function bValue(options, i, fallback) {
  const v = resolveBindingValue(options.bindings?.[i], options.devicesById)
  return v == null ? fallback : formatValue(v)
}

/* ---- preview "card" pieces, all sharing the .cv-card chrome ---- */
function PreviewSimpleValue({ options = {} }) {
  const { title, style } = useCardChrome(options, { title: 'Engine Temperature' })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-center">
        <div className="cv-big">{bValue(options, 0, '320')}</div>
        <div className="cv-sub">{bLabel(options, 0, 'Temperature')}</div>
      </div>
    </CvCard>
  )
}

function PreviewSimpleIcon({ options = {} }) {
  const { title, style, iconColor, icon } = useCardChrome(options, { title: 'Total Workorders', icon: '' })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-inline">
        <CvIcon name="hourglass" iconId={icon} color={iconColor} />
        <div className="cv-inline-body">
          <div className="cv-big">{bValue(options, 0, '320')}</div>
          <div className="cv-sub">{bLabel(options, 0, 'Work orders')}</div>
        </div>
      </div>
    </CvCard>
  )
}

function PreviewComparison({ options = {} }) {
  const { title, style, iconColor, icon, unit } = useCardChrome(options, {
    title: 'Fuel Consumption', icon: '', unit: 'Ltrs',
  })
  // Compute delta when both bindings resolve to numbers.
  const cur = resolveBindingValue(options.bindings?.[0], options.devicesById)
  const prev = resolveBindingValue(options.bindings?.[1], options.devicesById)
  let delta = null
  if (typeof cur === 'number' && typeof prev === 'number' && prev !== 0) {
    const pct = ((cur - prev) / prev) * 100
    delta = { sign: pct >= 0 ? 'up' : 'down', text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` }
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-inline">
        <CvIcon name="fuel" iconId={icon} color={iconColor} />
        <div className="cv-inline-body">
          <div className="cv-row">
            <span className="cv-big">{bValue(options, 0, '18.4')}</span>
            <span className="cv-unit">{unit}</span>
            {delta
              ? <span className={'cv-delta ' + delta.sign}>{delta.text}</span>
              : (options.devicesById ? null : <span className="cv-delta up">+40.2%</span>)}
          </div>
          <div className="cv-row-mini">
            <span className="cv-sub">{bLabel(options, 1, 'Yesterday')}</span>
          </div>
          <div className="cv-row">
            <span className="cv-mid">{bValue(options, 1, '30.2')}</span>
            <span className="cv-unit">{unit}</span>
          </div>
        </div>
      </div>
    </CvCard>
  )
}

function PreviewMultivalueGrid({ options = {} }) {
  const { title, style, iconColor, icon, unit } = useCardChrome(options, {
    title: 'Conf Room Data Trend', icon: '', unit: 'Celcius',
  })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-inline">
        <CvIcon name="thermometer" iconId={icon} color={iconColor} size="lg" />
        <div className="cv-grid-2x2">
          <Stat label={bLabel(options, 0, 'Minimum')}    value={bValue(options, 0, '14.2')} unit={unit} />
          <Stat label={bLabel(options, 1, 'Last Value')} value={bValue(options, 1, '14.4')} unit={unit} />
          <Stat label={bLabel(options, 2, 'Maximum')}    value={bValue(options, 2, '30.2')} unit={unit} />
          <Stat label={bLabel(options, 3, 'Average')}    value={bValue(options, 3, '18.4')} unit={unit} />
        </div>
      </div>
    </CvCard>
  )
}

function PreviewMultivalueRow({ options = {} }) {
  const { title, style, iconColor, unit } = useCardChrome(options, {
    title: 'Conf Room Data Trend', unit: 'Celcius',
  })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-row-3">
        <StatStacked icon="bolt"        iconId={bIcon(options, 0, '')} color={iconColor}
          label={bLabel(options, 0, 'Odometer - Last Value')} value={bValue(options, 0, '14.4')} unit={unit} />
        <StatStacked icon="drop"        iconId={bIcon(options, 1, '')} color={iconColor}
          label={bLabel(options, 1, 'Heat Level - Maximum')} value={bValue(options, 1, '18.4')} unit={unit} />
        <StatStacked icon="speedometer" iconId={bIcon(options, 2, '')} color={iconColor}
          label={bLabel(options, 2, 'RPM- Average')} value={bValue(options, 2, '30.2')} unit={unit} />
      </div>
    </CvCard>
  )
}

function PreviewMultivalueAssorted({ options = {} }) {
  const { title, style, iconColor } = useCardChrome(options, { title: 'Conf Room Details' })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-row-2">
        <div className="cv-inline">
          <CvIcon name="thermometer" iconId={bIcon(options, 0, '')} color={iconColor} />
          <Stat label={bLabel(options, 0, 'Sum (Today)')} value={bValue(options, 0, '14.4')} unit="Celcius" />
        </div>
        <div className="cv-inline">
          <CvIcon name="bell" iconId={bIcon(options, 1, '')} color={iconColor} />
          <Stat label={bLabel(options, 1, 'Alarms')} value={bValue(options, 1, '12')} />
        </div>
      </div>
    </CvCard>
  )
}

function PreviewTrend({ options = {} }) {
  const { title, style, iconColor, icon, unit } = useCardChrome(options, {
    title: 'Production Rate', icon: '', unit: '/hr',
  })
  // Optional delta when a 2nd binding holds the previous value.
  const cur = resolveBindingValue(options.bindings?.[0], options.devicesById)
  const trend = resolveBindingValue(options.bindings?.[1], options.devicesById)
  let delta = null
  if (typeof cur === 'number' && typeof trend === 'number' && trend !== 0) {
    const pct = ((cur - trend) / trend) * 100
    delta = { sign: pct >= 0 ? 'up' : 'down', text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` }
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-inline">
        <CvIcon name="chart" iconId={icon} color={iconColor} />
        <div className="cv-inline-body">
          <div className="cv-row">
            <span className="cv-big">{bValue(options, 0, '1,248')}</span>
            <span className="cv-unit">{unit}</span>
            {delta
              ? <span className={'cv-delta ' + delta.sign}>{delta.text}</span>
              : (options.devicesById ? null : <span className="cv-delta down">-3.1%</span>)}
          </div>
          <svg className="cv-spark" viewBox="0 0 80 24" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="0,18 10,14 20,16 30,8 40,12 50,6 60,9 70,4 80,7"
              fill="none" stroke={iconColor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </CvCard>
  )
}

function PreviewProgress({ options = {} }) {
  const { title, style } = useCardChrome(options, { title: 'Daily Target' })
  const targetNum = Number(options.target)
  const liveVal = resolveBindingValue(options.bindings?.[0], options.devicesById)
  // If we have both a numeric current value and a numeric target, compute
  // a percent; otherwise fall back to sample.
  let percent = 68
  let valueText = '68%'
  let doneText = '3,400 done'
  let leftText = '1,600 left'
  if (typeof liveVal === 'number' && Number.isFinite(targetNum) && targetNum > 0) {
    percent = Math.max(0, Math.min(100, (liveVal / targetNum) * 100))
    valueText = `${percent.toFixed(0)}%`
    doneText = `${formatValue(liveVal)} done`
    leftText = `${formatValue(Math.max(0, targetNum - liveVal))} left`
  } else if (typeof liveVal === 'number') {
    valueText = formatValue(liveVal)
  }
  const targetLabel = options.target ? `${options.target}` : '5,000'
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-stack">
        <div className="cv-progress-row">
          <span className="cv-big">{valueText}</span>
          <span className="cv-sub">of {targetLabel} units</span>
        </div>
        <div className="cv-bar"><span style={{ width: `${percent}%` }} /></div>
        <div className="cv-progress-foot">
          <span className="cv-sub">{doneText}</span>
          <span className="cv-sub">{leftText}</span>
        </div>
      </div>
    </CvCard>
  )
}

function PreviewStatus({ options = {} }) {
  const { title, style, iconColor, icon } = useCardChrome(options, {
    title: 'Compressor Status', icon: '',
  })
  const liveVal = resolveBindingValue(options.bindings?.[0], options.devicesById)
  // Truthy boolean / non-empty string → "running" (green); falsy → warning.
  let pillText = 'Running'
  let pillCls = 'ok'
  if (options.devicesById) {
    if (liveVal === false || liveVal === 0 || liveVal === '' || liveVal === null) {
      pillText = 'Down'
      pillCls = 'warn'
    } else if (typeof liveVal === 'string') {
      pillText = liveVal
    } else if (typeof liveVal === 'boolean') {
      pillText = liveVal ? 'On' : 'Off'
      pillCls = liveVal ? 'ok' : 'warn'
    } else if (typeof liveVal === 'number') {
      pillText = String(liveVal)
    }
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      <div className="cv-inline">
        <CvIcon name="bolt" iconId={icon} color={iconColor} />
        <div className="cv-inline-body">
          <span className={'cv-pill ' + pillCls}>{pillText}</span>
          <div className="cv-sub" style={{ marginTop: 6 }}>{bLabel(options, 0, 'Last update · live')}</div>
        </div>
      </div>
    </CvCard>
  )
}

function Stat({ label, value, unit }) {
  return (
    <div className="cv-stat">
      <div className="cv-stat-label">{label}</div>
      <div className="cv-stat-line">
        <span className="cv-mid">{value}</span>
        {unit && <span className="cv-unit">{unit}</span>}
      </div>
    </div>
  )
}

function StatStacked({ icon, iconId, color, label, value, unit }) {
  return (
    <div className="cv-stat-stacked">
      <CvIcon name={icon} iconId={iconId} color={color} />
      <div className="cv-stat-label cv-stat-label-center">{label}</div>
      <div className="cv-stat-line">
        <span className="cv-mid">{value}</span>
        {unit && <span className="cv-unit">{unit}</span>}
      </div>
    </div>
  )
}

function CvIcon({ name, iconId, color, size = 'md' }) {
  const hex = color || '#F36A1E'
  const chipStyle = { background: hexToRgba(hex, 0.16), color: hex }
  if (iconId) {
    return (
      <span className={'cv-ic cv-ic-' + size} style={chipStyle}>
        <img
          src={`https://api.iconify.design/${iconId}.svg?color=${encodeURIComponent(hex)}`}
          alt=""
          aria-hidden="true"
          style={{ width: '60%', height: '60%' }}
        />
      </span>
    )
  }
  const dim = size === 'lg' ? 36 : 28
  const s = { width: dim, height: dim, viewBox: '0 0 24 24', fill: 'none' }
  const stroke = 'currentColor'
  const sw = 1.7
  let body = null
  switch (name) {
    case 'hourglass':
      body = (<>
        <path d="M7 3h10M7 21h10" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <path d="M8 3v3a4 4 0 0 0 8 0V3M8 21v-3a4 4 0 0 1 8 0v3" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      </>)
      break
    case 'fuel':
      body = (<>
        <rect x="4.5" y="4.5" width="9" height="15" rx="1.6" stroke={stroke} strokeWidth={sw} />
        <path d="M4.5 11h9" stroke={stroke} strokeWidth={sw} />
        <path d="M13.5 9l3 1.5v6a1.5 1.5 0 0 1-1.5 1.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>)
      break
    case 'thermometer':
      body = (<>
        <path d="M12 4a2 2 0 0 1 2 2v8.2a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2z" stroke={stroke} strokeWidth={sw} />
        <circle cx="12" cy="17" r="2" fill={stroke} />
      </>)
      break
    case 'bell':
      body = (<>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <path d="M10 21h4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>)
      break
    case 'bolt':
      body = (<path d="M13 3 5 14h5l-1 7 8-11h-5l1-7z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />)
      break
    case 'drop':
      body = (<path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />)
      break
    case 'speedometer':
      body = (<>
        <circle cx="12" cy="12" r="8" stroke={stroke} strokeWidth={sw} />
        <path d="M12 12l4-3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <circle cx="12" cy="12" r="1" fill={stroke} />
      </>)
      break
    case 'chart':
      body = (<>
        <path d="M4 17l5-5 3 3 5-6 3 3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 20.5h17" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </>)
      break
    default: return null
  }
  return (
    <span className={'cv-ic cv-ic-' + size} style={chipStyle}>
      <svg {...s}>{body}</svg>
    </span>
  )
}


function PickerIcon({ name }) {
  const s = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' }
  const stroke = 'currentColor'
  const sw = 1.7
  switch (name) {
    case 'cards': return (
      <svg {...s}>
        <rect x="3.5" y="6.5" width="14" height="11" rx="2" stroke={stroke} strokeWidth={sw} />
        <path d="M7 4.5h11A2.5 2.5 0 0 1 20.5 7v9" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
    case 'charts': return (
      <svg {...s}>
        <path d="M4 17l5-5 3 3 5-6 3 3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 9h3v3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 20.5h17" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
    case 'custom_fill': return (
      <svg {...s}>
        <rect x="3.5" y="4.5" width="8" height="6" rx="1.5" stroke={stroke} strokeWidth={sw} />
        <rect x="13.5" y="4.5" width="7" height="4" rx="1.5" stroke={stroke} strokeWidth={sw} />
        <circle cx="6.5" cy="16.5" r="2.5" stroke={stroke} strokeWidth={sw} />
        <rect x="12" y="13" width="8.5" height="7" rx="1.5" stroke={stroke} strokeWidth={sw} />
      </svg>
    )
    case 'dials': return (
      <svg {...s}>
        <circle cx="12" cy="12" r="8.5" stroke={stroke} strokeWidth={sw} />
        <path d="M12 12l4-3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.2" fill={stroke} />
      </svg>
    )
    case 'image_cards': return (
      <svg {...s}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke={stroke} strokeWidth={sw} />
        <circle cx="9" cy="10" r="1.7" stroke={stroke} strokeWidth={sw} />
        <path d="M4.5 18l5-5 4.5 4 2-2 3.5 3.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    case 'tables': return (
      <svg {...s}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke={stroke} strokeWidth={sw} />
        <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" stroke={stroke} strokeWidth={sw} />
      </svg>
    )
    case 'calendar': return (
      <svg {...s}>
        <rect x="3.5" y="5.5" width="17" height="14" rx="2" stroke={stroke} strokeWidth={sw} />
        <path d="M3.5 9.5h17" stroke={stroke} strokeWidth={sw} />
        <path d="M8 3.5v3M16 3.5v3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <rect x="7" y="12" width="3" height="3" rx="0.5" fill={stroke} />
        <rect x="12" y="12" width="3" height="3" rx="0.5" fill={stroke} opacity="0.5" />
      </svg>
    )
    default: return null
  }
}
