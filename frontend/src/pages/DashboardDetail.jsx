import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Responsive, WidthProvider } from 'react-grid-layout'
import TopBar from '../components/TopBar.jsx'
import WsStatus from '../components/WsStatus.jsx'
import { PermissionDenied } from './Cameras.jsx'
import { api, auth, ApiError, parseApiErrors, WS_BASE } from '../lib/api.js'

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
const C3_ROWS = 4
const C3_GAP = 6
const C3_CELL_SIZE = 50
const C3_MIN_COLS = 12
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

/* ---- Mobile dashboard layout ----
   A SEPARATE, phone-optimised layout the admin builds AFTER the desktop
   dashboard. Each widget persists its phone placement inside its own
   config: config.mobile = { show:boolean, layout:{x,y,w,h} } — so the
   desktop layout (config.layout) is never touched. The grid is a simple
   4-column, vertically-compacting stack so it always reads tidy on a
   phone. The editor renders it inside a phone frame; the public end-user
   view renders it full-width in the device's real viewport. */
const MOBILE_COLS = 4
const MOBILE_GAP = 10
const MOBILE_ROW_H = 74
const MOBILE_DEFAULT_H = 3
const MOBILE_MIN_ROWS = 4   // empty-state drop-area height only
// Same 8 resize handles as the desktop containers, so the mobile widgets
// get the identical corner/edge "point" handles.
const MOBILE_RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne']
/* Device catalogue for the in-editor mobile simulator — mirrors the device
   list you'd find in a "mobile simulator" browser extension. `notch` picks
   the top cut-out: 'island' (pill), 'notch' (wide notch), 'punch' (camera
   dot) or 'none'. w/h are CSS logical px (portrait). `type` drives the
   bezel style (phone vs tablet). Grouped by `brand` in the picker. */
const MOBILE_DEVICES = [
  // ---- Apple · iPhone ----
  { id: 'ip-se',        brand: 'iPhone', label: 'iPhone SE',            w: 375, h: 667,  notch: 'none',   radius: 44, type: 'phone' },
  { id: 'ip-8plus',     brand: 'iPhone', label: 'iPhone 8 Plus',        w: 414, h: 736,  notch: 'none',   radius: 44, type: 'phone' },
  { id: 'ip-x',         brand: 'iPhone', label: 'iPhone X / XS',        w: 375, h: 812,  notch: 'notch',  radius: 48, type: 'phone' },
  { id: 'ip-xr',        brand: 'iPhone', label: 'iPhone XR / 11',       w: 414, h: 896,  notch: 'notch',  radius: 50, type: 'phone' },
  { id: 'ip-13mini',    brand: 'iPhone', label: 'iPhone 13 mini',       w: 360, h: 780,  notch: 'notch',  radius: 48, type: 'phone' },
  { id: 'ip-14',        brand: 'iPhone', label: 'iPhone 14',            w: 390, h: 844,  notch: 'notch',  radius: 50, type: 'phone' },
  { id: 'ip-14plus',    brand: 'iPhone', label: 'iPhone 14 Plus',       w: 428, h: 926,  notch: 'notch',  radius: 52, type: 'phone' },
  { id: 'ip-14pro',     brand: 'iPhone', label: 'iPhone 14 Pro',        w: 393, h: 852,  notch: 'island', radius: 54, type: 'phone' },
  { id: 'ip-15',        brand: 'iPhone', label: 'iPhone 15',            w: 393, h: 852,  notch: 'island', radius: 54, type: 'phone' },
  { id: 'ip-15promax',  brand: 'iPhone', label: 'iPhone 15 Pro Max',    w: 430, h: 932,  notch: 'island', radius: 56, type: 'phone' },
  { id: 'ip-16pro',     brand: 'iPhone', label: 'iPhone 16 Pro',        w: 402, h: 874,  notch: 'island', radius: 56, type: 'phone' },
  // ---- Google · Pixel ----
  { id: 'px-5',         brand: 'Pixel',  label: 'Pixel 5',              w: 393, h: 851,  notch: 'punch',  radius: 44, type: 'phone' },
  { id: 'px-7',         brand: 'Pixel',  label: 'Pixel 7',              w: 412, h: 915,  notch: 'punch',  radius: 44, type: 'phone' },
  { id: 'px-8',         brand: 'Pixel',  label: 'Pixel 8',              w: 412, h: 915,  notch: 'punch',  radius: 44, type: 'phone' },
  { id: 'px-8pro',      brand: 'Pixel',  label: 'Pixel 8 Pro',          w: 448, h: 998,  notch: 'punch',  radius: 46, type: 'phone' },
  // ---- Samsung · Galaxy ----
  { id: 'gs-s8',        brand: 'Galaxy', label: 'Galaxy S8',            w: 360, h: 740,  notch: 'none',   radius: 44, type: 'phone' },
  { id: 'gs-s10',       brand: 'Galaxy', label: 'Galaxy S10',           w: 360, h: 760,  notch: 'punch',  radius: 44, type: 'phone' },
  { id: 'gs-s20',       brand: 'Galaxy', label: 'Galaxy S20',           w: 360, h: 800,  notch: 'punch',  radius: 44, type: 'phone' },
  { id: 'gs-s23',       brand: 'Galaxy', label: 'Galaxy S23',           w: 360, h: 780,  notch: 'punch',  radius: 44, type: 'phone' },
  { id: 'gs-s23ultra',  brand: 'Galaxy', label: 'Galaxy S23 Ultra',     w: 384, h: 824,  notch: 'punch',  radius: 36, type: 'phone' },
  { id: 'gs-note20',    brand: 'Galaxy', label: 'Galaxy Note 20',       w: 412, h: 883,  notch: 'punch',  radius: 38, type: 'phone' },
  { id: 'gs-zflip',     brand: 'Galaxy', label: 'Galaxy Z Flip',        w: 360, h: 880,  notch: 'punch',  radius: 42, type: 'phone' },
  // ---- Other ----
  { id: 'op-11',        brand: 'Other',  label: 'OnePlus 11',           w: 412, h: 919,  notch: 'punch',  radius: 46, type: 'phone' },
  { id: 'xi-13',        brand: 'Other',  label: 'Xiaomi 13',            w: 393, h: 873,  notch: 'punch',  radius: 46, type: 'phone' },
  { id: 'nx-5',         brand: 'Other',  label: 'Nexus 5',              w: 360, h: 640,  notch: 'none',   radius: 36, type: 'phone' },
]
const MOBILE_DEVICE_BRANDS = ['iPhone', 'Pixel', 'Galaxy', 'Other']

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
}
function variantLayoutDefaults(variant) {
  if (!variant) return DEFAULT_WIDGET_LAYOUT
  return VARIANT_LAYOUT_DEFAULTS[variant] || CONTROL_LAYOUT_DEFAULTS[variant] || DIAL_LAYOUT_DEFAULTS[variant] || FILL_LAYOUT_DEFAULTS[variant] || CHART_LAYOUT_DEFAULTS[variant] || LOG_LAYOUT_DEFAULTS[variant] || DEFAULT_WIDGET_LAYOUT
}
function isControlVariant(v) { return !!(v && CONTROL_VARIANT_DEFS[v]) }
function isCardVariant(v)    { return !!(v && CARD_VARIANT_DEFS[v]) }
/* A sensible default phone size per widget category, so a freshly-added
   widget lands looking right: dials / fills are half-width (two pair up),
   cards & controls are full-width but short, charts & logs are taller. */
function mobileDefaultSize(c) {
  const v = c?.config?.variant
  if (v && CHART_VARIANT_DEFS[v])   return { w: 4, h: 3 }
  if (v && LOG_VARIANT_DEFS[v])     return { w: 4, h: 4 }
  if (v && DIAL_VARIANT_DEFS[v])    return { w: 2, h: 3 }
  if (v && FILL_VARIANT_DEFS[v])    return { w: 2, h: 3 }
  if (v && CONTROL_VARIANT_DEFS[v]) return { w: 4, h: 2 }
  if (v && CARD_VARIANT_DEFS[v])    return { w: 4, h: 2 }
  return { w: 4, h: MOBILE_DEFAULT_H }
}
/* First free slot (top→bottom, left→right) for a w×h block on the 4-col
   phone grid, given the current layout. Lets half-width widgets pair up
   neatly instead of stacking down the left edge. */
function findMobileSlot(layout, w, h) {
  const occupied = (x, y) => layout.some((l) =>
    x < (l.x + l.w) && (x + 1) > l.x && y < (l.y + l.h) && (y + 1) > l.y)
  const fits = (x, y) => {
    for (let dx = 0; dx < w; dx++)
      for (let dy = 0; dy < h; dy++)
        if (occupied(x + dx, y + dy)) return false
    return true
  }
  for (let y = 0; y < 400; y++)
    for (let x = 0; x <= MOBILE_COLS - w; x++)
      if (fits(x, y)) return { x, y }
  return { x: 0, y: 0 }
}
/* Mobile placement for a widget — reads config.mobile.layout, clamped to
   the 4-col phone grid; falls back to the per-category default size,
   stacked by index. */
function getMobileLayout(c, idx) {
  const stored = c?.config?.mobile?.layout
  const def = mobileDefaultSize(c)
  if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
    const w = Math.min(MOBILE_COLS, Math.max(1, stored.w ?? def.w))
    return {
      i: String(c.id),
      x: Math.max(0, Math.min(stored.x ?? 0, MOBILE_COLS - w)),
      y: stored.y,
      w,
      h: Math.max(2, stored.h ?? def.h),
      minW: 1, minH: 2,
    }
  }
  return { i: String(c.id), x: 0, y: idx * 3, w: def.w, h: def.h, minW: 1, minH: 2 }
}
/* True when the viewport is phone-sized — drives the public end-user view
   to render the mobile layout instead of the desktop containers. */
function useIsNarrow(maxWidth = 768) {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const handler = (e) => setNarrow(e.matches)
    mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler) }
  }, [maxWidth])
  return narrow
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
  { id: 'peach',    label: 'Peach',    bg: 'linear-gradient(180deg, #FED4B9 0%, #FFF0E7 100%)', text: '#4A2E18', sub: '#9A6A40' },
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
  // ──────────────  Light glass / translucent — pairs with light themes  ──────────────
  // `glass: true` triggers backdrop-filter blur in cardStyleFor so the
  // panel's gradient shows through.
  { id: 'glass_light',  label: 'Glass · Light',  bg: 'rgba(255, 255, 255, 0.32)',                                                                       text: '#14161C', sub: '#3C4458', glass: true },
  { id: 'frost',        label: 'Frost',          bg: 'linear-gradient(135deg, rgba(190,225,255,0.55) 0%, rgba(220,235,250,0.38) 100%)',                 text: '#0F2E50', sub: '#3F5E84', glass: true },
  // ──────────────  Warm honey / mustard (Crextio palette)  ──────────────
  { id: 'honey',     label: 'Honey',     bg: 'linear-gradient(135deg, #FFF5D6 0%, #FCE38A 100%)', text: '#3B2C0A', sub: '#806A2E' },
  { id: 'mustard',   label: 'Mustard',   bg: 'linear-gradient(135deg, #FBEFA5 0%, #F8DD6E 100%)', text: '#3B2C0A', sub: '#7B662A' },
  { id: 'latte',     label: 'Latte',     bg: 'linear-gradient(135deg, #FAF4E8 0%, #ECDDC4 100%)', text: '#3A2E18', sub: '#7E6B48' },
  { id: 'snow',      label: 'Snow',      bg: 'linear-gradient(135deg, #FFFFFF 0%, #F8F4EE 100%)', text: '#14161C', sub: '#7A7065' },
]
const ICON_COLORS = [
  { id: 'orange',   label: 'Orange',   hex: '#F36A1E' },
  { id: 'amber',    label: 'Amber',    hex: '#D89834' },
  { id: 'green',    label: 'Green',    hex: '#1FAE6B' },
  { id: 'teal',     label: 'Teal',     hex: '#0D9488' },
  { id: 'blue',     label: 'Blue',     hex: '#2D6EE0' },
  { id: 'indigo',   label: 'Indigo',   hex: '#6B4FCC' },
  { id: 'violet',   label: 'Violet',   hex: '#8B5CF6' },
  { id: 'pink',     label: 'Pink',     hex: '#D946A0' },
  { id: 'rose',     label: 'Rose',     hex: '#F43F5E' },
  { id: 'lime',     label: 'Lime',     hex: '#84CC16' },
  // Warm metallic accents for the honey/mustard dashboards
  { id: 'mustard',  label: 'Mustard',  hex: '#E6B800' },
  { id: 'gold',     label: 'Gold',     hex: '#D4AF37' },
  { id: 'bronze',   label: 'Bronze',   hex: '#B8860B' },
  // Neutrals — good contrast on any light card
  { id: 'slate',    label: 'Slate',    hex: '#475569' },
  { id: 'black',    label: 'Black',    hex: '#1A1A1A' },
]
function getCardColor(id)   { return CARD_COLORS.find((c) => c.id === id) || CARD_COLORS[0] }
function getIconColor(id)   { if (typeof id === 'string' && id.charAt(0) === '#') return { id, label: 'Custom', hex: id }; return ICON_COLORS.find((c) => c.id === id) || ICON_COLORS[0] }

/* Dashboard-level palettes. Each theme drives:
   – panel gradients (.db-group, .db-group-bottom)
   – cell tint + border
   – accent (the floating "+" add-widget button)
   – default card / icon color for newly-added widgets, so widgets
     inherit the dashboard's mood unless the user picks otherwise. */
const DASHBOARD_THEMES = [
  {
    id: 'peach', label: 'Peach',
    pageBg:     '#EEF2F5',
    panelBg:    '#FFF7F3',
    bottomBg:   '#FFF7F3',
    border:     'rgba(246, 220, 200, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.50)',
    cellBorder: 'rgba(248, 210, 188, 0.55)',
    accent:     '#F36A1E',
    accentLight:'#FF8A47',
    accentDeep: '#D85510',
    defaultCardColor: 'peach',
    defaultIconColor: 'orange',
  },
  // Smart-home reference palette: soft cream-peach page, light peach panels,
  // white widget cards, vibrant orange accent.
  {
    id: 'coral', label: 'Coral',
    pageBg:     '#F4E6D9',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(255,214,188,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(255,236,225,0.45), transparent 70%), linear-gradient(170deg, #FFF7F2 0%, #FDEADF 60%, #F9D8C7 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(255,214,188,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(255,236,225,0.45), transparent 70%), linear-gradient(190deg, #FFF9F5 0%, #FDEDE3 60%, #F9DBCB 100%)',
    border:     'rgba(250, 220, 200, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(250, 215, 195, 0.55)',
    accent:     '#F4661E',
    accentLight:'#FF8A47',
    accentDeep: '#D9540F',
    defaultCardColor: 'peach',
    defaultIconColor: 'orange',
  },
  {
    id: 'white', label: 'White',
    pageBg:     '#EDF0F3',
    panelBg:    '#FFFFFF',
    bottomBg:   '#FFFFFF',
    border:     'rgba(226, 231, 237, 0.95)',
    cellBg:     'rgba(248, 249, 251, 0.80)',
    cellBorder: 'rgba(226, 231, 237, 0.80)',
    accent:     '#475569',
    accentLight:'#677589',
    accentDeep: '#2F3A4E',
    defaultCardColor: 'snow',
    defaultIconColor: 'slate',
  },
  {
    id: 'mint', label: 'Mint',
    pageBg:     '#D8EBDF',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(180,225,200,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(220,240,225,0.45), transparent 70%), linear-gradient(170deg, #F5FAF7 0%, #E0F2E5 60%, #A4DDAB 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(180,225,200,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(220,240,225,0.45), transparent 70%), linear-gradient(190deg, #F7FBF8 0%, #E3F4E8 60%, #A8DEAF 100%)',
    border:     'rgba(190, 225, 200, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(180, 220, 195, 0.55)',
    accent:     '#1FAE6B',
    accentLight:'#3CC487',
    accentDeep: '#168A52',
    defaultCardColor: 'mint',
    defaultIconColor: 'green',
  },
  {
    id: 'lavender', label: 'Lavender',
    pageBg:     '#DDD0EC',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(210,195,240,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(232,222,248,0.45), transparent 70%), linear-gradient(170deg, #F8F5FC 0%, #ECE4F7 60%, #C5B5E5 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(210,195,240,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(232,222,248,0.45), transparent 70%), linear-gradient(190deg, #F9F6FC 0%, #EDE5F7 60%, #C8B8E7 100%)',
    border:     'rgba(220, 205, 240, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(210, 195, 235, 0.55)',
    accent:     '#6B4FCC',
    accentLight:'#876FD8',
    accentDeep: '#5238B5',
    defaultCardColor: 'lavender',
    defaultIconColor: 'indigo',
  },
  {
    id: 'slate', label: 'Slate',
    pageBg:     '#D7E0EA',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(195,210,225,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(225,232,240,0.45), transparent 70%), linear-gradient(170deg, #F8FAFC 0%, #E8EEF4 60%, #C8D2E0 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(195,210,225,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(225,232,240,0.45), transparent 70%), linear-gradient(190deg, #FAFBFC 0%, #EAF0F5 60%, #CCD5E2 100%)',
    border:     'rgba(200, 215, 230, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(195, 210, 225, 0.55)',
    accent:     '#475569',
    accentLight:'#677589',
    accentDeep: '#2F3A4E',
    defaultCardColor: 'slate',
    defaultIconColor: 'slate',
  },
  {
    id: 'sunset', label: 'Sunset',
    pageBg:     '#F4DCC4',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(255,200,160,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(255,225,200,0.45), transparent 70%), linear-gradient(170deg, #FFF5EF 0%, #FFE0CE 60%, #FFAA70 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(255,200,160,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(255,225,200,0.45), transparent 70%), linear-gradient(190deg, #FFF8F2 0%, #FFE3D2 60%, #FFB078 100%)',
    border:     'rgba(255, 210, 175, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(255, 205, 170, 0.55)',
    accent:     '#D85510',
    accentLight:'#FF7733',
    accentDeep: '#A8400B',
    defaultCardColor: 'sunset',
    defaultIconColor: 'orange',
  },
  {
    id: 'frost', label: 'Frost',
    pageBg:     '#CDDDED',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(200,225,250,0.65), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(225,240,255,0.55), transparent 70%), linear-gradient(170deg, #F0F6FB 0%, #DAE9F5 60%, #B5D0E8 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(200,225,250,0.65), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(225,240,255,0.55), transparent 70%), linear-gradient(190deg, #F2F7FC 0%, #DDEBF6 60%, #B8D3EA 100%)',
    border:     'rgba(180, 205, 230, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.50)',
    cellBorder: 'rgba(180, 205, 230, 0.55)',
    accent:     '#6B85FF',
    accentLight:'#8FA3FF',
    accentDeep: '#4A66E5',
    defaultCardColor: 'frost',
    defaultIconColor: 'blue',
  },
  // ─────────────  Warm honey / mustard themes  ─────────────
  // Light beige + mustard palette.
  {
    id: 'honey', label: 'Honey',
    pageBg:     '#E5D9B8',
    panelBg:    'radial-gradient(ellipse 110% 70% at 100% 0%, rgba(248,221,110,0.30), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(252,238,180,0.40), transparent 70%), linear-gradient(170deg, #FCFAF4 0%, #F7EFD8 60%, #F2E2B4 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 70% at 0% 0%, rgba(248,221,110,0.28), transparent 65%), radial-gradient(ellipse 110% 70% at 100% 100%, rgba(252,238,180,0.40), transparent 70%), linear-gradient(190deg, #FDFBF6 0%, #F8F2DC 60%, #F4E6BA 100%)',
    border:     'rgba(232, 215, 165, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.60)',
    cellBorder: 'rgba(232, 215, 165, 0.55)',
    accent:     '#E6B800',
    accentLight:'#F8DD6E',
    accentDeep: '#B89500',
    defaultCardColor: 'snow',
    defaultIconColor: 'mustard',
  },
  {
    id: 'mustard', label: 'Mustard',
    pageBg:     '#ECDFB8',
    panelBg:    'radial-gradient(ellipse 110% 70% at 100% 0%, rgba(248,221,110,0.45), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(252,238,180,0.50), transparent 70%), linear-gradient(170deg, #FDFAEB 0%, #FAF0BD 60%, #F8DD6E 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 70% at 0% 0%, rgba(248,221,110,0.40), transparent 65%), radial-gradient(ellipse 110% 70% at 100% 100%, rgba(252,238,180,0.50), transparent 70%), linear-gradient(190deg, #FDFBED 0%, #FBF2C0 60%, #F8E07A 100%)',
    border:     'rgba(232, 215, 130, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(232, 215, 130, 0.55)',
    accent:     '#D4AF37',
    accentLight:'#F8DD6E',
    accentDeep: '#A8860B',
    defaultCardColor: 'honey',
    defaultIconColor: 'gold',
  },
]
// Default theme when a dashboard has no theme set — always the first theme
// (index 0) in the palette.
const DEFAULT_THEME_ID = DASHBOARD_THEMES[0].id
function getTheme(id) {
  const custom = parseCustomTheme(id)
  if (custom) return buildCustomTheme(custom.hex, custom.mode)
  return DASHBOARD_THEMES.find((t) => t.id === id) || DASHBOARD_THEMES[0]
}
function themeCssVars(t) {
  return {
    '--db-page-bg':        t.pageBg,
    '--db-panel-bg':       t.panelBg,
    '--db-panel-bottom-bg': t.bottomBg,
    '--db-panel-border':   t.border,
    '--db-cell-bg':        t.cellBg,
    '--db-cell-border':    t.cellBorder,
    '--db-accent':         t.accent,
    '--db-accent-light':   t.accentLight,
    '--db-accent-deep':    t.accentDeep,
  }
}

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
// Build a card style from an arbitrary custom hex (the "custom color" the
// user picks from the palette). The chosen hex is the deep end of a soft
// gradient that fades lighter — mirroring the built-in bold gradients — and
// text color is chosen for contrast against that lighter end where data sits.
function hexToRgb(hex) {
  let h = String(hex).replace('#', '')
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
function mixWhite({ r, g, b }, t) {
  return {
    r: Math.round(r + (255 - r) * t),
    g: Math.round(g + (255 - g) * t),
    b: Math.round(b + (255 - b) * t),
  }
}
function mixBlack({ r, g, b }, t) {
  return {
    r: Math.round(r * (1 - t)),
    g: Math.round(g * (1 - t)),
    b: Math.round(b * (1 - t)),
  }
}
function rgbCss({ r, g, b }) { return `rgb(${r}, ${g}, ${b})` }
function rgbaCss({ r, g, b }, a) { return `rgba(${r}, ${g}, ${b}, ${a})` }

// A custom dashboard theme is encoded into the same short `theme` string
// the presets use, as `custom:<mode>:<hex>` (e.g. "custom:gradient:#F4A261"
// or "custom:solid:#3E7D52"). `mode` is the user's choice between a soft
// linear-gradient panel or a flat ("complete") single-color panel.
function parseCustomTheme(id) {
  if (typeof id !== 'string' || id.slice(0, 7) !== 'custom:') return null
  const parts = id.split(':')
  const mode = parts[1] === 'solid' ? 'solid' : 'gradient'
  const hex = (parts[2] && parts[2].charAt(0) === '#') ? parts[2] : '#F4A261'
  return { mode, hex }
}
function customThemeId(hex, mode) { return `custom:${mode === 'solid' ? 'solid' : 'gradient'}:${hex}` }

// Derive a full dashboard palette from a single base hex. Light tints drive
// the panel surfaces (so text stays readable) while the base hex drives the
// accent. In 'solid' mode the panels are a flat tint; in 'gradient' mode they
// fade like the built-in themes.
function buildCustomTheme(hex, mode) {
  const rgb = hexToRgb(hex)
  const veryLight = rgbCss(mixWhite(rgb, 0.92))
  const light     = rgbCss(mixWhite(rgb, 0.80))
  const lightMid  = rgbCss(mixWhite(rgb, 0.66))
  const tint      = rgbaCss(rgb, 0.20)
  const panelBg = mode === 'solid'
    ? light
    : `radial-gradient(ellipse 120% 80% at 100% 0%, ${tint}, transparent 65%), linear-gradient(170deg, ${veryLight} 0%, ${light} 60%, ${lightMid} 100%)`
  const bottomBg = mode === 'solid'
    ? veryLight
    : `radial-gradient(ellipse 110% 80% at 0% 0%, ${tint}, transparent 65%), linear-gradient(190deg, ${veryLight} 0%, ${light} 60%, ${lightMid} 100%)`
  // In gradient mode the page backdrop also gets a top→bottom gradient of the
  // chosen color (more saturated at the top, fading near-white) so the gradient
  // reads across the whole page, not just the panels. Solid mode stays a flat tint.
  const pageBg = mode === 'solid'
    ? rgbCss(mixWhite(rgb, 0.55))
    : `linear-gradient(180deg, ${rgbCss(mixWhite(rgb, 0.60))} 0%, ${veryLight} 100%)`
  return {
    id: customThemeId(hex, mode),
    label: 'Custom',
    pageBg,
    panelBg,
    bottomBg,
    border:      rgbaCss(mixWhite(rgb, 0.55), 0.85),
    cellBg:      'rgba(255, 255, 255, 0.55)',
    cellBorder:  rgbaCss(mixWhite(rgb, 0.50), 0.55),
    accent:      hex,
    accentLight: rgbCss(mixWhite(rgb, 0.28)),
    accentDeep:  rgbCss(mixBlack(rgb, 0.22)),
    defaultCardColor: hex,
    defaultIconColor: hex,
  }
}
// A plain hex card color renders as a FLAT solid fill (the gradient is opt-in
// via the picker's gradient toggle, which stores a full linear-gradient string
// instead). Text color is chosen for contrast against the solid fill.
function customCardStyle(hex) {
  const rgb = hexToRgb(hex)
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  const text = lum > 0.6 ? '#1C1407' : '#FFFFFF'
  const sub = lum > 0.6 ? 'rgba(28, 20, 7, 0.66)' : 'rgba(255, 255, 255, 0.78)'
  return {
    background: hex,
    color: text,
    '--cv-sub-color': sub,
  }
}
// Wrap a base hex into a linear gradient (chosen color at the start, fading to
// a near-white tint of itself). Direction defaults to 180deg (top → bottom).
function gradientFromHex(hex, deg = 180) {
  const light = rgbCss(mixWhite(hexToRgb(hex), 0.78))
  return `linear-gradient(${deg}deg, ${hex} 0%, ${light} 100%)`
}
// Pull the direction (degrees) out of a stored gradient string.
function gradientDirOf(value, fallback = 180) {
  if (typeof value === 'string') {
    const m = value.match(/linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg/)
    if (m) return Number(m[1])
  }
  return fallback
}
// Pull the base hex out of a stored card color (a gradient string OR a hex).
function baseHexOf(value, fallback = '#FED4B9') {
  if (typeof value === 'string') {
    const m = value.match(/#[0-9a-fA-F]{6}/)
    if (m) return m[0]
  }
  return fallback
}
// Selectable gradient directions, shown as arrow chips when gradient is on.
const GRADIENT_DIRS = [
  { deg: 180, label: '↓', title: 'Top → bottom' },
  { deg: 0,   label: '↑', title: 'Bottom → top' },
  { deg: 90,  label: '→', title: 'Left → right' },
  { deg: 270, label: '←', title: 'Right → left' },
  { deg: 135, label: '↘', title: 'Diagonal ↘' },
  { deg: 45,  label: '↗', title: 'Diagonal ↗' },
]

// Resolve any stored color value (gradient string, hex, or built-in id) to a
// CSS background for a preview swatch. `palette` is the relevant list to look
// ids up in (CARD_COLORS for backgrounds, ICON_COLORS for icon/bar colors).
function swatchBgForValue(v, palette = CARD_COLORS) {
  if (typeof v === 'string' && (v.charAt(0) === '#' || v.slice(0, 15) === 'linear-gradient')) return v
  const c = palette.find((x) => x.id === v)
  return c ? (c.bg || c.hex) : v
}
function cardStyleFor(colorId) {
  // A full CSS gradient can be stored verbatim (e.g. a top→bottom
  // "linear-gradient(180deg, #FED4B9 0%, #FFF0E7 100%)"). Used as-is for the
  // card surface; text defaults to the warm-dark ink that reads on the light
  // peach gradients.
  if (typeof colorId === 'string' && colorId.slice(0, 15) === 'linear-gradient') {
    return {
      background: colorId,
      color: '#3D2A18',
      '--cv-sub-color': 'rgba(61, 42, 24, 0.66)',
    }
  }
  // A custom color is stored as a raw hex string (e.g. "#3E7D52").
  if (typeof colorId === 'string' && colorId.charAt(0) === '#') {
    return customCardStyle(colorId)
  }
  const c = getCardColor(colorId)
  const style = {
    background: c.bg,
    color: c.text,
    '--cv-sub-color': c.sub,
  }
  // Glassy palettes use a translucent background — apply backdrop-filter
  // so the dashboard panel's gradient blurs through the card surface for
  // a real glass-morphism look. Includes -webkit- prefix for Safari.
  if (c.glass) {
    style.backdropFilter = 'blur(14px) saturate(1.4)'
    style.WebkitBackdropFilter = 'blur(14px) saturate(1.4)'
    style.border = '1px solid rgba(255, 255, 255, 0.18)'
  }
  return style
}

/* Card color picker — shows a single row of swatches by default (whatever
   fits the field width; the rest are clipped), with a "More" toggle that
   reveals the full palette, plus a rainbow custom-color chip that opens the
   native color picker. Shared by every card config form's Appearance section.
   The value is either a built-in color id or a raw hex string (custom). */
function ColorSwatchPicker({ value, onChange, disabled, colors, solid = false, fallbackCustom = '#F4A261', gradientToggle = false, usedColors = null }) {
  const [expanded, setExpanded] = useState(false)
  const isGradientVal = typeof value === 'string' && value.slice(0, 15) === 'linear-gradient'
  const isHexVal = typeof value === 'string' && value.charAt(0) === '#'
  const isCustom = isHexVal || isGradientVal
  const baseHex = baseHexOf(value, fallbackCustom)
  // Whether a picked custom color is wrapped in a gradient, and in which
  // direction. Defaults ON (gradient is the house style) unless the value is
  // already a flat hex. Only meaningful when gradientToggle is on (card bg).
  const [gradientOn, setGradientOn] = useState(gradientToggle ? (isGradientVal || !isCustom) : false)
  const [dir, setDir] = useState(() => gradientDirOf(value, 180))

  // Apply a base hex, wrapping it in a gradient (with the chosen direction)
  // when the toggle is on.
  const applyCustom = (hex) => onChange(gradientToggle && gradientOn ? gradientFromHex(hex, dir) : hex)
  const toggleGradient = () => {
    const next = !gradientOn
    setGradientOn(next)
    if (isCustom) onChange(next ? gradientFromHex(baseHex, dir) : baseHex)
  }
  const pickDir = (deg) => {
    setDir(deg)
    if (isCustom && gradientOn) onChange(gradientFromHex(baseHex, deg))
  }

  return (
    <div className="color-field">
      {/* Colors already used by other widgets in this dashboard — a quick way
          to reuse an existing background so the dashboard stays consistent. */}
      {usedColors && usedColors.length > 0 && (
        <div className="color-used" aria-label="Colors used in this dashboard">
          <span className="color-recents-label">Used</span>
          {usedColors.map((cc) => (
            <button
              key={cc}
              type="button"
              className={'color-swatch' + (solid ? ' color-swatch-solid' : '') + ' color-swatch-recent' + (value === cc ? ' is-active' : '')}
              style={{ background: swatchBgForValue(cc, colors) }}
              title={cc}
              aria-label="Reuse color"
              aria-pressed={value === cc}
              onClick={() => onChange(cc)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      <div className={'card-color-picker' + (expanded ? ' is-expanded' : '')}>
        <div className="color-swatches card-color-swatches">
          {colors.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'color-swatch' + (solid ? ' color-swatch-solid' : '') + (value === c.id ? ' is-active' : '')}
              style={{ background: c.bg || c.hex }}
              title={c.label}
              aria-label={c.label}
              aria-pressed={value === c.id}
              onClick={() => onChange(c.id)}
              disabled={disabled}
            />
          ))}
          {/* Custom-color palette chip — last item, so it only appears once the
              row is expanded via "More" (it's clipped off in the collapsed row). */}
          <label
            className={'color-swatch color-swatch-custom' + (isCustom ? ' is-active' : '')}
            title="Custom color"
            style={isCustom ? { background: value } : undefined}
          >
            <input
              type="color"
              value={baseHex}
              disabled={disabled}
              onChange={(e) => applyCustom(e.target.value)}
            />
            {!isCustom && (
              <svg className="color-swatch-custom-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2.5a9.5 9.5 0 1 0 0 19c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.9A4.4 4.4 0 0 0 22 11.5C22 6.5 17.5 2.5 12 2.5Z" stroke="currentColor" strokeWidth="1.6"/>
                <circle cx="7.5" cy="11" r="1.2" fill="currentColor"/>
                <circle cx="11" cy="7" r="1.2" fill="currentColor"/>
                <circle cx="15.5" cy="8" r="1.2" fill="currentColor"/>
              </svg>
            )}
          </label>
        </div>
        <button
          type="button"
          className="color-more-btn"
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          aria-expanded={expanded}
        >
          {expanded ? 'Less' : 'More'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {gradientToggle && (
        <div className="color-field-row">
          <button
            type="button"
            className={'color-grad-toggle' + (gradientOn ? ' is-on' : '')}
            onClick={toggleGradient}
            disabled={disabled}
            aria-pressed={gradientOn}
            title="Render the custom color as a linear gradient"
          >
            <span className="color-grad-track"><span className="color-grad-knob" /></span>
            Linear gradient
          </button>
          {gradientOn && (
            <div className="color-dir-picker" role="group" aria-label="Gradient direction">
              {GRADIENT_DIRS.map((d) => (
                <button
                  key={d.deg}
                  type="button"
                  className={'color-dir-btn' + (dir === d.deg ? ' is-active' : '')}
                  onClick={() => pickDir(d.deg)}
                  disabled={disabled}
                  title={d.title}
                  aria-label={d.title}
                  aria-pressed={dir === d.deg}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
// Card colors use gradient backgrounds (c.bg); icon/bar/gauge colors are solid
// hex chips (c.hex). Both get the same collapse + custom-palette behavior. Card
// backgrounds additionally get the gradient on/off + direction controls plus a
// "Used" row of colors already applied to other widgets in the dashboard.
function CardColorPicker(props) {
  return <ColorSwatchPicker {...props} colors={CARD_COLORS} fallbackCustom="#FED4B9" gradientToggle />
}
function IconColorPicker(props) {
  return <ColorSwatchPicker {...props} colors={ICON_COLORS} solid fallbackCustom="#F36A1E" />
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

/* ----- Access queue UI (public dashboards) ----- */
function fmtDuration(s) {
  s = Math.max(0, Math.round(s || 0))
  const m = Math.floor(s / 60), sec = s % 60
  return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`
}
/* Admin override bar (public dashboard / preview). Shows the live admin-control
   state to everyone, and lets an internal user seize / release control. */
function AdminControlBar({ queue, canTake, ready = true, onTake, onRelease }) {
  const adminActive = !!queue?.admin_active
  const iAmController = !!queue?.you?.is_admin_controller
  const adminName = queue?.admin_name
  const remaining = queue?.admin_remaining || 0
  if (iAmController) {
    return (
      <div className="db-admin-bar is-mine" title="You have taken control of this dashboard">
        <span className="db-admin-dot" aria-hidden="true" />
        You're in control · <strong>{fmtDuration(remaining)}</strong> left
        <button type="button" className="db-admin-btn db-admin-release" onClick={onRelease} disabled={!ready}>Release</button>
      </div>
    )
  }
  if (adminActive) {
    // Shown to public viewers and to other internal users (occupied).
    return (
      <div className="db-admin-bar is-locked" title="An administrator has taken control">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.9" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
        <strong>{adminName || 'An administrator'}</strong> is in control · {fmtDuration(remaining)}
      </div>
    )
  }
  if (canTake) {
    return (
      <div className="db-admin-bar">
        <button
          type="button"
          className="db-admin-btn db-admin-take"
          onClick={onTake}
          disabled={!ready}
          title={ready ? 'Override the access queue and control the dashboard for a set time' : 'Connecting…'}
        >
          {ready ? 'Take control' : 'Connecting…'}
        </button>
      </div>
    )
  }
  return null
}
function QueueBadge({ queue, ready = true, onJoin }) {
  const you = queue?.you || {}
  const active = queue?.active
  const waiting = queue?.waiting_count || 0
  if (you.is_controller) {
    return (
      <div className="db-queue-badge is-control" title="You have control">
        <span className="db-queue-dot" aria-hidden="true" />
        Your turn · <strong>{fmtDuration(queue?.control_remaining)}</strong> left
      </div>
    )
  }
  if (you.in_queue) {
    return (
      <div className="db-queue-badge is-wait">
        <span className="db-queue-pos">#{you.position}</span>
        ~<strong>{fmtDuration(you.wait_seconds)}</strong>
        <span className="db-queue-sep">·</span>
        {queue?.admin_active ? 'Admin is controlling' : (active ? `Now: ${active.name}` : 'Waiting…')}
      </div>
    )
  }
  return (
    <div className="db-queue-badge">
      <span className="db-queue-count">{waiting}</span> waiting
      <button type="button" className="db-queue-join" onClick={onJoin} disabled={!ready}>
        {ready ? 'Join queue' : 'Connecting…'}
      </button>
    </div>
  )
}
function QueueLobby({ queue, ready = true, onJoin }) {
  const active = queue?.active
  const waiting = queue?.waiting_count || 0
  const controlSeconds = queue?.control_seconds || 60
  // While an admin override is active the public timer is frozen, so the
  // "current control" time left is the admin's remaining window. Public viewers
  // never see the admin's name — only the time it adds to their wait.
  const adminActive = !!queue?.admin_active
  const currentRemaining = adminActive ? (queue?.admin_remaining || 0) : (queue?.control_remaining || 0)
  const estimate = currentRemaining + waiting * controlSeconds
  // Local "joining" spinner shown from the click until the server confirms
  // (which unmounts this lobby). A timeout re-enables the button if no
  // confirmation arrives, so it can never get stuck.
  const [joining, setJoining] = useState(false)
  useEffect(() => {
    if (!joining) return undefined
    const t = setTimeout(() => setJoining(false), 8000)
    return () => clearTimeout(t)
  }, [joining])
  const handleJoin = () => { if (ready && !joining) { setJoining(true); onJoin?.() } }
  return (
    <div className="db-queue-lobby" role="dialog" aria-label="Access queue">
      <div className="db-queue-lobby-card">
        <span className="db-queue-lobby-ic" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M16 6.5a3 3 0 0 1 0 5M17.5 19a5.5 5.5 0 0 0-3-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <h2>Access queue</h2>
        <p className="db-queue-lobby-sub">
          One visitor controls this dashboard at a time. Join the queue to take your turn —
          you can watch it live while you wait.
        </p>
        <div className="db-queue-lobby-stats">
          <div><div className="n">{waiting}</div><div className="l">In queue</div></div>
          <div><div className="n">{fmtDuration(currentRemaining)}</div><div className="l">Turn left</div></div>
          <div><div className="n">~{fmtDuration(estimate)}</div><div className="l">Your wait</div></div>
        </div>
        <div className="db-queue-lobby-now">
          {adminActive
            ? 'An administrator is controlling right now.'
            : active
              ? <>Now controlling: <strong>{active.name}</strong></>
              : 'No one is controlling right now.'}
        </div>
        <button
          type="button"
          className="btn-primary db-queue-lobby-join"
          onClick={handleJoin}
          disabled={!ready || joining}
          aria-busy={!ready || joining}
        >
          {!ready ? 'Connecting…' : joining ? (
            <><span className="db-queue-spinner" aria-hidden="true" /> Joining…</>
          ) : 'Join queue'}
        </button>
      </div>
    </div>
  )
}

export default function DashboardDetail({ publicMode = false } = {}) {
  const { appId, dashboardId } = useParams()
  const navigate = useNavigate()
  // Public mode (anon view-only) skips the sign-in redirect and treats
  // the user as a read-only viewer — no edit / no delete, but view is
  // permitted because the backend has already gated the dashboard via
  // the publish flag.
  if (!publicMode && !auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const canView   = publicMode ? true  : auth.hasPerm('application_view')
  const canUpdate = publicMode ? false : auth.hasPerm('application_update')
  const canDelete = publicMode ? false : auth.hasPerm('application_delete')

  const [dashboard, setDashboard] = useState(null)
  const [appCameras, setAppCameras] = useState([])
  const [allCameras, setAllCameras] = useState([])
  const [devices, setDevices]       = useState([])
  const [components, setComponents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCamId, setSelectedCamId] = useState(null)
  const [previewMode, setPreviewMode] = useState(false)
  // Which layout the admin is editing: the desktop/tablet grid or the
  // phone layout. Public viewers never touch this — their view is chosen
  // automatically from the real screen width (see isNarrow below).
  // Default the editor viewport to the device that matches the screen: phones
  // (narrow / portrait) open straight to the Mobile layout, larger screens to
  // Desktop. The user can still switch with the toolbar toggle.
  const [editViewport, setEditViewport] = useState(() => {
    if (typeof window === 'undefined') return 'desktop'
    const narrow = window.matchMedia
      ? window.matchMedia('(max-width: 768px)').matches
      : window.innerWidth <= 768
    const portrait = window.innerHeight >= window.innerWidth
    return (narrow || portrait) ? 'mobile' : 'desktop'
  }) // 'desktop' | 'mobile'
  const isNarrow = useIsNarrow(768)
  const previewShellRef = useRef(null)
  const [widgetModal, setWidgetModal] = useState(null)     // {mode:'create'|'edit', form}
  const [pickerOpen, setPickerOpen] = useState(false)      // category-picker popup (opens from "+")
  const [targetContainer, setTargetContainer] = useState(2) // which container gets the new widget
  const [editingWidget, setEditingWidget] = useState(null) // existing card-widget being edited
  const [confirmDelete, setConfirmDelete] = useState(null) // component being deleted
  const [toast, setToast] = useState(null)

  // Dashboard color theme. Source of truth is Dashboard.theme on the
  // server (loaded once with the dashboard, PATCHed on change). We
  // also cache the latest value in localStorage so the first paint
  // after reload uses the user's choice instead of flashing the
  // default peach while the dashboard fetch is in flight.
  const themeKey = `kiosk-db-theme-${dashboardId}`
  const [themeId, setThemeId] = useState(() => {
    try { return localStorage.getItem(themeKey) || DEFAULT_THEME_ID } catch { return DEFAULT_THEME_ID }
  })
  // Tracks the last theme we know the server already has, so the
  // auto-PATCH effect doesn't fire for changes that came FROM the
  // server (initial load + cross-tab sync).
  const themePersistRef = useRef(themeId)

  // Custom theme: the user-picked base color and the gradient/solid mode.
  // Kept in local state so toggling the mode keeps the chosen color (and
  // vice-versa) without re-deriving from the encoded theme string. Seeded
  // from the current theme if it's already a custom one.
  const initCustom = parseCustomTheme(themeId)
  const [customHex, setCustomHex] = useState(initCustom?.hex || '#F4A261')
  const [customMode, setCustomMode] = useState(initCustom?.mode || 'gradient')
  const isCustomTheme = typeof themeId === 'string' && themeId.slice(0, 7) === 'custom:'

  // Adopt server theme once the dashboard loads.
  useEffect(() => {
    const serverTheme = dashboard?.theme
    if (serverTheme && serverTheme !== themeId) {
      themePersistRef.current = serverTheme
      setThemeId(serverTheme)
      const c = parseCustomTheme(serverTheme)
      if (c) { setCustomHex(c.hex); setCustomMode(c.mode) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.theme])

  // Cache locally for instant first-paint on next reload.
  useEffect(() => {
    try { localStorage.setItem(themeKey, themeId) } catch {}
  }, [themeKey, themeId])

  // Push to backend on user-initiated change. Skipped when the new
  // value matches what the server already has (no-op churn). Also
  // skipped in public mode — the read-only viewer can't mutate.
  useEffect(() => {
    if (publicMode) return
    if (!dashboard?.id) return
    if (themePersistRef.current === themeId) return
    themePersistRef.current = themeId
    api.updateDashboard(dashboard.id, { theme: themeId }).catch(() => {})
  }, [themeId, dashboard?.id, publicMode])

  // Per-viewport publish state. The admin activates the Desktop and the
  // Mobile layout independently — the toggle in the toolbar acts on whichever
  // viewport is currently being edited. Persisted immediately (optimistic).
  const publishKey = editViewport === 'mobile' ? 'publish_mobile' : 'publish_desktop'
  const isViewportPublished = !!dashboard?.[publishKey]
  // Widgets can only be edited while the layout shown in the editor is
  // UNPUBLISHED. Publishing a viewport locks it (no add / edit / delete /
  // drag / resize) — the admin unpublishes to make changes, then re-publishes.
  const editingLocked = !publicMode && isViewportPublished
  const canEditLayout = canUpdate && !editingLocked
  const canDeleteLayout = canDelete && !editingLocked
  // The theme/colours are shared across BOTH viewports, so changing them would
  // alter a live published layout. Lock the theme picker whenever either the
  // desktop OR the mobile layout is published (unpublish to recolour).
  const themeLocked = !publicMode && (!!dashboard?.publish_desktop || !!dashboard?.publish_mobile)
  const [publishBusy, setPublishBusy] = useState(false)
  // Caution shown before unpublishing while public viewers are live on the
  // dashboard: { next, status } — confirmed via the modal below.
  const [publishCaution, setPublishCaution] = useState(null)

  async function applyPublish(next) {
    const label = editViewport === 'mobile' ? 'Mobile' : 'Desktop'
    setPublishBusy(true)
    setDashboard((d) => ({ ...d, [publishKey]: next }))   // optimistic
    try {
      const resp = await api.updateDashboard(dashboard.id, { [publishKey]: next })
      // Sync with the server's authoritative flags (incl. derived `publish`).
      setDashboard((d) => ({ ...d, publish: resp?.publish ?? d.publish, [publishKey]: resp?.[publishKey] ?? next }))
      setToast({ type: 'success', text: `${label} layout ${next ? 'published' : 'unpublished'}.` })
    } catch {
      setDashboard((d) => ({ ...d, [publishKey]: !next }))  // revert
      setToast({ type: 'error', text: 'Could not update publish status.' })
    } finally {
      setPublishBusy(false)
    }
  }

  async function togglePublish() {
    if (publicMode || !dashboard?.id || publishBusy) return
    const next = !dashboard[publishKey]
    // Unpublishing → if public viewers are currently in the access queue or
    // controlling the dashboard, warn first (they'll be evicted on confirm).
    if (!next) {
      let status = null
      try { status = await api.dashboardQueueStatus(dashboard.id) } catch { /* best-effort */ }
      if (status?.active) { setPublishCaution({ next, status }); return }
    }
    applyPublish(next)
  }

  const activeTheme = getTheme(themeId)
  const themeVars   = themeCssVars(activeTheme)

  // Tint the page (window) scrollbar to the active theme while a dashboard is
  // shown — thin + subtle. A route-scoped class on <html> lets us style the
  // browser scrollbar (which CSS can't otherwise target per-page); the accent
  // is passed through a CSS var and both are cleaned up on unmount.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('db-scrollbars')
    root.style.setProperty('--db-scroll-accent', activeTheme.accent || '#F36A1E')
    return () => {
      root.classList.remove('db-scrollbars')
      root.style.removeProperty('--db-scroll-accent')
    }
  }, [activeTheme.accent])


  // Distinct card-background colors already used by widgets in this dashboard,
  // surfaced in the widget editor's color picker so new/edited widgets can
  // reuse an existing background and keep the dashboard consistent.
  const usedCardColors = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const c of components) {
      const cc = c?.config?.static?.card_color
      if (typeof cc === 'string' && cc && !seen.has(cc)) { seen.add(cc); out.push(cc) }
    }
    return out
  }, [components])
  // Same idea for icon/bar colors — distinct icon colors already in use.
  const usedIconColors = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const c of components) {
      const st = c?.config?.static || {}
      for (const ic of [st.icon_color, st.bar_color]) {
        if (typeof ic === 'string' && ic && ic !== 'none' && !seen.has(ic)) { seen.add(ic); out.push(ic) }
      }
    }
    return out
  }, [components])

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
      // Track already-placed Container-2 rectangles so we can reveal any widget
      // that an older (occupancy-blind) add dropped on top of another — those
      // would otherwise stay hidden behind it and look "missing" on desktop.
      const placedC2 = []
      const collides = (a) => placedC2.some((b) =>
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
      return components.map((c, idx) => {
        const base = prevById.get(String(c.id)) || getWidgetLayout(c, idx, c2Cols)
        // Container-3 widgets live in their own grid; leave their (unused here)
        // entry as-is and don't factor them into Container-2 occupancy.
        if (Number(c.config?.container) === 3) return base
        let item = { ...base }
        let guard = 0
        while (collides(item) && guard++ < 500) item = { ...item, y: item.y + 1 }
        placedC2.push(item)
        return item
      })
    })
  }, [components, c2Cols])

  // Measure the visible stage height so the grid's MINIMUM row count is
  // however many rows actually fit the container — not a hardcoded number.
  // This way an empty (or under-filled) container shows exactly enough rows
  // to fill itself with no leftover empty rows below and no scrolling;
  // removing widgets collapses the grid right back to the container.
  const c2StageRef = useRef(null)
  const [c2FitRows, setC2FitRows] = useState(C2_MIN_ROWS)
  useEffect(() => {
    let raf = 0
    function measure() {
      const el = c2StageRef.current
      if (!el) return
      const h = el.clientHeight
      if (h > 0) {
        const fit = Math.max(1, Math.floor((h + C2_GAP) / (C2_CELL_SIZE + C2_GAP)))
        setC2FitRows((prev) => (prev === fit ? prev : fit))
      }
    }
    // The stage only mounts after the dashboard loads (and when not in the
    // mobile viewport), so retry on the next frame until the ref exists, and
    // observe it for later size changes.
    measure()
    raf = requestAnimationFrame(measure)
    const ro = (typeof ResizeObserver !== 'undefined' && c2StageRef.current) ? new ResizeObserver(measure) : null
    if (ro && c2StageRef.current) ro.observe(c2StageRef.current)
    if (typeof window !== 'undefined') window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
    }
  }, [loading, dashboard, editViewport])

  // c2Rows = how many rows the cell grid renders. The floor is "rows that
  // fit the container" so the grid never spills past the visible stage when
  // empty; it only grows (and the stage scrolls) when a widget genuinely
  // occupies a lower row. No buffer / no empty extras.
  const c2Rows = useMemo(() => {
    let maxBottom = 0
    for (const it of c2Layout) maxBottom = Math.max(maxBottom, (it.y || 0) + (it.h || 0))
    return Math.max(c2FitRows, maxBottom)
  }, [c2Layout, c2FitRows])

  const c2StageH = c2Rows * C2_CELL_SIZE + Math.max(0, c2Rows - 1) * C2_GAP
  // True when the grid is taller than the visible stage — the vertical
  // scrollbar shows, so we inset the widgets to leave it a clear lane.
  const c2HasVScroll = c2Rows > c2FitRows

  function onC2LayoutChange(curr) {
    // Immediate UI update — RGL now has snapped (integer) x/y/w/h, so
    // the widget lands on the nearest cell instead of holding the mid-
    // drag pixel position.
    setC2Layout(curr)
    for (const item of curr) {
      persistWidgetLayout(item.i, item.x, item.y, item.w, item.h)
    }
  }

  // Container 3 — horizontal-scroll grid. Widgets with config.container===3.
  const c3Components = useMemo(() => components.filter((c) => Number(c.config?.container) === 3), [components])
  const c2Components = useMemo(() => components.filter((c) => Number(c.config?.container) !== 3), [components])

  const c3StageRef = useRef(null)
  const [c3PanelW, setC3PanelW] = useState(0)
  useEffect(() => {
    let raf = 0
    function measure() {
      const el = c3StageRef.current
      if (!el) return
      // Measure parent (panel) inner width, NOT the stage itself —
      // stage width can shrink when scrollbars appear, causing the fit
      // calculation to oscillate. Parent inner width is stable.
      const parent = el.parentElement
      const w = parent ? parent.clientWidth - 32 /* db-group padding */ : el.clientWidth
      if (w > 0) setC3PanelW(w)
    }
    function tick() {
      measure()
      raf = requestAnimationFrame(measure)
    }
    tick()
    const parent = c3StageRef.current?.parentElement
    const ro = new ResizeObserver(measure)
    if (parent) ro.observe(parent)
    if (c3StageRef.current) ro.observe(c3StageRef.current)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // Re-run once the stage actually mounts (it only renders after the
    // dashboard loads and when not in the mobile viewport). Without this the
    // effect runs at mount with a null ref, c3PanelW stays 0, and the column
    // math falls back to window width — overshooting the real panel and
    // showing a phantom horizontal scroll.
  }, [loading, dashboard, editViewport])

  // c3FitCols = number of 50px cells that fit COMPLETELY inside the visible
  // stage (uses floor — no half-cut cells, no overflow that would trigger
  // a scrollbar by default). Small remainder space (<56px) sits as natural
  // padding on the right.
  const c3FitCols = useMemo(() => {
    const w = c3PanelW > 0
      ? c3PanelW
      : (typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 120) : 0)
    if (w <= 0) return C3_MIN_COLS
    return Math.max(C3_MIN_COLS, Math.floor((w + C3_GAP) / (C3_CELL_SIZE + C3_GAP)))
  }, [c3PanelW])

  const [c3Layout, setC3Layout] = useState([])
  useEffect(() => {
    setC3Layout((prev) => {
      const prevById = new Map(prev.map((l) => [l.i, l]))
      return c3Components.map((c, idx) => {
        const existing = prevById.get(String(c.id))
        if (existing) return existing
        return getWidgetLayout(c, idx, c3FitCols)
      })
    })
  }, [c3Components, c3FitCols])

  // Per-widget: prefer local layout (so dragging a widget BACK from an
  // extended position shrinks the grid immediately, before the PATCH lands).
  // Fall back to server-state only for widgets not yet seeded into c3Layout
  // (the first-paint window between mount and the seeding effect).
  const c3MaxRight = useMemo(() => {
    let maxRight = 0
    const localById = new Map(c3Layout.map((l) => [l.i, l]))
    for (const c of c3Components) {
      const local = localById.get(String(c.id))
      if (local) {
        maxRight = Math.max(maxRight, (local.x || 0) + (local.w || 0))
      } else {
        const s = c.config?.layout
        if (s && Number.isFinite(s.x) && Number.isFinite(s.w)) {
          maxRight = Math.max(maxRight, s.x + s.w)
        }
      }
    }
    return maxRight
  }, [c3Components, c3Layout])

  // Mirror Container 2 vertically: cells have a CONSISTENT pixel width
  // (effCellW) that's chosen to fill the visible panel exactly when no
  // widget extends past the fit. When a widget DOES extend past, we keep
  // the same effCellW and just add more cells — content width grows past
  // the panel width and the stage scrolls horizontally. No cell-size jump
  // between modes, same way C2 keeps row height at 50px in both modes.
  const c3EffCellW = c3PanelW > 0
    ? Math.max(C3_CELL_SIZE, (c3PanelW - (c3FitCols - 1) * C3_GAP) / c3FitCols)
    : C3_CELL_SIZE
  // During drag/resize we add extra cols so RGL allows the widget to be
  // moved into the scroll region (RGL's `cols` is the hard limit on x+w).
  // Mirrors C2 where rows aren't capped, so widgets can be dragged past
  // the visible area to grow the panel.
  const [c3Interacting, setC3Interacting] = useState(false)
  const C3_DRAG_BUFFER = 12
  const c3BaseCols = Math.max(c3FitCols, c3MaxRight)
  const c3Cols = c3BaseCols + (c3Interacting ? C3_DRAG_BUFFER : 0)
  const c3StageH = C3_ROWS * C3_CELL_SIZE + Math.max(0, C3_ROWS - 1) * C3_GAP
  // Overflow = there are more cols than the panel can fit. In that case we
  // commit to an explicit pixel width so the stage actually scrolls. When
  // NOT overflowing, we use width:100% + 1fr cells (mirrors C2 vertically)
  // so the grid fills the panel exactly via CSS — no JS rounding, no
  // accidental 1-pixel overflow that would show a phantom scrollbar.
  const c3HasOverflow = c3Cols > c3FitCols
  const c3StageW = c3Cols * c3EffCellW + Math.max(0, c3Cols - 1) * C3_GAP

  function onC3LayoutChange(curr) {
    setC3Layout(curr)
    for (const item of curr) {
      persistWidgetLayout(item.i, item.x, item.y, item.w, item.h)
    }
  }

  /* ---------------------- Mobile layout ----------------------
     The widgets the admin chose to surface on phones, ordered top→bottom
     by their saved phone-row. The mobile grid auto-compacts vertically,
     so order is what matters most; x/w give the side-by-side pairing. */
  const mobileComponents = useMemo(
    () => components
      .filter((c) => c.config?.mobile?.show)
      .sort((a, b) => (a.config?.mobile?.layout?.y ?? 0) - (b.config?.mobile?.layout?.y ?? 0)),
    [components],
  )
  const [mLayout, setMLayout] = useState([])
  useEffect(() => {
    setMLayout((prev) => {
      const prevById = new Map(prev.map((l) => [l.i, l]))
      return mobileComponents.map((c, idx) => prevById.get(String(c.id)) || getMobileLayout(c, idx))
    })
  }, [mobileComponents])

  // Persist a widget's PHONE placement into config.mobile.layout without
  // disturbing config.layout (desktop). Mirrors the desktop debounce +
  // sequence-guard so out-of-order PATCH responses can't clobber state.
  const mobileSeqRef = useRef({})
  const mobilePersistRef = useRef({})
  const flushMobileLayout = useCallback(async (id, x, y, w, h) => {
    const target = components.find((c) => String(c.id) === String(id))
    if (!target) return
    const prevMobile = target.config?.mobile || {}
    const nextConfig = { ...(target.config || {}), mobile: { ...prevMobile, show: true, layout: { x, y, w, h } } }
    const mySeq = (mobileSeqRef.current[id] || 0) + 1
    mobileSeqRef.current[id] = mySeq
    try {
      const resp = await api.updateDashboardComponent(target.id, { config: nextConfig })
      if (mobileSeqRef.current[id] !== mySeq) return
      const updated = resp?.component
      if (updated) setComponents((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch {/* keep on-screen position; user can drag again to retry */}
  }, [components])
  const persistMobileLayout = useCallback((id, x, y, w, h) => {
    const sig = `${x},${y},${w},${h}`
    const target = components.find((c) => String(c.id) === String(id))
    const saved = target?.config?.mobile?.layout
    if (saved && saved.x === x && saved.y === y && saved.w === w && saved.h === h) {
      mobilePersistRef.current[id] = { sig, timer: null }; return
    }
    if (mobilePersistRef.current[id]?.sig === sig) return
    if (mobilePersistRef.current[id]?.timer) clearTimeout(mobilePersistRef.current[id].timer)
    const timer = setTimeout(() => { flushMobileLayout(id, x, y, w, h) }, 250)
    mobilePersistRef.current[id] = { sig, timer }
  }, [flushMobileLayout, components])

  // onLayoutChange only mirrors RGL's snapped result into state (no PATCH —
  // vertical compaction re-emits on every mount, which would otherwise spam
  // the backend). Persistence happens on drag/resize STOP for the whole
  // (possibly reflowed) set; the equality guard skips untouched widgets.
  function onMobileLayoutChange(curr) { setMLayout(curr) }
  function onMobilePersistAll(curr) {
    setMLayout(curr)
    for (const it of curr) persistMobileLayout(it.i, it.x, it.y, it.w, it.h)
  }

  const [mobileBusy, setMobileBusy] = useState(null) // id mid-toggle
  async function toggleMobileInclude(c) {
    const isIn = !!c.config?.mobile?.show
    setMobileBusy(c.id)
    try {
      let nextConfig
      if (isIn) {
        nextConfig = { ...(c.config || {}), mobile: { ...(c.config?.mobile || {}), show: false } }
      } else {
        // Place the new card in the first free slot, sized by its category
        // (dials/fills half-width pair up, cards/charts span full width).
        const def = mobileDefaultSize(c)
        const slot = findMobileSlot(mLayout, def.w, def.h)
        const layout = { x: slot.x, y: slot.y, w: def.w, h: def.h }
        nextConfig = { ...(c.config || {}), mobile: { show: true, layout } }
      }
      setComponents((prev) => prev.map((x) => (x.id === c.id ? { ...x, config: nextConfig } : x)))
      await api.updateDashboardComponent(c.id, { config: nextConfig })
    } catch {
      setToast({ type: 'error', text: 'Could not update the mobile layout.' })
      // Roll back the optimistic toggle on failure.
      setComponents((prev) => prev.map((x) => (x.id === c.id ? c : x)))
    } finally {
      setMobileBusy(null)
    }
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Esc exits preview — common pattern for fullscreen-style views. Releasing
  // control on the way out (no-op if not holding) so the public queue resumes.
  useEffect(() => {
    if (!previewMode) return undefined
    const handler = (e) => { if (e.key === 'Escape') { releaseControl(); setPreviewMode(false) } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewMode])

  // The desktop preview renders the dashboard RESPONSIVELY (exactly like the
  // public view) so it fills the page width and bottom — no fixed-size scaling
  // that would leave side margins. Clear any leftover inline transform; the CSS
  // (.db-page.is-preview) handles the full-width, top-reserved layout.
  useEffect(() => {
    const shell = previewShellRef.current
    if (shell) shell.style.transform = ''
  }, [previewMode])

  /* ---- loaders ---- */
  const loadAll = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      if (publicMode) {
        // One-shot public load: backend returns dashboard + application +
        // cameras (just camera_details) + components + devices (initial
        // payload snapshot) in a single response. No auth header is sent.
        const resp = await api.publicLoadDashboard(dashboardId)
        setDashboard(resp?.dashboard || null)
        // Reshape camera_details into the link-shaped objects the rest
        // of the page expects ({ camera_details: <camera> } per entry).
        const camList = resp?.cameras?.camera_details || []
        setAppCameras(camList.map((cam, i) => ({ id: `pub-${cam.id ?? i}`, camera_details: cam, is_primary: i === 0 })))
        setDevices(Array.isArray(resp?.devices) ? resp.devices : [])
        setComponents(Array.isArray(resp?.components) ? resp.components : [])
        return
      }
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
  }, [appId, dashboardId, canView, publicMode])

  const reloadComponents = useCallback(async () => {
    try {
      const comps = await api.listDashboardComponents({ dashboard: dashboardId })
      setComponents(comps?.components ?? (Array.isArray(comps) ? comps : []))
    } catch {}
  }, [dashboardId])

  const loadCatalog = useCallback(async () => {
    if (!canView) return
    // listCameras() requires auth and is only used to populate the
    // camera-picker when editing dashboard cameras. Public viewers
    // never edit, so we skip it entirely.
    if (publicMode) return
    try {
      const resp = await api.listCameras()
      const list = resp?.cameras ?? (Array.isArray(resp) ? resp : (resp?.results || []))
      setAllCameras(list)
    } catch {
      setAllCameras([])
    }
  }, [canView, publicMode])

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

  // Ref to the live dashboard WebSocket, exposed so control widgets
  // (toggle / button / slider / text input) can write back to the
  // device payload through the same socket the dashboard reads from.
  const dashboardWsRef = useRef(null)
  // Live connection status of that socket. Auto-reconnects forever with
  // exponential backoff (no manual reconnect button).
  const [wsStatus, setWsStatus] = useState('connecting') // connecting | reconnecting | live | offline

  // Stable per-session identity for the access queue (kept across reconnects).
  const queueMemberRef = useRef(null)
  if (!queueMemberRef.current) {
    let mid = null, nm = null
    try {
      mid = sessionStorage.getItem('kiosk-queue-member')
      nm = sessionStorage.getItem('kiosk-queue-name')
    } catch {}
    if (!mid) { mid = 'm-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }
    if (!nm) { nm = 'Guest ' + Math.floor(1000 + Math.random() * 9000) }
    try { sessionStorage.setItem('kiosk-queue-member', mid); sessionStorage.setItem('kiosk-queue-name', nm) } catch {}
    queueMemberRef.current = { id: mid, name: nm }
  }
  // Live queue state (null until the queue socket reports). Refs mirror the
  // derived gate so the stable sendDashboardCommand callback isn't stale.
  const [queue, setQueue] = useState(null)
  // Live connection status of the queue socket — gates Join queue / Take control
  // so they're disabled until the socket is actually connected.
  const [queueWsStatus, setQueueWsStatus] = useState('connecting')
  // Set when the backend tells us the dashboard was unpublished while we were
  // viewing it publicly — flips the view to the "no dashboard published" state.
  const [queueClosed, setQueueClosed] = useState(false)
  const queueWsRef = useRef(null)
  const controlRef = useRef(true)
  const queueOnRef = useRef(false)

  const sendDashboardCommand = useCallback((deviceId, action, path, payload) => {
    const ws = dashboardWsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setToast({ type: 'error', text: 'Not connected — try again in a moment.' })
      return false
    }
    // Access-queue read-only gate: only the current controller may write.
    if (queueOnRef.current && !controlRef.current) {
      setToast({ type: 'error', text: 'Read-only — wait for your turn to control.' })
      return false
    }
    const msg = { device_id: Number(deviceId), action, path: String(path || '') }
    if (action !== 'delete') msg.payload = payload
    if (queueMemberRef.current) msg.member_id = queueMemberRef.current.id
    try { ws.send(JSON.stringify(msg)); return true } catch { return false }
  }, [])

  // Derived gate: queue active (public + enabled) and whether we hold control.
  const queueOn = publicMode && !!queue?.enabled
  const iAmAdminController = !!queue?.you?.is_admin_controller
  // Control is held if: no queue, OR you're the public controller, OR you're
  // the internal user who took the admin override.
  const hasControl = !queueOn || !!queue?.you?.is_controller || iAmAdminController
  useEffect(() => { controlRef.current = hasControl; queueOnRef.current = queueOn }, [hasControl, queueOn])
  // Take control is offered ONLY in the editor's Preview, and only when the
  // VIEWPORT being previewed is itself published (with the access queue on) —
  // so it reacts when you publish/unpublish that viewport. Using the per-
  // viewport flag (not the desktop-OR-mobile `publish`) means unpublishing the
  // layout you're previewing hides Take control even if the other is still live.
  const canTakeControl = !publicMode && previewMode && isViewportPublished && !!dashboard?.queue_enabled
  // Sockets must be connected before any action is allowed.
  const wsReady = wsStatus === 'live'            // dashboard (device) socket
  const queueReady = queueWsStatus === 'live'    // access-queue socket
  // Control widgets only WRITE from the public view or the editor Preview —
  // never from the config (editor) view itself, where they render disabled.
  // Also disabled until the dashboard socket is connected, and (in public)
  // unless the viewer currently holds control.
  const inConfigView = !publicMode && !previewMode
  // In Preview of a published, queue-enabled dashboard, writing stays disabled
  // until the admin actually takes control (then iAmAdminController is true).
  // (On an unpublished / no-queue preview there's no public to disrupt → free.)
  const previewBlocked = canTakeControl && !iAmAdminController
  const liveSendCommand = (!wsReady || inConfigView || previewBlocked || (publicMode && queueOn && !hasControl))
    ? null
    : sendDashboardCommand
  // The dashboard is gated behind the queue: when the dashboard's queue is on
  // (known from the REST load, so no flash) and the viewer hasn't joined yet,
  // we show ONLY the lobby — the dashboard isn't rendered until they join.
  const queueEnabled = publicMode && !!dashboard?.queue_enabled
  const joinedQueue = !!queue?.you?.in_queue

  // One-time apology popup for people already in the queue when an admin seizes
  // control. Detected from the admin_active false→true transition so it fires
  // once per take-over (someone who joins AFTER never sees it — they already
  // see the "admin is controlling" state). It's a plain overlay: dismissing it
  // changes nothing — the queue/countdowns keep ticking in the background.
  const [adminTookOver, setAdminTookOver] = useState(false)
  const prevAdminActiveRef = useRef(false)
  useEffect(() => {
    const nowActive = !!queue?.admin_active
    const was = prevAdminActiveRef.current
    prevAdminActiveRef.current = nowActive
    if (nowActive && !was && joinedQueue && !iAmAdminController) {
      setAdminTookOver(true)
    } else if (!nowActive && was) {
      setAdminTookOver(false)   // admin released / window ended — auto-dismiss
    }
  }, [queue?.admin_active, joinedQueue, iAmAdminController])

  // Join / leave the access queue.
  const joinQueue = useCallback(() => {
    const ws = queueWsRef.current
    const me = queueMemberRef.current
    if (ws && ws.readyState === WebSocket.OPEN && me) {
      ws.send(JSON.stringify({ action: 'join', member_id: me.id, name: me.name }))
    }
  }, [])

  // Internal-user override: take / release exclusive control, overriding the
  // access queue for a chosen window (seconds). Used from the editor Preview.
  const takeControl = useCallback((seconds) => {
    const ws = queueWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'take_control', seconds }))
  }, [])
  const releaseControl = useCallback(() => {
    const ws = queueWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'release_control' }))
  }, [])
  // Duration prompt before taking control (default 60s).
  const [takeControlPrompt, setTakeControlPrompt] = useState(false)

  // Queue WebSocket — opened for the public view AND for the editor's Preview
  // (so an admin can take control there), but only for queue-enabled dashboards.
  useEffect(() => {
    if (!dashboardId) return undefined
    if (!publicMode && !previewMode) return undefined
    if (!dashboard?.queue_enabled) return undefined
    // Authenticated internal users pass their JWT so the backend recognises
    // them for the admin override ("take control"). Anonymous viewers omit it.
    const qToken = auth.getAccess()
    const url = `${WS_BASE}/dashboard-queue/${dashboardId}/`
      + (qToken ? `?token=${encodeURIComponent(qToken)}` : '')
    let cancelled = false, reconnectTimer = null, ws = null, attempt = 0
    // Fast recovery: ~250ms first retry, backing off to a 4s cap.
    function schedule() { attempt += 1; reconnectTimer = setTimeout(connect, Math.min(4000, 250 * Math.pow(2, attempt - 1))) }
    function connect() {
      if (cancelled) return
      setQueueWsStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      try { ws = new WebSocket(url) } catch { setQueueWsStatus('reconnecting'); schedule(); return }
      queueWsRef.current = ws
      ws.onopen = () => { attempt = 0; setQueueWsStatus('live') }
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data) } catch { return }
        if (msg?.type === 'queue_state') setQueue(msg)
        else if (msg?.type === 'queue_error') setToast({ type: 'error', text: msg.error || 'Could not take control.' })
        else if (msg?.type === 'queue_closed') { setQueueClosed(true); setToast({ type: 'error', text: msg.reason || 'This dashboard was unpublished.' }) }
      }
      ws.onclose = () => {
        if (queueWsRef.current === ws) queueWsRef.current = null
        ws = null
        setQueueWsStatus('reconnecting')
        if (!cancelled) schedule()
      }
      ws.onerror = () => { try { ws?.close() } catch {} }
    }
    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { ws?.close() } catch {}
      queueWsRef.current = null
    }
  }, [publicMode, previewMode, dashboardId, dashboard?.queue_enabled])

  // ---- Live device-payload updates over WebSocket ----
  // The backend's DashboardRealtimeConsumer joins every device this
  // dashboard binds to and forwards a single `dashboard_event` per
  // payload change. We apply each event to the matching device in our
  // local `devices` state — card widgets re-render automatically because
  // they read values through `devicesById`.
  useEffect(() => {
    if (!canView || !dashboardId) return undefined

    // Authenticate the socket with the user's JWT when present:
    //   • editor (not publicMode) → editor=1: full bypass of the access queue
    //     so the admin can build/test the board.
    //   • preview (publicMode + authenticated) → token only: the backend knows
    //     who they are so the "take control" admin override can authorise their
    //     writes. Anonymous public viewers send nothing and stay queue-gated.
    const token = auth.getAccess()
    const url   = `${WS_BASE}/dashboards/${dashboardId}/`
      + (token ? `?token=${encodeURIComponent(token)}${publicMode ? '' : '&editor=1'}` : '')

    let cancelled       = false
    let reconnectTimer  = null
    let attempt         = 0
    let ws              = null
    let pingTimer       = null   // keepalive so idle networks don't drop the socket

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
      // Fast recovery: ~250ms first retry, backing off to a 4s cap.
      const base   = Math.min(4000, 250 * Math.pow(2, attempt - 1))
      const jitter = base * (0.8 + Math.random() * 0.4)
      reconnectTimer = setTimeout(connect, jitter)
    }

    function connect() {
      if (cancelled) return
      setWsStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      // eslint-disable-next-line no-console
      console.debug('[dashboard-ws] connecting', url)
      try { ws = new WebSocket(url) }
      catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[dashboard-ws] WebSocket constructor threw', err)
        setWsStatus('reconnecting'); scheduleReconnect(); return
      }
      dashboardWsRef.current = ws

      ws.onopen = () => {
        attempt = 0
        setWsStatus('live')
        // eslint-disable-next-line no-console
        console.debug('[dashboard-ws] connected')
        // Heartbeat: ping every 25s. The dashboard socket is otherwise silent
        // when no device value changes, so idle-timeout proxies (common on
        // mobile networks) would drop it and it'd flap "reconnecting".
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' })) } catch { /* noop */ }
        }, 25000)
      }
      ws.onclose = (ev) => {
        // eslint-disable-next-line no-console
        console.debug('[dashboard-ws] closed', ev?.code, ev?.reason)
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
        if (dashboardWsRef.current === ws) dashboardWsRef.current = null
        if (cancelled) return
        ws = null
        setWsStatus('reconnecting')
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
        } else if (msg?.status === 'error') {
          // The server rejected a write (validation, device not found, access
          // queue, …). Previously these were dropped silently, so a control
          // looked dead with no clue — surface the reason instead.
          // eslint-disable-next-line no-console
          console.warn('[dashboard-ws] command rejected', msg)
          setToast({ type: 'error', text: msg.message || 'The server rejected that command.' })
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pingTimer) clearInterval(pingTimer)
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

  // A Spline 3D scene (configured on the dashboard) is showcased in the camera
  // stage AFTER all cameras — as an extra item the switcher can cycle to. If no
  // cameras are linked it's the only stage item; if neither exists the stage
  // shows an empty-state placeholder.
  const splineEnabled = !!dashboard?.spline_url_enable && !!dashboard?.spline_url
  const stageItems = useMemo(() => {
    const items = [...stageCameras]
    if (splineEnabled) {
      items.push({
        id: '__spline__',
        isSpline: true,
        camera_name: '3D View',
        spline_url: dashboard.spline_url,
        is_active: true,
        status: true,
      })
    }
    return items
  }, [stageCameras, splineEnabled, dashboard?.spline_url])

  useEffect(() => {
    if (selectedCamId != null) {
      if (!stageItems.some((c) => c.id === selectedCamId)) {
        setSelectedCamId(stageItems[0]?.id ?? null)
      }
      return
    }
    if (stageItems.length > 0) setSelectedCamId(stageItems[0].id)
  }, [stageItems, selectedCamId])

  const activeCamera = useMemo(
    () => stageItems.find((c) => c.id === selectedCamId) || null,
    [stageItems, selectedCamId],
  )

  const devicesById = useMemo(() => {
    const m = new Map()
    for (const d of devices) m.set(d.id, d)
    return m
  }, [devices])

  /* ---- widget CRUD ---- */
  function openWidgetCreate(container = 2) {
    setTargetContainer(container)
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

    // On edit, preserve which container the widget lives in and its
    // saved position/size — the form rebuilds config from scratch and
    // would otherwise drop them (sending a Container-3 widget back to
    // Container 2 and resetting its layout).
    if (form.id) {
      const existing = components.find((c) => c.id === form.id)
      if (existing?.config?.container != null) config.container = existing.config.container
      if (existing?.config?.layout)            config.layout    = existing.config.layout
      // Preserve the mobile-dashboard inclusion + phone layout; rebuilding
      // config from the form would otherwise drop it, toggling the widget
      // off the phone and losing its position there.
      if (existing?.config?.mobile)            config.mobile    = existing.config.mobile
    }

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
      const isC3 = targetContainer === 3
      let initialLayout
      if (isC3) {
        const wgtW = defaults.w
        const wgtH = Math.min(defaults.h, C3_ROWS)
        const occupied = c3Layout.map((l) => ({ x1: l.x, y1: l.y, x2: l.x + l.w, y2: l.y + l.h }))
        const fits = (x, y) => {
          if (y + wgtH > C3_ROWS) return false
          if (x + wgtW > c3FitCols) return false
          return !occupied.some((o) => x < o.x2 && x + wgtW > o.x1 && y < o.y2 && y + wgtH > o.y1)
        }
        let placed = null
        outer: for (let y = 0; y + wgtH <= C3_ROWS; y++) {
          for (let x = 0; x + wgtW <= c3FitCols; x++) {
            if (fits(x, y)) { placed = { x, y }; break outer }
          }
        }
        if (!placed) {
          // Visible area full — place past the rightmost widget so horizontal
          // scrolling extends the grid exactly to the new widget's edge.
          const maxRight = c3Layout.reduce((m, l) => Math.max(m, l.x + l.w), 0)
          placed = { x: maxRight, y: 0 }
        }
        initialLayout = { x: placed.x, y: placed.y, w: wgtW, h: wgtH }
      } else {
        // Collision-aware placement: scan top→bottom, left→right for the first
        // slot that doesn't overlap an existing Container-2 widget. The old
        // index-based math ignored occupancy, so a new widget could land on top
        // of (and be hidden behind) an existing one — invisible on desktop while
        // still showing in the mobile stack.
        const cols = c2Cols
        const wgtW = Math.min(defaults.w, cols)
        const wgtH = defaults.h
        const occupied = c2Components
          .map((c, i) => c2Layout.find((l) => l.i === String(c.id)) || getWidgetLayout(c, i, cols))
          .map((l) => ({ x1: l.x, y1: l.y, x2: l.x + l.w, y2: l.y + l.h }))
        const fits = (x, y) => !occupied.some((o) => x < o.x2 && x + wgtW > o.x1 && y < o.y2 && y + wgtH > o.y1)
        let placed = null
        for (let y = 0; placed == null && y < 500; y++) {
          for (let x = 0; x + wgtW <= cols; x++) {
            if (fits(x, y)) { placed = { x, y }; break }
          }
        }
        if (!placed) placed = { x: 0, y: 0 }
        initialLayout = { x: placed.x, y: placed.y, w: wgtW, h: wgtH }
      }
      const fullConfig = { ...payload.config, layout: initialLayout, container: targetContainer }
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
      // Preserve which container the widget lives in. The editor form's
      // config doesn't carry `container`, so without this a Container-3
      // widget would fall back to Container 2 (the c2Components filter
      // treats any non-3 value as container 2) after every edit.
      if (existing?.config?.container != null) {
        fullConfig.container = existing.config.container
      }
      // Preserve the mobile-dashboard inclusion + phone layout so editing a
      // card widget doesn't remove it from the phone or reset its position.
      if (existing?.config?.mobile) {
        fullConfig.mobile = existing.config.mobile
      }
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

  // Public viewers get the mobile stack automatically on phone-sized
  // screens (only when a mobile layout has actually been built); the admin
  // gets whichever viewport they picked from the toolbar toggle.
  // Public visibility is per-viewport: a phone may only open the dashboard when
  // the MOBILE layout is published, a desktop only when the DESKTOP layout is.
  // If the relevant layout isn't published we show a "not published" notice
  // instead of opening anything.
  const publicMobileOk  = !!dashboard?.publish_mobile
  const publicDesktopOk = !!dashboard?.publish_desktop
  const publicBlocked = (publicMode && !!dashboard && (isNarrow ? !publicMobileOk : !publicDesktopOk))
    || (publicMode && queueClosed)
  // Queue gate: show only the lobby (not the dashboard) until the viewer joins.
  const queueGate = queueEnabled && !publicBlocked && !joinedQueue

  const showMobileLayout = publicMode
    ? (isNarrow && publicMobileOk)
    : (editViewport === 'mobile')

  // The dashboard editor / config is desktop-only — building, arranging and
  // resizing widgets needs a large screen. On a real phone (narrow viewport)
  // show a "not supported" notice instead of the cramped desktop editor. The
  // public dashboard view (publicMode) still renders normally on mobile.
  if (!publicMode && isNarrow) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="db-unsupported">
          <div className="db-unsupported-card">
            <div className="db-unsupported-ic" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
                <rect x="2.5" y="4" width="19" height="12.5" rx="2" stroke="#F36A1E" strokeWidth="1.7" />
                <path d="M8 20.5h8M12 16.5v4" stroke="#F36A1E" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <h2>Dashboard editor isn’t available on mobile</h2>
            <p>Configuring a dashboard — adding, arranging and resizing widgets — needs a larger screen. Please open this page on a desktop or laptop.</p>
            <button type="button" className="btn-primary" onClick={() => navigate(appId ? `/applications/${appId}` : '/applications')}>
              Back to application
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={'kiosk-app is-db' + (previewMode ? ' is-db-preview' : '') + (publicMode ? ' is-public' : '')} style={themeVars}>
      {!publicMode && <TopBar />}

      {/* Public dashboard header — back arrow + the application's name, plus
          the live access-queue status when a queue is running. */}
      {publicMode && (
        <header className="db-public-topbar">
          <Link to="/public" className="db-public-topbar-back" aria-label="Back to applications" title="Back to applications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <span className="db-public-topbar-title">
            {dashboard?.application_name || dashboard?.name || 'Live dashboard'}
          </span>
          <WsStatus status={wsStatus} className="db-public-ws" />
          {queueEnabled && !publicBlocked && joinedQueue && <QueueBadge queue={queue} ready={queueReady} onJoin={joinQueue} />}
        </header>
      )}

      {/* Lobby — shown FIRST (before the dashboard) whenever a queue is on and
          the viewer hasn't joined. The dashboard isn't rendered behind it; it
          only appears once they join. */}
      {queueGate && (
        <QueueLobby queue={queue} ready={queueReady} onJoin={joinQueue} />
      )}

      <div className={'admin-page db-page'
        + (previewMode ? ' is-preview' : '')
        + (!previewMode && !publicMode && showMobileLayout ? ' is-mobile-edit' : '')
        + (previewMode && showMobileLayout && !isNarrow ? ' is-mobile-preview' : '')
        + (previewMode && showMobileLayout && isNarrow ? ' is-mobile-fullscreen' : '')}>
        {!publicMode && !previewMode && editingLocked && (
          <div className="db-edit-lock-note" role="status">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>
              The <strong>{editViewport === 'mobile' ? 'mobile' : 'desktop'}</strong> layout is published — editing is locked.
              Unpublish it to add, move, resize or delete widgets.
            </span>
          </div>
        )}
        {!previewMode && !publicMode && (
          <div className="db-page-actions-row">
            <Link
              to={`/applications/${appId}`}
              className="back-link"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Application
            </Link>
            {!publicMode && (
            <div className={'db-theme-picker' + (themeLocked ? ' is-locked' : '')} role="group" aria-label="Dashboard theme">
              <span className="db-theme-picker-label">Theme</span>
              {themeLocked && (
                <span className="db-theme-lock-note" title="Unpublish the dashboard to change its colours">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  Published
                </span>
              )}
              {DASHBOARD_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={'db-theme-swatch' + (themeId === t.id ? ' is-active' : '')}
                  style={{ background: t.panelBg, borderColor: t.border }}
                  title={themeLocked ? 'Unpublish to change colours' : t.label}
                  aria-label={t.label}
                  aria-pressed={themeId === t.id}
                  disabled={themeLocked}
                  onClick={() => setThemeId(t.id)}
                />
              ))}
              {/* Custom base-color swatch — opens the native color picker.
                  Picking a color builds a full palette around it, honoring
                  the current gradient/solid mode. */}
              <label
                className={'db-theme-swatch db-theme-swatch-custom' + (isCustomTheme ? ' is-active' : '') + (themeLocked ? ' is-disabled' : '')}
                title={themeLocked ? 'Unpublish to change colours' : 'Custom color'}
                style={{ background: getTheme(customThemeId(customHex, customMode)).panelBg, borderColor: customHex }}
              >
                <input
                  type="color"
                  value={customHex}
                  disabled={themeLocked}
                  onChange={(e) => { setCustomHex(e.target.value); setThemeId(customThemeId(e.target.value, customMode)) }}
                />
                {!isCustomTheme && (
                  <svg className="db-theme-swatch-custom-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 2.5a9.5 9.5 0 1 0 0 19c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.9A4.4 4.4 0 0 0 22 11.5C22 6.5 17.5 2.5 12 2.5Z" stroke="currentColor" strokeWidth="1.6"/>
                    <circle cx="7.5" cy="11" r="1.2" fill="currentColor"/>
                    <circle cx="11" cy="7" r="1.2" fill="currentColor"/>
                    <circle cx="15.5" cy="8" r="1.2" fill="currentColor"/>
                  </svg>
                )}
              </label>
              {/* Fill mode — only meaningful for the custom color. Lets the
                  user choose a soft linear gradient or a flat single color. */}
              {isCustomTheme && (
                <div className="db-theme-mode" role="group" aria-label="Custom fill style">
                  <button
                    type="button"
                    className={'db-theme-mode-btn' + (customMode === 'gradient' ? ' is-active' : '')}
                    onClick={() => { setCustomMode('gradient'); setThemeId(customThemeId(customHex, 'gradient')) }}
                    aria-pressed={customMode === 'gradient'}
                    disabled={themeLocked}
                    title="Linear gradient"
                  >
                    Gradient
                  </button>
                  <button
                    type="button"
                    className={'db-theme-mode-btn' + (customMode === 'solid' ? ' is-active' : '')}
                    onClick={() => { setCustomMode('solid'); setThemeId(customThemeId(customHex, 'solid')) }}
                    aria-pressed={customMode === 'solid'}
                    disabled={themeLocked}
                    title="Solid color"
                  >
                    Solid
                  </button>
                </div>
              )}
            </div>
            )}
            {!publicMode && (
              <div className="db-viewport-toggle" role="group" aria-label="Layout target">
                <button
                  type="button"
                  className={'db-vp-btn' + (editViewport === 'desktop' ? ' is-active' : '')}
                  onClick={() => setEditViewport('desktop')}
                  aria-pressed={editViewport === 'desktop'}
                  title="Desktop / tablet layout"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M9 20h6M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  Desktop
                </button>
                <button
                  type="button"
                  className={'db-vp-btn' + (editViewport === 'mobile' ? ' is-active' : '')}
                  onClick={() => { if (components.length) setEditViewport('mobile') }}
                  disabled={!components.length}
                  aria-pressed={editViewport === 'mobile'}
                  title={components.length ? 'Phone layout — choose which widgets appear' : 'Add widgets to the desktop dashboard first'}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M11 18h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  Mobile
                </button>
              </div>
            )}
            {!publicMode && (
              <button
                type="button"
                className={'db-publish-btn' + (isViewportPublished ? ' is-published' : '')}
                onClick={togglePublish}
                disabled={publishBusy}
                aria-pressed={isViewportPublished}
                title={isViewportPublished
                  ? `The ${editViewport} layout is live for end-users — click to unpublish`
                  : `Publish the ${editViewport} layout so end-users can see it`}
              >
                <span className="db-publish-dot" aria-hidden="true" />
                {isViewportPublished
                  ? `Published · ${editViewport === 'mobile' ? 'Mobile' : 'Desktop'}`
                  : `Publish ${editViewport === 'mobile' ? 'Mobile' : 'Desktop'}`}
              </button>
            )}
            {!publicMode && (
              <button
                type="button"
                className="btn-secondary db-preview-btn"
                onClick={() => setPreviewMode(true)}
                title="View the dashboard the way an end-user sees it"
              >
                Preview
              </button>
            )}
            {!publicMode && <WsStatus status={wsStatus} className="db-toolbar-ws" />}
          </div>
        )}

        {loading ? (
          <div className="admin-empty admin-loading">
            <span className="admin-spinner" aria-hidden="true" />
            <span>Loading dashboard…</span>
          </div>
        ) : error ? (
          <div className="admin-banner error">{error}</div>
        ) : !dashboard ? null : publicBlocked ? (
          <div className="db-public-unpub">
            <span className="db-public-unpub-ic" aria-hidden="true">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M4 5l16 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <h2>No dashboard published</h2>
            <p>
              This application doesn’t have a {isNarrow ? 'mobile' : 'desktop'} dashboard published yet.
              {isNarrow ? ' Try opening it on a desktop, or check back later.' : ' Check back later.'}
            </p>
            <Link to="/public" className="btn-secondary db-public-unpub-back">Back to applications</Link>
          </div>
        ) : queueGate ? null : (
          <>
            {!previewMode && !publicMode && (
              <header className="db-head">
                <h1>{dashboard.name}</h1>
                {dashboard.description && <p className="db-head-desc">{dashboard.description}</p>}
              </header>
            )}

            {showMobileLayout ? (
              /* Full-screen stack (no bezel) for public viewers AND for the
                 admin previewing on a real phone. The phone box only shows
                 when previewing/editing from a desktop, where there's no
                 device chrome to stand in for it. */
              (publicMode || (previewMode && isNarrow)) ? (
                <MobilePublicShell
                  components={mobileComponents}
                  layout={mLayout}
                  devicesById={devicesById}
                  sendCommand={liveSendCommand}
                  cameras={stageItems}
                  activeCamera={activeCamera}
                  onSelectCam={setSelectedCamId}
                  /* Preview on a real phone renders the exact simulator
                     screen (fixed camera + filled grid + internal scroll)
                     fitted to the device — only the public end-user view
                     uses the plain page-scroll stack. */
                  bounded={!publicMode}
                />
              ) : (
                <MobileEditorShell
                  allComponents={components}
                  mobileComponents={mobileComponents}
                  layout={mLayout}
                  devicesById={devicesById}
                  sendCommand={liveSendCommand}
                  canDelete={canDelete}
                  editable={canUpdate && !previewMode}
                  locked={editingLocked}
                  mobileBusy={mobileBusy}
                  themeVars={themeVars}
                  cameras={stageItems}
                  activeCamera={activeCamera}
                  onSelectCam={setSelectedCamId}
                  onToggleInclude={toggleMobileInclude}
                  onLayoutChange={onMobileLayoutChange}
                  onPersistAll={onMobilePersistAll}
                  onEditWidget={(c) => {
                    const v = c?.config?.variant
                    if (v && (CARD_VARIANT_DEFS[v] || CONTROL_VARIANT_DEFS[v] || DIAL_VARIANT_DEFS[v] || FILL_VARIANT_DEFS[v] || CHART_VARIANT_DEFS[v] || LOG_VARIANT_DEFS[v])) setEditingWidget(c)
                    else openWidgetEdit(c)
                  }}
                  onDeleteWidget={(c) => setConfirmDelete(c)}
                />
              )
            ) : (
            <div className="db-shell" ref={previewShellRef} style={themeVars}>
              <div className="db-top">
                {/* Container 1 — Camera (its own panel). */}
                <CameraCard
                  cameras={stageItems}
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
                  <div className={'db-c2-stage' + (c2HasVScroll ? ' db-c2-scrolling' : '')} ref={c2StageRef}>
                    <div
                      className="db-c2-stage-content"
                      style={{ height: `${c2StageH}px` }}
                    >
                      <CellGrid cols={c2Cols} rows={c2Rows} />
                      {c2Components.length > 0 && (
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
                            isDraggable={canEditLayout && !previewMode}
                            isResizable={canEditLayout && !previewMode}
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
                            {c2Components.map((c, idx) => {
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
                                    canUpdate={canEditLayout && !previewMode}
                                    canDelete={canDeleteLayout && !previewMode}
                                    sendCommand={liveSendCommand}
                                    onEdit={() => {
                                      // Card- AND control-variant widgets go through
                                      // the new picker-driven configure (preserves
                                      // variant + layout). Legacy widgets fall back
                                      // to the old form.
                                      const v = c?.config?.variant
                                      if (v && (CARD_VARIANT_DEFS[v] || CONTROL_VARIANT_DEFS[v] || DIAL_VARIANT_DEFS[v] || FILL_VARIANT_DEFS[v] || CHART_VARIANT_DEFS[v] || LOG_VARIANT_DEFS[v])) {
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
                  {canEditLayout && !previewMode && (
                    <button
                      type="button"
                      className="db-c2-add"
                      onClick={() => openWidgetCreate(2)}
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
              {/* Container 3 — horizontal-scroll panel with cell grid. */}
              <section className={'db-group db-group-bottom db-c3' + (c3HasOverflow ? ' db-c3-scrolling' : '')}>
                <div className="db-c3-stage" ref={c3StageRef}>
                  <div
                    className="db-c3-stage-content"
                    style={c3HasOverflow
                      ? { width: `${c3StageW}px`, height: `${c3StageH}px` }
                      : { width: '100%', height: `${c3StageH}px` }}
                  >
                    <CellGrid cols={c3Cols} rows={C3_ROWS} cellW={c3HasOverflow ? c3EffCellW : null} />
                    {c3Components.length > 0 && (
                      <div className="db-c2-rgl-wrap">
                        <ResponsiveGrid
                          className="db-c2-rgl"
                          layouts={{ lg: c3Layout, md: c3Layout }}
                          breakpoints={C2_BREAKPOINTS}
                          cols={{ lg: c3Cols, md: c3Cols }}
                          rowHeight={C3_CELL_SIZE}
                          maxRows={C3_ROWS}
                          margin={[C3_GAP, C3_GAP]}
                          containerPadding={[0, 0]}
                          compactType={null}
                          preventCollision
                          isDraggable={canUpdate && !previewMode}
                          isResizable={canUpdate && !previewMode}
                          resizeHandles={C2_RESIZE_HANDLES}
                          draggableHandle=".db-c2-widget-drag"
                          draggableCancel=".row-btn, button"
                          onLayoutChange={onC3LayoutChange}
                          onDragStart={() => setC3Interacting(true)}
                          onResizeStart={() => setC3Interacting(true)}
                          onDragStop={(_layout, _old, newItem) => {
                            setC3Interacting(false)
                            commitWidgetLayoutNow(newItem.i, newItem.x, newItem.y, newItem.w, newItem.h)
                          }}
                          onResizeStop={(_layout, _old, newItem) => {
                            setC3Interacting(false)
                            commitWidgetLayoutNow(newItem.i, newItem.x, newItem.y, newItem.w, newItem.h)
                          }}
                        >
                          {c3Components.map((c, idx) => {
                            const dg = c3Layout.find((l) => l.i === String(c.id)) || getWidgetLayout(c, idx, c3Cols)
                            return (
                              <div key={String(c.id)} className="db-c2-rgl-item" data-grid={dg}>
                                <DashWidgetView
                                  component={c} devicesById={devicesById}
                                  canUpdate={canEditLayout && !previewMode}
                                  canDelete={canDeleteLayout && !previewMode}
                                  sendCommand={liveSendCommand}
                                  onEdit={() => {
                                    const v = c?.config?.variant
                                    if (v && (CARD_VARIANT_DEFS[v] || CONTROL_VARIANT_DEFS[v] || DIAL_VARIANT_DEFS[v] || FILL_VARIANT_DEFS[v] || CHART_VARIANT_DEFS[v] || LOG_VARIANT_DEFS[v])) {
                                      setEditingWidget(c)
                                    } else { openWidgetEdit(c) }
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
                {canEditLayout && !previewMode && (
                  <button type="button" className="db-c2-add db-c3-add"
                    onClick={() => openWidgetCreate(3)} aria-label="Add widget" title="Add widget to bottom panel">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </section>
            </div>
            )}
          </>
        )}
      </div>

      {previewMode && (
        <button
          type="button"
          className="db-preview-exit"
          onClick={() => { releaseControl(); setPreviewMode(false) }}
          aria-label="Exit preview"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Exit preview
        </button>
      )}

      {/* Take control — editor Preview only, and only for a published,
          queue-enabled dashboard (so there are public users to override). */}
      {previewMode && canTakeControl && (
        <div className={'db-preview-take' + (showMobileLayout && !isNarrow ? ' is-mobile-preview' : '')}>
          <AdminControlBar
            queue={queue}
            canTake={canTakeControl}
            ready={queueReady && wsReady}
            onTake={() => setTakeControlPrompt(true)}
            onRelease={releaseControl}
          />
        </div>
      )}

      {takeControlPrompt && (
        <TakeControlPrompt
          onCancel={() => setTakeControlPrompt(false)}
          onConfirm={(seconds) => { setTakeControlPrompt(false); takeControl(seconds) }}
        />
      )}

      {(pickerOpen || editingWidget) && (
        <WidgetPickerModal
          onClose={() => { setPickerOpen(false); setEditingWidget(null); setTargetContainer(2) }}
          devices={devices}
          initialComponent={editingWidget}
          themeDefaults={{
            cardColor: activeTheme.defaultCardColor,
            iconColor: activeTheme.defaultIconColor,
            usedColors: usedCardColors,
            usedIconColors: usedIconColors,
          }}
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

      {publishCaution && (
        <UnpublishCaution
          status={publishCaution.status}
          viewport={editViewport === 'mobile' ? 'Mobile' : 'Desktop'}
          onCancel={() => setPublishCaution(null)}
          onConfirm={async () => {
            const next = publishCaution.next
            setPublishCaution(null)
            await applyPublish(next)
          }}
        />
      )}

      {/* An administrator took control while you were in the queue. Pure
          overlay — the queue + countdowns keep running behind it; OK dismisses. */}
      {adminTookOver && (
        <div className="modal-overlay" onMouseDown={() => setAdminTookOver(false)}>
          <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Control paused</h2>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setAdminTookOver(false)}>×</button>
            </header>
            <div className="modal-body">
              <div className="confirm-body">
                <div className="confirm-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#B5500F" strokeWidth="1.7" />
                    <path d="M12 8v5" stroke="#B5500F" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="12" cy="16.3" r="0.6" fill="#B5500F" stroke="#B5500F" strokeWidth="0.8" />
                  </svg>
                </div>
                <p className="confirm-lead">Apologies for the inconvenience.</p>
                <p className="confirm-sub">
                  An administrator has taken control of this dashboard for a few minutes.
                  You'll keep your place in the queue — control resumes automatically afterwards,
                  and you can keep watching live in the meantime.
                </p>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn-primary" onClick={() => setAdminTookOver(false)}>OK</button>
              </div>
            </div>
          </div>
        </div>
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
   Mobile dashboard  —  a separate, phone-optimised layout built from the
   SAME widgets as the desktop dashboard. The admin picks which widgets
   appear (config.mobile.show) and arranges them in a 4-column, vertically
   compacting grid (config.mobile.layout). On a real phone the public view
   renders this stack full-width; in the editor it sits inside a phone
   frame next to a widget include-list.
   ===================================================================== */
function MobileGrid({ components, layout, editable, devicesById, sendCommand, canDelete, onEdit, onDelete, onLayoutChange, onPersistAll, cameras, activeCamera, onSelectCam, fillContainer = false, transformScale = 1 }) {
  const hasCam = Array.isArray(cameras) && cameras.length > 0

  // In the editor the container has a fixed height, so the cell grid FILLS
  // it (like the desktop containers): render enough rows to cover the
  // visible area, then grow past it as widgets are placed lower (scroll).
  // Skipped in the public view, where the page itself scrolls (the
  // container isn't height-bounded, so measuring it would loop).
  const widgetsRef = useRef(null)
  const [innerH, setInnerH] = useState(0)
  useEffect(() => {
    if (!fillContainer) return undefined
    function measure() {
      const el = widgetsRef.current
      if (!el) return
      const cs = getComputedStyle(el)
      const h = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
      if (h > 0) setInnerH(h)
    }
    measure()
    const ro = (typeof ResizeObserver !== 'undefined' && widgetsRef.current) ? new ResizeObserver(measure) : null
    if (ro && widgetsRef.current) ro.observe(widgetsRef.current)
    if (typeof window !== 'undefined') window.addEventListener('resize', measure)
    return () => { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', measure) }
  }, [fillContainer])

  // Base rows that fit the container at the natural row height (used only
  // for the EMPTY state, to show a full grid filling the panel).
  const fillRows = (fillContainer && innerH > 0)
    ? Math.max(1, Math.floor((innerH + MOBILE_GAP) / (MOBILE_ROW_H + MOBILE_GAP)))
    : MOBILE_MIN_ROWS

  // How far the widgets actually reach (the lowest-placed widget bottom).
  const maxB = useMemo(() => {
    let m = 0
    for (const l of layout) m = Math.max(m, (l.y || 0) + (l.h || 0))
    return m
  }, [layout])

  // Cell rows rendered = enough to FILL the panel AND cover the content.
  const rows = Math.max(fillRows, maxB)

  // Row height SHRINKS so ALL rows fit the container — the grid fills the
  // panel exactly and does NOT scroll for a reasonable number of widgets
  // (they just get a little shorter, like the desktop containers). It only
  // scrolls when fitting would drop below a readable row height.
  const MIN_MOBILE_ROW_H = 56
  const rowH = (fillContainer && innerH > 0)
    ? Math.max(MIN_MOBILE_ROW_H, (innerH - (rows - 1) * MOBILE_GAP - 2) / rows)
    : MOBILE_ROW_H
  const stageH = rows * rowH + Math.max(0, rows - 1) * MOBILE_GAP

  return (
    <div className="db-mobile-content">
      {hasCam && (
        <div className="db-mobile-cam">
          <CameraCard cameras={cameras} active={activeCamera} onSelect={onSelectCam} compact />
        </div>
      )}
      {/* Widget container — its own panel below the camera, with a visible
          cell grid that the cards snap to. The 1fr columns make every cell
          scale to the phone width automatically. */}
      <section className="db-mobile-widgets" ref={widgetsRef}>
        <div className="db-mobile-widgets-scroll">
        <div className="db-mobile-grid-stage" style={{ height: stageH }}>
          <CellGrid cols={MOBILE_COLS} rows={rows} rowH={rowH} gap={MOBILE_GAP} />
          {components.length === 0 ? (
            <div className="db-mobile-empty">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="6" y="2.5" width="12" height="19" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <p className="db-mobile-empty-title">No widgets added yet</p>
              {editable && <p className="db-mobile-empty-sub">Turn widgets on from the list to add them here.</p>}
            </div>
          ) : (
            <div className="db-c2-rgl-wrap">
              <ResponsiveGrid
                className="db-mobile-rgl db-c2-rgl"
                layouts={{ lg: layout, md: layout }}
                breakpoints={{ lg: 1, md: 0 }}
                cols={{ lg: MOBILE_COLS, md: MOBILE_COLS }}
                rowHeight={rowH}
                margin={[MOBILE_GAP, MOBILE_GAP]}
                containerPadding={[0, 0]}
                transformScale={transformScale}
                compactType="vertical"
                preventCollision={false}
                isDraggable={editable}
                isResizable={editable}
                resizeHandles={MOBILE_RESIZE_HANDLES}
                draggableHandle=".db-c2-widget-drag"
                draggableCancel=".row-btn, button"
                onLayoutChange={(curr) => onLayoutChange?.(curr)}
                onDragStop={(curr) => onPersistAll?.(curr)}
                onResizeStop={(curr) => onPersistAll?.(curr)}
              >
                {components.map((c, idx) => {
                  const dg = layout.find((l) => l.i === String(c.id)) || getMobileLayout(c, idx)
                  return (
                    <div key={String(c.id)} className="db-c2-rgl-item" data-grid={dg}>
                      <DashWidgetView
                        component={c}
                        devicesById={devicesById}
                        canUpdate={editable}
                        canDelete={editable && canDelete}
                        sendCommand={sendCommand}
                        onEdit={() => onEdit?.(c)}
                        onDelete={() => onDelete?.(c)}
                        hideActions
                      />
                    </div>
                  )
                })}
              </ResponsiveGrid>
            </div>
          )}
        </div>
        </div>
      </section>
    </div>
  )
}

/* Editor view — phone frame + the include-list the admin uses to pick
   which widgets show on the phone. When not editable (Preview), the list
   is hidden and the frame just renders the read-only stack. */
function MobileEditorShell({
  allComponents, mobileComponents, layout, devicesById, sendCommand, canDelete,
  editable, locked = false, mobileBusy, themeVars, cameras, activeCamera, onSelectCam,
  onToggleInclude, onLayoutChange, onPersistAll, onEditWidget, onDeleteWidget,
}) {
  const [deviceId, setDeviceId] = useState('ip-15')
  const [landscape, setLandscape] = useState(false)
  const device = MOBILE_DEVICES.find((d) => d.id === deviceId) || MOBILE_DEVICES[0]
  const w = landscape ? device.h : device.w
  const h = landscape ? device.w : device.h
  const pad = 12
  const cutout = landscape ? 'none' : device.notch

  // Render the device at its TRUE pixel size, then scale the whole frame
  // uniformly to fit the available space — exactly how a phone simulator
  // shows a real device on a laptop, with the precise aspect ratio.
  const stageRef = useRef(null)
  const [avail, setAvail] = useState({ w: 480, h: 800 })
  useEffect(() => {
    function measure() {
      const el = stageRef.current
      const w = el ? el.clientWidth : 480
      const h = typeof window !== 'undefined' ? window.innerHeight : 800
      setAvail((prev) => {
        // On phones, scrolling shows/hides the browser URL bar, which nudges
        // window.innerHeight and would otherwise rescale the simulator on
        // every scroll. Ignore small height jitter (URL bar ≈ 60-110px) when
        // the width is unchanged; still react to real resizes / rotation.
        if (prev.w === w && Math.abs(prev.h - h) < 130) return prev
        return { w, h }
      })
    }
    measure()
    const ro = (typeof ResizeObserver !== 'undefined' && stageRef.current) ? new ResizeObserver(measure) : null
    if (ro && stageRef.current) ro.observe(stageRef.current)
    if (typeof window !== 'undefined') window.addEventListener('resize', measure)
    return () => { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', measure) }
  }, [])

  const frameW = w + pad * 2
  const frameH = h + pad * 2
  // Vertical room left after the page header + device bar + hint/margins.
  const vRoom = avail.h - (editable ? 220 : 130)
  // Fit the device to the room, then zoom ~15% so the phone reads larger in
  // the config page (capped slightly above 1:1; the page scrolls if needed).
  const fit = Math.min(vRoom / frameH, (avail.w - 8) / frameW)
  const scale = Math.max(0.25, Math.min(1.12, fit * 1.15))

  const frameStyle = {
    width: frameW,
    padding: pad,
    borderRadius: device.radius,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  }
  const screenStyle = { ...themeVars, width: w, height: h, maxHeight: 'none', borderRadius: Math.max(14, device.radius - pad) }
  // The transformed frame keeps its un-scaled layout box, so reserve the
  // SCALED footprint here to avoid huge empty gaps around the device.
  const viewportStyle = { width: frameW * scale, height: frameH * scale }

  return (
    <div className="db-shell db-mobile-shell" style={themeVars}>
      <div className={'db-mobile-editor' + (editable ? '' : ' is-preview')}>
        {editable && (
          <aside className={'db-mobile-picker' + (locked ? ' is-locked' : '')}>
            <div className="db-mobile-picker-head">
              <h3>Phone widgets</h3>
              <p>{locked ? 'Published — unpublish the mobile layout to change which widgets show.' : 'Pick widgets to show on the phone.'}</p>
            </div>
            {allComponents.length === 0 ? (
              <div className="db-mobile-picker-empty">Build the desktop dashboard first.</div>
            ) : (
              <ul className="db-mobile-picker-list">
                {allComponents.map((c) => {
                  const on = !!c.config?.mobile?.show
                  const title = c.config?.title || c.widget_name || 'Widget'
                  return (
                    <li key={c.id} className={'db-mobile-picker-item' + (on ? ' is-on' : '')}>
                      <span className="db-mp-text">
                        <span className="db-mp-name">{title}</span>
                        <span className="db-mp-type">{c.config?.variant || c.widget_type}</span>
                      </span>
                      <button
                        type="button"
                        className={'db-mp-switch' + (on ? ' is-on' : '')}
                        onClick={() => onToggleInclude(c)}
                        disabled={mobileBusy === c.id || locked}
                        role="switch"
                        aria-checked={on}
                        aria-label={on ? `Remove ${title} from phone` : `Add ${title} to phone`}
                      >
                        <span className="db-mp-knob" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="db-mobile-picker-foot">
              {mobileComponents.length} on phone
            </div>
          </aside>
        )}

        <div className="db-mobile-stage" ref={stageRef}>
          <div className="db-sim-area">
          {/* Simulator device bar — choose any device + orientation, like a
              mobile-simulator extension. Sits beside the phone so it doesn't
              eat vertical room. The screen resizes to that exact device and
              the widget grid re-flows live. */}
          <div className="db-sim-bar db-sim-bar-side" role="group" aria-label="Simulated device">
            <svg className="db-sim-bar-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="7" y="2.5" width="10" height="19" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <select
              className="db-sim-select"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              aria-label="Device"
            >
              {MOBILE_DEVICE_BRANDS.map((brand) => (
                <optgroup key={brand} label={brand}>
                  {MOBILE_DEVICES.filter((d) => d.brand === brand).map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className={'db-sim-rotate' + (landscape ? ' is-active' : '')}
              onClick={() => setLandscape((v) => !v)}
              aria-pressed={landscape}
              title={landscape ? 'Switch to portrait' : 'Switch to landscape'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M17 8a5 5 0 0 1 4 5m0 0 1.6-1.6M21 13l-1.6-1.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="db-sim-dims">{w} × {h}</span>
          </div>

          <div className="db-sim-viewport" style={viewportStyle}>
          <div className={'db-mobile-frame db-sim-' + device.type + (landscape ? ' is-landscape' : '') + ' db-sim-notch-' + cutout} style={frameStyle}>
            {!landscape && (
              <>
                <span className="db-mobile-frame-btn db-mobile-frame-btn-power" aria-hidden="true" />
                <span className="db-mobile-frame-btn db-mobile-frame-btn-vol-up" aria-hidden="true" />
                <span className="db-mobile-frame-btn db-mobile-frame-btn-vol-dn" aria-hidden="true" />
              </>
            )}
            <div className="db-mobile-screen" style={screenStyle}>
              <div className="db-mobile-statusbar" aria-hidden="true">
                <span className="db-sb-time">9:41</span>
                {cutout === 'island' && <span className="db-mobile-island" />}
                {cutout === 'notch' && <span className="db-mobile-notch-bar" />}
                {cutout === 'punch' && <span className="db-mobile-punch" />}
                <span className="db-sb-icons">
                  <svg width="17" height="11" viewBox="0 0 17 11" fill="none"><rect x="0" y="6" width="3" height="5" rx="1" fill="currentColor"/><rect x="4.5" y="4" width="3" height="7" rx="1" fill="currentColor"/><rect x="9" y="2" width="3" height="9" rx="1" fill="currentColor"/><rect x="13.5" y="0" width="3" height="11" rx="1" fill="currentColor"/></svg>
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M8 11.2 1 4.5a9.8 9.8 0 0 1 14 0L8 11.2Z" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M8 11.2 4.3 7.6a5.2 5.2 0 0 1 7.4 0L8 11.2Z" fill="currentColor"/></svg>
                  <span className="db-sb-batt"><span className="db-sb-batt-fill" /></span>
                </span>
              </div>
              <MobileGrid
                components={mobileComponents}
                layout={layout}
                editable={editable && !locked}
                devicesById={devicesById}
                sendCommand={sendCommand}
                canDelete={canDelete && !locked}
                cameras={cameras}
                activeCamera={activeCamera}
                onSelectCam={onSelectCam}
                onEdit={onEditWidget}
                onDelete={onDeleteWidget}
                onLayoutChange={onLayoutChange}
                onPersistAll={onPersistAll}
                fillContainer
                transformScale={scale}
              />
              <div className="db-mobile-homebar" aria-hidden="true" />
            </div>
          </div>
          </div>
          </div>
          {editable && !locked && (
            <p className="db-mobile-hint">Drag a widget to move · pull an edge to resize · widgets stack automatically</p>
          )}
        </div>
      </div>
    </div>
  )
}

/* Public / preview view — the real phone is the frame, so we render the
   stack full-width in the actual viewport (read-only, controls still live).
   `bounded` (mobile preview) wraps it in the SAME fixed-height screen the
   simulator uses, so the camera stays pinned and the grid fills + scrolls
   exactly like the in-editor simulator. The plain public end-user view
   keeps the natural page scroll. */
function MobilePublicShell({ components, layout, devicesById, sendCommand, cameras, activeCamera, onSelectCam, bounded = false }) {
  const hasCam = Array.isArray(cameras) && cameras.length > 0
  const grid = (
    <MobileGrid
      components={components}
      layout={layout}
      editable={false}
      devicesById={devicesById}
      sendCommand={sendCommand}
      cameras={cameras}
      activeCamera={activeCamera}
      onSelectCam={onSelectCam}
      // Fill-to-fit (shrink widgets to the screen, fixed camera, internal
      // scroll) whenever the layout is bounded — i.e. the preview, or the real
      // phone when a camera/3D scene pins the top. Matches the preview exactly.
      fillContainer={bounded || hasCam}
    />
  )
  if (bounded) {
    return (
      <div className="db-shell db-mobile-public is-bounded">
        <div className="db-mobile-screen db-mobile-live">{grid}</div>
      </div>
    )
  }
  // Real phone WITH a camera/3D scene: render the same fixed-screen layout as
  // the preview, sized to the viewport. With neither, keep the natural
  // page-scroll stack (whole page moves).
  if (hasCam) {
    return (
      <div className="db-shell db-mobile-public is-live-screen">
        <div className="db-mobile-screen db-mobile-live is-live">{grid}</div>
      </div>
    )
  }
  return <div className="db-shell db-mobile-public">{grid}</div>
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

function DashWidgetView({ component, devicesById, canUpdate, canDelete, onEdit, onDelete, sendCommand, hideActions = false }) {
  // `canUpdate` still drives the drag handle (so widgets stay draggable), but
  // `hideActions` suppresses the floating edit/delete icons — used in the mobile
  // simulator where editing/deleting a widget is done from the desktop view.
  const showActions = !hideActions
  const cfg = component?.config || {}
  const stat = cfg.static || {}
  const variant = cfg.variant
  const title = cfg.title || component.widget_name || '—'

  // Control variants — interactive widgets that write to a device path
  // via the dashboard WebSocket. Share the .db-card-wrap chrome with
  // cards so they sit nicely on the same grid; only the inner content
  // differs (toggle / button / slider / input UI).
  if (variant && CONTROL_VARIANT_DEFS[variant]) {
    const options = {
      title,
      description: cfg.description || '',
      bindings: cfg.bindings || [],
      devicesById,
      writeValue: stat.write_value,
      writeValueType: stat.write_value_type || 'string',
      buttonLabel: stat.button_label || 'Send',
      min: stat.min, max: stat.max, step: stat.step,
      unit: stat.unit || '',
      icon: stat.icon || '',
      actions: Array.isArray(stat.actions) ? stat.actions : null,
      color: stat.card_color || 'peach',
      iconColor: stat.icon_color || 'orange',
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <ControlPreview variant={variant} options={options} onCommand={sendCommand} />
        {showActions && (canUpdate || canDelete) && (
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

  // Card-variant widgets get the styled CardPreview with the user's
  // chosen color/icon palette. The whole card surface is the drag
  // handle (when editing is allowed), with edit/delete overlaid in the
  // corner. Legacy widgets fall back to the simple text placeholder.
  if (variant && CHART_VARIANT_DEFS[variant]) {
    const options = {
      title, description: cfg.description || '',
      color: stat.card_color || 'peach', iconColor: stat.icon_color || 'orange',
      unit: stat.unit || '', bindings: cfg.bindings || [], devicesById,
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <ChartPreview variant={variant} options={options} />
        {showActions && (canUpdate || canDelete) && (
          <div className="db-card-actions">
            {canUpdate && <button type="button" className="db-card-action" onClick={onEdit} title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg></button>}
            {canDelete && <button type="button" className="db-card-action danger" onClick={onDelete} title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
          </div>
        )}
      </div>
    )
  }

  if (variant && FILL_VARIANT_DEFS[variant]) {
    const options = {
      title, description: cfg.description || '',
      color: stat.card_color || 'peach', iconColor: stat.icon_color || 'orange',
      unit: stat.unit || '', min: stat.min ?? 0, max: stat.max ?? 100,
      bindings: cfg.bindings || [], devicesById,
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <FillPreview variant={variant} options={options} />
        {showActions && (canUpdate || canDelete) && (
          <div className="db-card-actions">
            {canUpdate && (
              <button type="button" className="db-card-action" onClick={onEdit} title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              </button>
            )}
            {canDelete && (
              <button type="button" className="db-card-action danger" onClick={onDelete} title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (variant && LOG_VARIANT_DEFS[variant]) {
    const options = {
      title,
      color: stat.card_color || 'snow',
      iconColor: stat.icon_color || 'slate',
      limit: stat.limit ?? 50,
      bindings: cfg.bindings || [],
      devicesById,
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <LogPreview variant={variant} options={options} />
        {showActions && (canUpdate || canDelete) && (
          <div className="db-card-actions">
            {canUpdate && (
              <button type="button" className="db-card-action" onClick={onEdit} title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              </button>
            )}
            {canDelete && (
              <button type="button" className="db-card-action danger" onClick={onDelete} title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (variant && DIAL_VARIANT_DEFS[variant]) {
    const options = {
      title,
      description: cfg.description || '',
      color: stat.card_color || 'peach',
      iconColor: stat.icon_color || 'orange',
      icon: stat.icon || '',
      unit: stat.unit || '',
      min: stat.min ?? 0, max: stat.max ?? 100,
      bindings: cfg.bindings || [],
      devicesById,
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <DialPreview variant={variant} options={options} />
        {showActions && (canUpdate || canDelete) && (
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

  if (variant && CARD_VARIANT_DEFS[variant]) {
    const options = {
      title,
      description: cfg.description || '',
      color: stat.card_color || 'peach',
      iconColor: stat.icon_color || 'orange',
      icon: stat.icon || '',
      unit: stat.unit || '',
      target: stat.target || '',
      pattern: stat.pattern || '',
      onLabel: stat.on_label || '',
      offLabel: stat.off_label || '',
      barColor: stat.bar_color || 'orange',
      bindings: cfg.bindings || [],
      devicesById,
    }
    return (
      <div className={'db-card-wrap' + (canUpdate ? ' db-c2-widget-drag' : '')}>
        <CardPreview variant={variant} options={options} />
        {showActions && (canUpdate || canDelete) && (
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
                      <input type="text" inputMode="decimal" value={form.min} disabled={saving}
                        onChange={(e) => set('min', e.target.value)} placeholder="0" />
                    </DField>
                    <DField label="Max">
                      <input type="text" inputMode="decimal" value={form.max} disabled={saving}
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

function UnpublishCaution({ status, viewport, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  async function go() { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }
  // Only count people actually in the access queue: those waiting + the one in
  // control. (Server already excludes passive viewers / stray sockets.)
  const inQueue = status?.in_queue
    ?? ((status?.waiting_count || 0) + (status?.has_controller ? 1 : 0))
  const hasController = !!status?.has_controller
  const adminName = status?.admin_active ? status?.admin_name : null
  return (
    <div className="modal-overlay" onMouseDown={() => !busy && onCancel()}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Unpublish — people are in the queue</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => !busy && onCancel()}>×</button>
        </header>
        <div className="modal-body">
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 3 2.5 20h19L12 3Z" stroke="#C97A12" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M12 10v4M12 17.5v.5" stroke="#C97A12" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              This dashboard is being used by the public right now.
            </p>
            <p className="confirm-sub">
              {adminName
                ? <><strong>{adminName}</strong> (admin) is currently in control. </>
                : null}
              {inQueue > 0
                ? <><strong>{inQueue}</strong> {inQueue === 1 ? 'person is' : 'people are'} in the queue{hasController ? ' (including the one in control)' : ''}. </>
                : adminName
                  ? null
                  : <>Someone is in the queue. </>}
              Unpublishing the {viewport} layout will remove them from the live dashboard and end any active control — they'll be notified immediately.
            </p>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Keep published</button>
            <button type="button" className="btn-danger" onClick={go} disabled={busy} aria-busy={busy}>
              {busy ? 'Unpublishing…' : 'Unpublish anyway'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TakeControlPrompt({ onCancel, onConfirm }) {
  const [secs, setSecs] = useState('60')
  function go() {
    let n = parseInt(secs, 10)
    if (!Number.isFinite(n) || n <= 0) n = 60   // default 60s when blank/invalid
    onConfirm(n)
  }
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Take control</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={onCancel}>×</button>
        </header>
        <div className="modal-body">
          <div className="confirm-body">
            <p className="confirm-lead">For how long?</p>
            <p className="confirm-sub">
              The public access queue will be paused and everyone watching is notified.
              Enter a duration in seconds — leave it at 60 if you're not sure.
            </p>
            <label className="form-field" style={{ maxWidth: 220, margin: '0 auto' }}>
              <span className="form-label">Duration (seconds)</span>
              <input
                type="number"
                min="5"
                inputMode="numeric"
                value={secs}
                onChange={(e) => setSecs(e.target.value)}
                placeholder="60"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') go() }}
              />
            </label>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary" onClick={go}>Take control</button>
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
function CellGrid({ cols = 10, rows = 7, fixedCols = false, cellW = null, rowH = C2_CELL_SIZE, gap = null }) {
  const cells = []
  for (let i = 0; i < cols * rows; i++) cells.push(<span key={i} className="db-cell" />)
  let colsCss
  if (cellW != null) colsCss = `repeat(${cols}, ${cellW}px)`
  else if (fixedCols)  colsCss = `repeat(${cols}, ${C2_CELL_SIZE}px)`
  else                 colsCss = `repeat(${cols}, 1fr)`
  return (
    <div
      className="db-cell-grid"
      style={{
        gridTemplateColumns: colsCss,
        gridTemplateRows: `repeat(${rows}, ${rowH}px)`,
        ...(gap != null ? { gap: `${gap}px` } : {}),
      }}
    >
      {cells}
    </div>
  )
}

/* =====================================================================
   CameraCard  —  real cameras in a Smart-CCTV styled card
   ===================================================================== */
function CameraCard({ cameras, active, onSelect, compact = false }) {
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

  const isSpline = !!active?.isSpline
  const isOnline = !!active?.status
  const hasStream = active?.is_active && active?.webrtc_url

  // Compact (mobile) mode drops the name/primary header. A header only
  // renders when there's something to show: never in compact-single, and
  // in compact-multi it shows just the prev/next arrows for switching.
  const showHead = !compact || showDropdown

  return (
    <article className={'db-card db-cam-card' + (compact ? ' is-compact' : '')} ref={rootRef}>
      {showHead && (
      <div className="db-cam-head">
        {!compact && (
          <div className="db-cam-head-title">
            <h2>
              {active?.camera_name || 'Live feed'}
              {active?.is_primary && <span className="db-cam-head-badge">primary</span>}
            </h2>
          </div>
        )}
        {active && (
          <div className="db-cam-switcher">
            {showDropdown && (
              <button type="button" className="db-cam-chev" onClick={() => cycle(-1)} aria-label="Previous camera">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {!compact && (
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
            )}
            {showDropdown && (
              <button type="button" className="db-cam-chev" onClick={() => cycle(1)} aria-label="Next camera">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {menuOpen && showDropdown && !compact && (
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
      )}
      <div className="db-cam-player">
        {isSpline ? (
          <iframe
            className="db-cam-frame db-spline-frame"
            src={active.spline_url}
            title="3D scene"
            allow="autoplay; fullscreen; xr-spatial-tracking"
            allowFullScreen
          />
        ) : hasStream ? (
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
                ? 'No live camera or 3D scene has been added to this dashboard yet.'
                : !active.is_active
                  ? 'This camera is disabled.'
                  : 'No stream URL configured.'}
            </div>
          </div>
        )}

        {/* LIVE pill — only for actual camera streams, not the 3D scene. */}
        {!isSpline && (
          <div className="db-cam-live">
            <span className={'db-cam-live-dot ' + (isOnline ? 'is-on' : 'is-off')} aria-hidden="true" />
            {isOnline ? 'Live' : 'Offline'}
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
  { id: 'controls',    label: 'Controls' },
  { id: 'custom_fill', label: 'Custom Fill' },
  { id: 'dials',       label: 'Dials' },
  { id: 'logs',        label: 'Logs' },
]

function WidgetPickerModal({ onClose, devices, onSubmit, initialComponent, themeDefaults }) {
  const isEditing = !!initialComponent
  // Edit mode: jump straight to the variant configure view, skip the
  // gallery, and don't let the user change variant (would invalidate
  // the bindings).
  const initVariant = initialComponent?.config?.variant || null
  const [selected, setSelected] = useState(
    initVariant ? (isControlVariant(initVariant) ? 'controls' : isChartVariant(initVariant) ? 'charts' : isDialVariant(initVariant) ? 'dials' : isFillVariant(initVariant) ? 'custom_fill' : isLogVariant(initVariant) ? 'logs' : 'cards') : 'cards'
  )
  const [pickedVariant, setPickedVariant] = useState(initVariant)

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
            {isEditing ? 'Edit Widget' : inConfigure ? 'Configure Widget' : 'Add Widget'}
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
              isControlVariant(pickedVariant) ? (
                <ControlConfigure
                  variant={pickedVariant}
                  devices={devices}
                  initial={initialComponent}
                  themeDefaults={themeDefaults}
                  onBack={isEditing ? null : () => setPickedVariant(null)}
                  onSubmit={onSubmit}
                />
              ) : isChartVariant(pickedVariant) ? (
                <ChartConfigure
                  variant={pickedVariant}
                  devices={devices}
                  initial={initialComponent}
                  themeDefaults={themeDefaults}
                  onBack={isEditing ? null : () => setPickedVariant(null)}
                  onSubmit={onSubmit}
                />
              ) : isFillVariant(pickedVariant) ? (
                <FillConfigure
                  variant={pickedVariant}
                  devices={devices}
                  initial={initialComponent}
                  themeDefaults={themeDefaults}
                  onBack={isEditing ? null : () => setPickedVariant(null)}
                  onSubmit={onSubmit}
                />
              ) : isDialVariant(pickedVariant) ? (
                <DialConfigure
                  variant={pickedVariant}
                  devices={devices}
                  initial={initialComponent}
                  themeDefaults={themeDefaults}
                  onBack={isEditing ? null : () => setPickedVariant(null)}
                  onSubmit={onSubmit}
                />
              ) : isLogVariant(pickedVariant) ? (
                <LogConfigure
                  variant={pickedVariant}
                  devices={devices}
                  initial={initialComponent}
                  themeDefaults={themeDefaults}
                  onBack={isEditing ? null : () => setPickedVariant(null)}
                  onSubmit={onSubmit}
                />
              ) : (
                <CardConfigure
                  variant={pickedVariant}
                  devices={devices}
                  initial={initialComponent}
                  themeDefaults={themeDefaults}
                  onBack={isEditing ? null : () => setPickedVariant(null)}
                  onSubmit={onSubmit}
                />
              )
            ) : selected === 'cards' ? (
              <CardVariantGallery onPick={(variant) => setPickedVariant(variant)} />
            ) : selected === 'controls' ? (
              <ControlVariantGallery onPick={(variant) => setPickedVariant(variant)} />
            ) : selected === 'dials' ? (
              <DialVariantGallery onPick={(variant) => setPickedVariant(variant)} />
            ) : selected === 'custom_fill' ? (
              <FillVariantGallery onPick={(variant) => setPickedVariant(variant)} />
            ) : selected === 'logs' ? (
              <LogVariantGallery onPick={(variant) => setPickedVariant(variant)} />
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
/* =====================================================================
   CONTROL_VARIANT_DEFS — write-back widgets. Each variant has one
   "target" binding (device + payload_path) and an action that the
   user triggers from the dashboard to PUT a value to that path via
   the dashboard WebSocket. Bindings still flow through the same
   PayloadPathField / type-filter machinery as cards.
   ===================================================================== */
/* CONTROL_VARIANT_DEFS — card-styled interactive widgets. Each variant
   has a "target" binding that it writes to over the dashboard WS, plus
   variant-specific config (write value, min/max, multi-actions, etc.).
   All render with .cv-card chrome so they sit alongside data cards as
   one visual family. */
const CONTROL_VARIANT_DEFS = {
  // ── Toggles & switches ─────────────────────────────
  switch: {
    title: 'Toggle Card',
    // No allowedTypes — on/off values are configured per-binding
    // and auto-detect the type from the selected payload path.
    fields: [{ key: 'target', label: 'Target binding', withToggleValues: true, noLabel: true, lockToggleType: true, keepToggleValuesOnLoad: true }],
    hasIcon: true,
    sampleTitle: 'Bedroom Light',
    sampleSub:   'Tap to toggle',
  },
  // ── Dual toggle — two independent boolean controls ──
  dual_toggle: {
    title: 'Dual Toggle',
    fields: [
      { key: 'target_a', label: 'Toggle A', withToggleValues: true, withStateLabels: true, lockToggleType: true, keepToggleValuesOnLoad: true },
      { key: 'target_b', label: 'Toggle B', withToggleValues: true, withStateLabels: true, lockToggleType: true, keepToggleValuesOnLoad: true },
    ],
    hasIcon: true,
    sampleTitle: 'Room Control',
    sampleSub:   'Two switches',
  },
  // ── Press switch — momentary push button ──────────
  press_switch: {
    title: 'Press Switch',
    fields: [{ key: 'target', label: 'Target binding', withToggleValues: true, noLabel: true, keepToggleValuesOnLoad: true, lockToggleType: true }],
    hasIcon: true,
    sampleTitle: 'Power',
    sampleSub:   'Push to toggle',
  },
  // ── Single-shot action buttons ─────────────────────
  single_button: {
    title: 'Action Card',
    fields: [{ key: 'target', label: 'Target binding', withToggleValues: true, withButtonLabels: true, lockToggleType: true, keepToggleValuesOnLoad: true, noLabel: true }],
    hasIcon: true,
    sampleTitle: 'Room Light',
    sampleSub:   'Tap to toggle',
  },
  // ── Multiple actions in a single card ──────────────
  multi_button: {
    title: 'Multi Action',
    fields: [{ key: 'target', label: 'Target binding', noLabel: true }],
    hasPerBindingActions: true,   // each binding has its own actions list
    hasIcon: true,
    sampleTitle: 'Quick Actions',
    sampleSub:   'Pick an action',
    sampleActions: [
      { label: '', value: '', type: 'string' },
    ],
  },
  // ── Numeric stepper (+ / − value) ───────────────────
  stepper: {
    title: 'Stepper',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true,
    hasIcon: true,
    sampleTitle: 'Temperature',
    sampleSub:   'Adjust value',
  },
  // ── Slider ─────────────────────────────────────────
  slider: {
    title: 'Level Control',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['int', 'float'] }],
    hasMinMax: true,
    hasIcon: true,
    sampleTitle: 'Brightness',
    sampleSub:   'Tap +/− to adjust',
  },
  // ── Text entry ─────────────────────────────────────
  text_input: {
    title: 'Text Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['string'], noLabel: true }],
    hasIcon: true,
    sampleTitle: 'Device Name',
    sampleSub:   'Type + send',
  },
  // ── Number entry (with unit) ───────────────────────
  number_input: {
    title: 'Number Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['int', 'float'], noLabel: true }],
    hasUnit: true,
    hasIcon: true,
    sampleTitle: 'Set Temperature',
    sampleSub:   'Type + send',
  },
  list_input: {
    title: 'List Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['list'], noLabel: true }],
    hasIcon: true,
    sampleTitle: 'Config List',
    sampleSub:   'JSON array + send',
  },
  json_input: {
    title: 'JSON Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['dict'], noLabel: true }],
    hasIcon: true,
    sampleTitle: 'Config Object',
    sampleSub:   'JSON object + send',
  },
}

const CONTROL_VARIANTS = [
  { id: 'switch',         title: 'Toggle Card' },
  { id: 'dual_toggle',    title: 'Dual Toggle' },
  { id: 'press_switch',   title: 'Press Switch' },
  { id: 'single_button',  title: 'Action Card' },
  { id: 'multi_button',   title: 'Multi Action' },
  { id: 'stepper',        title: 'Stepper' },
  { id: 'slider',         title: 'Level Control' },
  { id: 'text_input',     title: 'Text Entry' },
  { id: 'number_input',   title: 'Number Entry' },
  { id: 'list_input',     title: 'List Entry' },
  { id: 'json_input',     title: 'JSON Entry' },
]

/* Default RGL geometry per control variant (cell units). Multi-action
   cards get more width because their content fans out horizontally. */
const CONTROL_LAYOUT_DEFAULTS = {
  switch:         { w: 4, h: 3, minW: 3, minH: 3 },
  dual_toggle:    { w: 4, h: 4, minW: 4, minH: 4 },
  press_switch:   { w: 3, h: 4, minW: 3, minH: 3 },
  single_button:  { w: 4, h: 3, minW: 3, minH: 3 },
  multi_button:   { w: 5, h: 3, minW: 4, minH: 3 },
  stepper:        { w: 4, h: 3, minW: 4, minH: 3 },
  slider:         { w: 5, h: 3, minW: 4, minH: 3 },
  text_input:     { w: 5, h: 3, minW: 4, minH: 3 },
  number_input:   { w: 4, h: 3, minW: 4, minH: 3 },
  list_input:     { w: 5, h: 5, minW: 4, minH: 4 },
  json_input:     { w: 5, h: 4, minW: 4, minH: 3 },
}

/* =====================================================================
   CUSTOM FILL VARIANT DEFINITIONS
   ===================================================================== */
const FILL_VARIANT_DEFS = {
  battery_fill: {
    title: 'Battery',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Battery', sampleVal: 80,
  },
  tank_rect_fill: {
    title: 'Level Tank 1',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Level Tank 1', sampleVal: 40,
  },
  tank_sphere_fill: {
    title: 'Level Tank 2',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Level Tank 2', sampleVal: 60,
  },
}
const FILL_VARIANTS = [
  { id: 'battery_fill',     title: 'Battery' },
  { id: 'tank_rect_fill',   title: 'Level Tank 1' },
  { id: 'tank_sphere_fill', title: 'Level Tank 2' },
]
const FILL_LAYOUT_DEFAULTS = {
  battery_fill:      { w: 4, h: 4, minW: 3, minH: 3 },
  tank_rect_fill:    { w: 4, h: 5, minW: 3, minH: 4 },
  tank_sphere_fill:  { w: 4, h: 4, minW: 3, minH: 3 },
}
function isFillVariant(v) { return !!(v && FILL_VARIANT_DEFS[v]) }

/* =====================================================================
   LOG VARIANT DEFINITIONS — read-only widgets that display a list of
   log entries pulled from a device payload path. The bound value is
   expected to be an array; each item is either a string or an object
   like { time, level, message } (any subset works).
   ===================================================================== */
const LOG_VARIANT_DEFS = {
  log_feed: {
    title: 'Log Feed',
    fields: [{ key: 'source', label: 'Log source (list)', allowedTypes: ['list'] }],
    sampleTitle: 'Activity Log',
  },
  log_console: {
    title: 'Console Log',
    fields: [{ key: 'source', label: 'Log source (list)', allowedTypes: ['list'] }],
    sampleTitle: 'System Console',
  },
  log_timeline: {
    title: 'Event Timeline',
    fields: [{ key: 'source', label: 'Log source (list)', allowedTypes: ['list'] }],
    sampleTitle: 'Events',
  },
}
const LOG_VARIANTS = [
  { id: 'log_feed',     title: 'Log Feed' },
  { id: 'log_console',  title: 'Console Log' },
  { id: 'log_timeline', title: 'Event Timeline' },
]
const LOG_LAYOUT_DEFAULTS = {
  log_feed:     { w: 6, h: 5, minW: 4, minH: 3 },
  log_console:  { w: 6, h: 5, minW: 4, minH: 3 },
  log_timeline: { w: 5, h: 6, minW: 4, minH: 4 },
}
function isLogVariant(v) { return !!(v && LOG_VARIANT_DEFS[v]) }

/* Sample log rows shown in the gallery / configure preview before a
   real source is bound. */
const SAMPLE_LOGS = [
  { time: '14:32:08', level: 'info',  message: 'Device connected' },
  { time: '14:32:11', level: 'ok',    message: 'Payload synced · 14 keys' },
  { time: '14:33:02', level: 'warn',  message: 'Battery below 20%' },
  { time: '14:35:47', level: 'error', message: 'Motor stalled — retrying' },
  { time: '14:36:01', level: 'info',  message: 'Reconnected' },
]

/* Normalize whatever the binding returns into [{ time, level, message }]. */
function normalizeLogEntries(raw) {
  if (!Array.isArray(raw)) return null
  return raw.map((item) => {
    if (item == null) return { message: '' }
    if (typeof item === 'string' || typeof item === 'number') {
      return { message: String(item) }
    }
    if (typeof item === 'object') {
      const time = item.time ?? item.timestamp ?? item.ts ?? item.t ?? ''
      const level = String(item.level ?? item.type ?? item.severity ?? '').toLowerCase()
      const message = item.message ?? item.msg ?? item.text ?? item.event ?? JSON.stringify(item)
      return { time: String(time), level, message: String(message) }
    }
    return { message: String(item) }
  })
}
function logLevelClass(level) {
  const l = String(level || '').toLowerCase()
  if (l.startsWith('err') || l === 'critical' || l === 'fatal') return 'is-error'
  if (l.startsWith('warn')) return 'is-warn'
  if (l === 'ok' || l === 'success') return 'is-ok'
  return 'is-info'
}

/* =====================================================================
   CHART VARIANT DEFINITIONS
   ===================================================================== */
const CHART_VARIANT_DEFS = {
  bar_vertical: {
    title: 'Vertical Bar Chart',
    fields: [
      { key: 'v1', label: 'Bar 1', allowedTypes: ['int', 'float'] },
      { key: 'v2', label: 'Bar 2', allowedTypes: ['int', 'float'] },
      { key: 'v3', label: 'Bar 3', allowedTypes: ['int', 'float'] },
      { key: 'v4', label: 'Bar 4', allowedTypes: ['int', 'float'] },
    ],
    hasUnit: true, hasIcon: false, hasMinMax: false,
    sampleTitle: 'Monthly Sales',
  },
  bar_horizontal: {
    title: 'Horizontal Bar Chart',
    fields: [
      { key: 'v1', label: 'Bar 1', allowedTypes: ['int', 'float'] },
      { key: 'v2', label: 'Bar 2', allowedTypes: ['int', 'float'] },
      { key: 'v3', label: 'Bar 3', allowedTypes: ['int', 'float'] },
      { key: 'v4', label: 'Bar 4', allowedTypes: ['int', 'float'] },
    ],
    hasUnit: true, hasIcon: false, hasMinMax: false,
    sampleTitle: 'Resource Usage',
  },
  donut_chart: {
    title: 'Donut Chart',
    fields: [
      { key: 'v1', label: 'Segment 1', allowedTypes: ['int', 'float'] },
      { key: 'v2', label: 'Segment 2', allowedTypes: ['int', 'float'] },
      { key: 'v3', label: 'Segment 3', allowedTypes: ['int', 'float'] },
      { key: 'v4', label: 'Segment 4', allowedTypes: ['int', 'float'] },
    ],
    hasUnit: true, hasIcon: false, hasMinMax: false,
    sampleTitle: 'Distribution',
  },
}
const CHART_VARIANTS = [
  { id: 'bar_vertical',   title: 'Vertical Bar' },
  { id: 'bar_horizontal', title: 'Horizontal Bar' },
  { id: 'donut_chart',    title: 'Donut Chart' },
]
const CHART_LAYOUT_DEFAULTS = {
  bar_vertical:   { w: 5, h: 5, minW: 4, minH: 4 },
  bar_horizontal: { w: 5, h: 5, minW: 4, minH: 4 },
  donut_chart:    { w: 5, h: 5, minW: 4, minH: 4 },
}
function isChartVariant(v) { return !!(v && CHART_VARIANT_DEFS[v]) }
const CHART_BAR_COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#EF4444']

/* =====================================================================
   DIAL / GAUGE VARIANT DEFINITIONS
   ===================================================================== */
const DIAL_VARIANT_DEFS = {
  solid_gauge: {
    title: 'Solid Gauge',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Vehicle Speed', sampleVal: 50,
  },
  semi_dial: {
    title: 'Semi Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Vehicle Speed', sampleVal: 50,
  },
  full_dial: {
    title: 'Full Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Motor Speed', sampleVal: 110,
  },
  progress_dial: {
    title: 'Progress Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Engine Power', sampleVal: 3520,
  },
  threshold_dial: {
    title: 'Threshold Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Engine Power', sampleVal: 2025,
  },
  full_circle_dial: {
    title: 'Full Circle Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Mileage Summary', sampleVal: 680,
  },
}
const DIAL_VARIANTS = [
  { id: 'solid_gauge',      title: 'Solid Gauge' },
  { id: 'semi_dial',        title: 'Semi Dial' },
  { id: 'full_dial',        title: 'Full Dial' },
  { id: 'progress_dial',    title: 'Progress Dial' },
  { id: 'threshold_dial',   title: 'Threshold Dial' },
  { id: 'full_circle_dial', title: 'Full Circle Dial' },
]
const DIAL_LAYOUT_DEFAULTS = {
  solid_gauge:       { w: 4, h: 4, minW: 3, minH: 3 },
  semi_dial:         { w: 4, h: 4, minW: 3, minH: 3 },
  full_dial:         { w: 4, h: 4, minW: 3, minH: 3 },
  progress_dial:     { w: 4, h: 5, minW: 3, minH: 4 },
  threshold_dial:    { w: 5, h: 4, minW: 4, minH: 3 },
  full_circle_dial:  { w: 4, h: 4, minW: 3, minH: 3 },
}
function isDialVariant(v) { return !!(v && DIAL_VARIANT_DEFS[v]) }
function dialPercent(value, min, max) {
  if (max <= min) return 0
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

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
      { key: 'current',  label: 'Current value source',  allowedTypes: ['int', 'float'] },
      { key: 'previous', label: 'Previous value source (e.g. Yesterday)', allowedTypes: ['int', 'float'] },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Fuel Consumption',
  },
  multivalue_grid: {
    title: 'Multivalue Card 1',
    fields: [
      { key: 'm1', label: 'Minimum',    allowedTypes: ['int', 'float'], withUnit: true },
      { key: 'm2', label: 'Last Value', allowedTypes: ['int', 'float'], withUnit: true },
      { key: 'm3', label: 'Maximum',    allowedTypes: ['int', 'float'], withUnit: true },
      { key: 'm4', label: 'Average',    allowedTypes: ['int', 'float'], withUnit: true },
    ],
    hasIcon: true,
    hasUnit: false,
    sampleTitle: 'Conf Room Data Trend',
  },
  multivalue_row: {
    title: 'Multivalue Card 2',
    fields: [
      { key: 'm1', label: 'Metric 1', withIcon: true, withUnit: true, allowedTypes: ['int', 'float'] },
      { key: 'm2', label: 'Metric 2', withIcon: true, withUnit: true, allowedTypes: ['int', 'float'] },
      { key: 'm3', label: 'Metric 3', withIcon: true, withUnit: true, allowedTypes: ['int', 'float'] },
    ],
    hasIcon: false,
    hasUnit: false,
    sampleTitle: 'Conf Room Data Trend',
  },
  multivalue_assorted: {
    title: 'Multivalue Card 3 (Assorted)',
    fields: [
      { key: 'm1', label: 'Metric 1', withIcon: true, withUnit: true, allowedTypes: ['int', 'float'] },
      { key: 'm2', label: 'Metric 2', withIcon: true, withUnit: true, allowedTypes: ['int', 'float'] },
    ],
    hasIcon: false,
    hasUnit: false,
    sampleTitle: 'Conf Room Details',
  },
  trend: {
    title: 'Trend Card',
    fields: [
      { key: 'value', label: 'Value source', allowedTypes: ['int', 'float'], noLabel: true },
      // Trend / delta source must be the SAME numeric type as the value
      // source so percentage deltas are meaningful. The actual allowedTypes
      // here are narrowed at runtime in CardConfigure based on the first
      // binding's resolved type (see effectiveAllowedTypes).
      { key: 'trend', label: 'Trend / delta source (optional)', allowedTypes: ['int', 'float'], matchTypeOfFirst: true, noLabel: true },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Production Rate',
  },
  progress: {
    title: 'Progress Card',
    fields: [
      { key: 'value', label: 'Current value source', allowedTypes: ['int', 'float'], noLabel: true },
      { key: 'total', label: 'Total / target value source', allowedTypes: ['int', 'float'], matchTypeOfFirst: true, noLabel: true, allowStatic: true },
    ],
    hasIcon: false,
    hasUnit: false,
    // No static target field — both current AND total now come from
    // live payload bindings, so the percentage is always derived from
    // real device values.
    hasBarColor: true,        // surfaces a colour picker for the bar fill
    hasProgressLabels: true,  // custom labels for the "done" / "left" footers
    sampleTitle: 'Daily Target',
  },
}

/* =====================================================================
   CardConfigure — second view in the picker. Shows the chosen variant
   as a large "Example" preview at the top, "Change Style" returns to
   the gallery, and below is a form whose field count matches the
   variant (1 binding for simple, 4 for multivalue-grid, etc.).
   ===================================================================== */
function CardConfigure({ variant, devices, onBack, onSubmit, initial, themeDefaults }) {
  const def = CARD_VARIANT_DEFS[variant] || CARD_VARIANT_DEFS.simple_value
  const isEditing = !!initial
  // Pull defaults from the existing component when editing so the form
  // opens with the user's last choices already filled in. When CREATING
  // a new widget, fall back to the dashboard theme's preferred colors
  // so the widget visually belongs to the dashboard without the user
  // having to pick.
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const themeCardDefault = themeDefaults?.cardColor || 'peach'
  const themeIconDefault = themeDefaults?.iconColor || 'orange'
  const [widgetName, setWidgetName]   = useState(initial?.widget_name || '')
  const [title, setTitle]             = useState(initCfg.title || '')
  const [description, setDescription] = useState(initCfg.description || '')
  const [icon, setIcon]               = useState(initStat.icon || '')
  const [unit, setUnit]               = useState(initStat.unit || '')
  const [target, setTarget]         = useState(initStat.target || '')
  const [cardColor, setCardColor]   = useState(initStat.card_color || themeCardDefault)
  const [iconColor, setIconColor]   = useState(initStat.icon_color || themeIconDefault)
  const [pattern, setPattern]       = useState(initStat.pattern || '')
  const [onLabel, setOnLabel]       = useState(initStat.on_label || '')
  const [offLabel, setOffLabel]     = useState(initStat.off_label || '')
  const [barColor, setBarColor]     = useState(initStat.bar_color || themeIconDefault)
  const [doneLabel, setDoneLabel]   = useState(initStat.done_label || '')
  const [leftLabel, setLeftLabel]   = useState(initStat.left_label || '')
  const [bindings, setBindings] = useState(() =>
    def.fields.map((_, i) => {
      const ex = initBindings[i]
      return ex
        ? {
            device_id: ex.device_id != null ? String(ex.device_id) : '',
            payload_path: ex.payload_path || '',
            label: ex.label || '',
            icon: ex.icon || '',
            unit: ex.unit || '',
            use_static: !!ex.use_static,
            static_value: ex.static_value != null ? String(ex.static_value) : '',
            on_label: ex.on_label || '',
            off_label: ex.off_label || '',
          }
        : { device_id: '', payload_path: '', label: '', icon: '', unit: '', use_static: false, static_value: '', on_label: '', off_label: '' }
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
    title:       title || def.sampleTitle,
    description: description || '',
    color:       cardColor,
    iconColor,
    icon,
    unit,
    target,
    bindings,
    pattern,
    onLabel,
    offLabel,
    barColor,
    doneLabel,
    leftLabel,
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
      if (b.use_static) {
        if (String(b.static_value ?? '').trim() === '' || !Number.isFinite(Number(b.static_value)))
          fes[`bindings.${i}.static_value`] = 'Enter a number.'
        return
      }
      if (!b.device_id)            fes[`bindings.${i}.device_id`]    = 'Pick a device.'
      if (!b.payload_path.trim())  fes[`bindings.${i}.payload_path`] = 'Required.'
    })
    setErrors(fes)
    if (Object.keys(fes).length > 0) return

    const config = {
      title: title || '',
      description: description || '',
      variant,
      bindings: bindings.map((b, i) => {
        // Fixed-value binding (e.g. Progress card's target): store the number
        // instead of a device/payload reference.
        if (b.use_static) {
          return {
            use_static: true,
            static_value: Number(b.static_value),
            label: b.label || def.fields[i].label,
            ...(b.unit ? { unit: b.unit } : {}),
          }
        }
        return {
          device_id: Number(b.device_id),
          payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''),
          label: b.label || def.fields[i].label,
          icon: b.icon || '',
          ...(b.unit ? { unit: b.unit } : {}),
          ...(b.on_label  ? { on_label: b.on_label }   : {}),
          ...(b.off_label ? { off_label: b.off_label } : {}),
        }
      }),
      static: {
        ...(unit       ? { unit }       : {}),
        ...(icon       ? { icon }       : {}),
        ...(target     ? { target }     : {}),
        ...(pattern    ? { pattern }    : {}),
        ...(onLabel    ? { on_label: onLabel }   : {}),
        ...(offLabel   ? { off_label: offLabel } : {}),
        ...(barColor   ? { bar_color: barColor } : {}),
        ...(doneLabel  ? { done_label: doneLabel } : {}),
        ...(leftLabel  ? { left_label: leftLabel } : {}),
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
            <DField label="Description (subtitle)" full>
              <input
                type="text"
                value={description}
                disabled={saving}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Current reading"
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
                <input type="text" inputMode="decimal" value={target} disabled={saving}
                  onChange={(e) => setTarget(e.target.value)} placeholder="5000" />
              </DField>
            )}
            {def.hasProgressLabels && (
              <>
                <DField label="Done label">
                  <input type="text" value={doneLabel} disabled={saving}
                    onChange={(e) => setDoneLabel(e.target.value)} placeholder="done" />
                </DField>
                <DField label="Left label">
                  <input type="text" value={leftLabel} disabled={saving}
                    onChange={(e) => setLeftLabel(e.target.value)} placeholder="left" />
                </DField>
              </>
            )}
            {def.hasBooleanLabels && (
              <>
                <DField label="Label when true (optional)">
                  <input type="text" value={onLabel} disabled={saving}
                    onChange={(e) => setOnLabel(e.target.value)}
                    placeholder="e.g. Running, On, Active" />
                </DField>
                <DField label="Label when false (optional)">
                  <input type="text" value={offLabel} disabled={saving}
                    onChange={(e) => setOffLabel(e.target.value)}
                    placeholder="e.g. Stopped, Off, Inactive" />
                </DField>
              </>
            )}
          </div>
        </div>

        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field">
            <span className="form-label">Card color</span>
            <CardColorPicker value={cardColor} onChange={setCardColor} disabled={saving} usedColors={themeDefaults?.usedColors} />
          </div>
          {hasAnyIcon && (
            <div className="form-field">
              <span className="form-label">Icon color</span>
              <IconColorPicker value={iconColor} onChange={setIconColor} disabled={saving} usedColors={themeDefaults?.usedIconColors} />
            </div>
          )}
          {def.hasBarColor && (
            <div className="form-field">
              <span className="form-label">Progress bar color</span>
              <IconColorPicker value={barColor} onChange={setBarColor} disabled={saving} usedColors={themeDefaults?.usedIconColors} />
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
          {def.fields.map((f, i) => {
            // Some fields are constrained by another binding's selection
            // (e.g. Trend's delta must be the same numeric type as the
            // value source). Compute the effective allowedTypes here so
            // PayloadPathField filters its dropdown correctly.
            let effectiveAllowedTypes = f.allowedTypes
            if (f.matchTypeOfFirst && i > 0) {
              const first = bindings[0]
              const firstDevice = devices.find((d) => String(d.id) === String(first?.device_id))
              if (firstDevice?.payload && first?.payload_path) {
                // Path strings can be stored with or without a leading
                // slash depending on whether they came from the dropdown
                // (`/test`) or have been saved-and-reloaded (`test`).
                // Normalize both sides before comparing.
                const norm = (s) => '/' + String(s).replace(/^\/+|\/+$/g, '')
                const target = norm(first.payload_path)
                const paths = flattenScalarPaths(firstDevice.payload)
                const found = paths.find((p) => norm(p.path) === target)
                if (found?.type === 'int' || found?.type === 'float') {
                  effectiveAllowedTypes = [found.type]
                }
              }
            }
            return (
              <BindingFields
                key={i}
                field={f}
                binding={bindings[i]}
                devices={devices}
                disabled={saving}
                allowedTypesOverride={effectiveAllowedTypes}
                errors={{
                  device_id:    errors[`bindings.${i}.device_id`],
                  payload_path: errors[`bindings.${i}.payload_path`],
                  static_value: errors[`bindings.${i}.static_value`],
                }}
                onChange={(k, v) => setBinding(i, k, v)}
              />
            )
          })}
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

/* Default on/off values per detected payload type. */
const TOGGLE_DEFAULTS = {
  boolean: { on: 'true',  off: 'false' },
  int:     { on: '1',     off: '0' },
  float:   { on: '1.0',   off: '0.0' },
  string:  { on: 'on',    off: 'off' },
  list:    { on: '[1]',   off: '[]' },
  dict:    { on: '{"state": "on"}', off: '{"state": "off"}' },
}

/* Human hint describing the expected input format for each payload type. */
const TYPE_FORMAT_HINT = {
  boolean: 'Enter true or false.',
  int:     'Enter a whole number, e.g. 1.',
  float:   'Enter a number, e.g. 1.5.',
  string:  'Enter any text.',
  list:    'Enter a JSON array, e.g. [1, 2].',
  dict:    'Enter a JSON object, e.g. {"state": "on"}.',
}

/* Validate a toggle on/off value string against the bound payload type.
   Returns an error message, or null when the value is well-formed. Used
   to guarantee the configured ON/OFF payload actually matches the type
   of the selected device field before it can be saved. */
function validateToggleValue(raw, type) {
  const v = String(raw ?? '').trim()
  if (v === '') return 'Required.'
  switch (type) {
    case 'boolean':
      return /^(true|false)$/i.test(v) ? null : 'Must be true or false.'
    case 'int':
      return /^-?\d+$/.test(v) ? null : 'Must be a whole number (e.g. 1).'
    case 'float':
      return /^-?(\d+(\.\d+)?|\.\d+)$/.test(v) ? null : 'Must be a number (e.g. 1.5).'
    case 'string':
      return null
    case 'list': {
      let parsed
      try { parsed = JSON.parse(v) } catch { return 'Must be valid JSON (e.g. [1, 2]).' }
      return Array.isArray(parsed) ? null : 'Must be a JSON array (e.g. [1, 2]).'
    }
    case 'dict': {
      let parsed
      try { parsed = JSON.parse(v) } catch { return 'Must be valid JSON (e.g. {"state": "on"}).' }
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? null : 'Must be a JSON object (e.g. {"state": "on"}).'
    }
    default:
      return null
  }
}

function BindingFields({ field, binding, devices, disabled, errors, onChange, allowedTypesOverride }) {
  const selectedDevice = devices.find((d) => String(d.id) === String(binding.device_id))
  const allowedTypes = allowedTypesOverride !== undefined ? allowedTypesOverride : field.allowedTypes

  // Detect the selected path's type so toggle values auto-adapt.
  const detectedType = useMemo(() => {
    if (!selectedDevice?.payload || !binding.payload_path) return null
    const norm = (s) => '/' + String(s).replace(/^\/+|\/+$/g, '')
    const target = norm(binding.payload_path)
    const paths = flattenScalarPaths(selectedDevice.payload)
    return paths.find((p) => norm(p.path) === target)?.type || null
  }, [selectedDevice?.payload, binding.payload_path])

  // ALWAYS reseed on/off values when the payload path changes (type
  // changes). This covers both the first pick and subsequent picks — the
  // user should never have to manually set the type after picking a new
  // path; it adapts automatically. The press switch opts out of clobbering
  // saved values on load via keepToggleValuesOnLoad (see below).
  const seededPathRef = useRef(binding.payload_path || '')
  useEffect(() => {
    if (!field.withToggleValues || !detectedType) return
    // keepToggleValuesOnLoad (press switch only): an EXISTING binding's
    // detectedType flips null -> list/dict after the async device load,
    // even though the path never changed. Skip the reseed while the path
    // is unchanged so saved JSON/list values survive the edit screen; a
    // real user-driven path change still adapts the values.
    if (field.keepToggleValuesOnLoad) {
      const pathChanged = seededPathRef.current !== (binding.payload_path || '')
      seededPathRef.current = binding.payload_path || ''
      if (!pathChanged) return
    }
    const defs = TOGGLE_DEFAULTS[detectedType] || TOGGLE_DEFAULTS.string
    onChange('on_value', defs.on)
    onChange('off_value', defs.off)
    onChange('on_type', detectedType)
    onChange('off_type', detectedType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedType])

  const useStatic = !!binding.use_static
  return (
    <div className="card-config-binding">
      <div className="card-config-binding-label">{field.label}</div>
      {field.allowStatic && (
        <div className="binding-source-toggle" role="group" aria-label="Value source">
          <button type="button"
            className={'binding-source-btn' + (!useStatic ? ' is-active' : '')}
            onClick={() => onChange('use_static', false)} disabled={disabled}>
            From device
          </button>
          <button type="button"
            className={'binding-source-btn' + (useStatic ? ' is-active' : '')}
            onClick={() => onChange('use_static', true)} disabled={disabled}>
            Fixed value
          </button>
        </div>
      )}
      <div className="form-grid-2">
        {field.allowStatic && useStatic ? (
          <DField label="Value" required error={errors.static_value} full>
            <input type="text" inputMode="decimal" value={binding.static_value || ''} disabled={disabled}
              onChange={(e) => onChange('static_value', e.target.value)} placeholder="5000" />
          </DField>
        ) : (
        <>
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
            allowedTypes={allowedTypes}
          />
        </DField>
        </>
        )}
        {!field.noLabel && (
          <DField label="Label" full={!field.withIcon}>
            <input type="text" value={binding.label} disabled={disabled}
              onChange={(e) => onChange('label', e.target.value)}
              placeholder={field.label} />
          </DField>
        )}
        {field.withIcon && (
          <DField label="Icon">
            <IconPickerField value={binding.icon} disabled={disabled}
              onChange={(v) => onChange('icon', v)} />
          </DField>
        )}
        {field.withUnit && (
          <DField label="Unit (e.g. °C, Ltrs)">
            <input type="text" value={binding.unit || ''} disabled={disabled}
              onChange={(e) => onChange('unit', e.target.value)}
              placeholder="°C" />
          </DField>
        )}
        {field.withBoolLabels && (
          <>
            <DField label="Boolean label · true (optional)">
              <input type="text" value={binding.on_label || ''} disabled={disabled}
                onChange={(e) => onChange('on_label', e.target.value)}
                placeholder="e.g. On, Running, Active" />
            </DField>
            <DField label="Boolean label · false (optional)">
              <input type="text" value={binding.off_label || ''} disabled={disabled}
                onChange={(e) => onChange('off_label', e.target.value)}
                placeholder="e.g. Off, Stopped, Inactive" />
            </DField>
          </>
        )}
        {field.withToggleValues && (() => {
          // When the field locks the type (toggle / dual toggle / press
          // switch) AND the device has reported a payload, the ON/OFF type
          // is pinned to the selected field's type and can't be edited —
          // the values can only be of that one type. Falls back to an
          // editable selector when the type can't be detected (custom path
          // / device hasn't reported a payload yet).
          const lockType = !!field.lockToggleType && !!detectedType
          const lockedType = detectedType || 'boolean'
          const renderType = (which) => {
            const cur = binding[`${which}_type`] || detectedType || 'boolean'
            if (lockType) {
              return (
                <DField label={which === 'on' ? 'ON type' : 'OFF type'}>
                  <div className="ctrl-type-locked" title="Matches the selected payload field — not editable">
                    <span>{lockedType}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                </DField>
              )
            }
            return (
              <DField label={which === 'on' ? 'ON type' : 'OFF type'}>
                <select value={cur} disabled={disabled}
                  onChange={(e) => onChange(`${which}_type`, e.target.value)}>
                  <option value="boolean">boolean</option>
                  <option value="string">string</option>
                  <option value="int">int</option>
                  <option value="float">float</option>
                  <option value="list">list</option>
                  <option value="dict">dict</option>
                </select>
              </DField>
            )
          }
          const fmtType = lockType ? lockedType : null
          return (
            <>
              <DField label="Send when ON" error={errors.on_value}>
                <input type="text" value={binding.on_value || ''} disabled={disabled}
                  onChange={(e) => onChange('on_value', e.target.value)}
                  placeholder={(TOGGLE_DEFAULTS[detectedType] || TOGGLE_DEFAULTS.boolean).on} />
              </DField>
              {renderType('on')}
              <DField label="Send when OFF" error={errors.off_value}>
                <input type="text" value={binding.off_value || ''} disabled={disabled}
                  onChange={(e) => onChange('off_value', e.target.value)}
                  placeholder={(TOGGLE_DEFAULTS[detectedType] || TOGGLE_DEFAULTS.boolean).off} />
              </DField>
              {renderType('off')}
              {fmtType && (
                <p className="ctrl-json-hint" style={{ gridColumn: '1 / -1', margin: '2px 0 0', fontSize: '11.5px', color: 'var(--ink-3, #8c8377)' }}>
                  Locked to the <strong>{fmtType}</strong> field. {TYPE_FORMAT_HINT[fmtType] || ''}
                </p>
              )}
              {!fmtType && (detectedType === 'list' || detectedType === 'dict') && (
                <p className="ctrl-json-hint" style={{ gridColumn: '1 / -1', margin: '2px 0 0', fontSize: '11.5px', color: 'var(--ink-3, #8c8377)' }}>
                  Enter the ON/OFF values as JSON ({detectedType === 'list' ? 'e.g. [1, 2]' : 'e.g. {"state": "on"}'}).
                </p>
              )}
            </>
          )
        })()}
        {field.withStateLabels && (
          <>
            <DField label="Display label · ON (optional)">
              <input type="text" value={binding.on_label || ''} disabled={disabled}
                onChange={(e) => onChange('on_label', e.target.value)}
                placeholder="e.g. Open, Active, Running" />
            </DField>
            <DField label="Display label · OFF (optional)">
              <input type="text" value={binding.off_label || ''} disabled={disabled}
                onChange={(e) => onChange('off_label', e.target.value)}
                placeholder="e.g. Closed, Idle, Stopped" />
            </DField>
          </>
        )}
        {field.withButtonLabels && (
          <>
            <DField label="Button label · ON" error={errors.on_label}>
              <input type="text" value={binding.on_label || ''} disabled={disabled}
                onChange={(e) => onChange('on_label', e.target.value)}
                placeholder="e.g. Turn Off" />
            </DField>
            <DField label="Button label · OFF" error={errors.off_label}>
              <input type="text" value={binding.off_label || ''} disabled={disabled}
                onChange={(e) => onChange('off_label', e.target.value)}
                placeholder="e.g. Turn On" />
            </DField>
          </>
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
/* Detect the backend's { type, value } wrapper pattern. An object
   that has EXACTLY two keys — "type" (string) + "value" — is a typed
   wrapper regardless of whether the value is a scalar, a dict, or a
   list. Wrappers with a scalar value become leaf paths; wrappers with
   dict/list values are SKIPPED entirely so their internals never leak
   into the payload-path dropdown (e.g. /config/value/mode). */
function isTypedWrapper(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const keys = Object.keys(v)
  return keys.length === 2 && typeof v.type === 'string' && ('value' in v)
}
function isScalarTypedWrapper(v) {
  if (!isTypedWrapper(v)) return false
  const vv = v.value
  return vv === null || ['string', 'number', 'boolean'].includes(typeof vv)
}
function normalizeDeclaredType(declared, value) {
  const d = String(declared || '').toLowerCase()
  if (d === 'int' || d === 'integer')                   return 'int'
  if (d === 'float' || d === 'double' || d === 'number') return 'float'
  if (d === 'string' || d === 'str')                    return 'string'
  if (d === 'bool'   || d === 'boolean')                return 'boolean'
  if (d === 'list')                                     return 'list'
  if (d === 'dict')                                     return 'dict'
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
    // ── Typed wrapper detection ──
    // { type: "string", value: "sai" }  → emit as /test · string
    // { type: "dict",   value: {...} }  → SKIP entirely (no /test/value/...)
    // { type: "list",   value: [...] }  → SKIP entirely
    if (isTypedWrapper(v)) {
      if (isScalarTypedWrapper(v)) {
        out.push({ path: next, type: normalizeDeclaredType(v.type, v.value) })
      } else {
        const d = String(v.type).toLowerCase()
        if (d === 'list' && Array.isArray(v.value)) out.push({ path: next, type: 'list' })
        else if (d === 'dict' && typeof v.value === 'object' && v.value !== null) out.push({ path: next, type: 'dict' })
      }
      continue
    }
    const t = typeof v
    if (t === 'number')        out.push({ path: next, type: Number.isInteger(v) ? 'int' : 'float' })
    else if (t === 'string')   out.push({ path: next, type: 'string' })
    else if (t === 'boolean')  out.push({ path: next, type: 'boolean' })
    else if (Array.isArray(v)) out.push({ path: next, type: 'list' })
    else if (t === 'object')   flattenScalarPaths(v, next, out)
  }
  return out
}

/* PayloadPathField — dropdown of detected scalar leaf paths for the
   currently selected device. Auto-switches to a free-form text input
   when the device has no payload yet, or when the user wants to enter
   a custom path that isn't in the list. */
function PayloadPathField({ device, value, onChange, disabled, allowedTypes }) {
  const paths = useMemo(() => {
    const all = flattenScalarPaths(device?.payload || {})
    if (!allowedTypes || !allowedTypes.length) return all
    const allowed = new Set(allowedTypes)
    return all.filter((p) => allowed.has(p.type))
  }, [device?.payload, allowedTypes])
  const valueInList = useMemo(() => paths.some((p) => p.path === value), [paths, value])
  const [custom, setCustom] = useState(false)

  // If the user has a path that isn't in the device's payload, drop
  // into custom mode so they can keep editing it.
  useEffect(() => {
    if (value && paths.length > 0 && !valueInList) setCustom(true)
  }, [value, paths.length, valueInList])

  const useCustomInput = paths.length === 0 || custom

  if (useCustomInput) {
    const typeLabel = allowedTypes && allowedTypes.length
      ? allowedTypes.join(' or ')
      : 'scalar'
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
            {allowedTypes && allowedTypes.length
              ? `No ${typeLabel} fields in this device's payload — enter a path manually.`
              : 'Device hasn’t reported a payload yet — type the path manually.'}
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

/* =====================================================================
   ControlVariantGallery — tiles for each Control widget variant. Same
   visual chrome as CardVariantGallery; renders a non-interactive
   sample of each control so the user can pick by sight.
   ===================================================================== */
function ControlVariantGallery({ onPick }) {
  return (
    <div className="card-gallery card-gallery-controls">
      {CONTROL_VARIANTS.map((v) => (
        <button
          key={v.id}
          type="button"
          className="card-variant"
          onClick={() => onPick?.(v.id)}
          aria-label={`Use ${v.title}`}
        >
          <div className="card-variant-title">{v.title}</div>
          <div className="card-variant-preview">
            <ControlPreview variant={v.id} />
          </div>
        </button>
      ))}
    </div>
  )
}

/* Dispatch a control variant id to its preview component. */
/* =====================================================================
   DIAL / GAUGE COMPONENTS
   ===================================================================== */
function DialVariantGallery({ onPick }) {
  return (
    <div className="card-gallery card-gallery-dials">
      {DIAL_VARIANTS.map((v) => (
        <button key={v.id} type="button" className="card-variant"
          onClick={() => onPick?.(v.id)} aria-label={`Use ${v.title}`}>
          <div className="card-variant-title">{v.title}</div>
          <div className="card-variant-preview">
            <DialPreview variant={v.id} />
          </div>
        </button>
      ))}
    </div>
  )
}

function DialPreview({ variant, options = {} }) {
  switch (variant) {
    case 'solid_gauge':      return <PreviewSolidGauge options={options} />
    case 'semi_dial':        return <PreviewSemiDial options={options} />
    case 'full_dial':        return <PreviewFullDial options={options} />
    case 'progress_dial':    return <PreviewProgressDial options={options} />
    case 'threshold_dial':   return <PreviewThresholdDial options={options} />
    case 'full_circle_dial': return <PreviewFullCircleDial options={options} />
    default: return null
  }
}

function useDialData(options, defaults) {
  const title   = options.title || defaults.title
  const colorId = options.color || 'peach'
  const style   = cardStyleFor(colorId)
  const hex     = getIconColor(options.iconColor || 'orange').hex
  const min     = Number(options.min ?? 0)
  const max     = Number(options.max ?? 100)
  const unit    = options.unit ?? ''
  const b       = options.bindings?.[0]
  const live    = resolveBindingValue(b, options.devicesById)
  const declType = resolveBindingDeclaredType(b, options.devicesById)
  const value   = typeof live === 'number' ? live : (min + max) / 2
  const pct     = dialPercent(value, min, max)
  const isFloat = declType === 'float'
  const display = typeof live === 'number'
    ? (isFloat ? abbreviateNum(parseFloat(live.toFixed(1))) : abbreviateNum(Number.isInteger(live) ? live : parseFloat(live.toFixed(1))))
    : (options.devicesById ? '-' : abbreviateNum(Math.round((min + max) / 2)))
  return { title, style, hex, min, max, unit, value, pct, display, isFloat, live, icon: options.icon }
}

/* Smoothly eases a numeric value toward its target with requestAnimationFrame
   so gauges/dials glide to a new reading instead of snapping to it. */
function useAnimatedNumber(target, { duration = 700 } = {}) {
  const valid = typeof target === 'number' && Number.isFinite(target)
  const [val, setVal] = useState(valid ? target : 0)
  const fromRef = useRef(valid ? target : 0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!valid) return
    const from = fromRef.current
    const to = target
    if (from === to) { setVal(to); return }
    const dur = Math.max(1, duration)
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
    let start = null
    const tick = (ts) => {
      if (start == null) start = ts
      const p = Math.min(1, (ts - start) / dur)
      const cur = from + (to - from) * easeOutCubic(p)
      fromRef.current = cur
      setVal(cur)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else { fromRef.current = to; setVal(to) }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, valid, duration])

  return valid ? val : target
}

function abbreviateNum(n) {
  const abs = Math.abs(n)
  if (abs >= 1e9)  return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B'
  if (abs >= 1e6)  return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M'
  if (abs >= 1e4)  return (n / 1e3).toFixed(abs >= 1e5 ? 0 : 1) + 'K'
  if (abs >= 1e3)  return (n / 1e3).toFixed(1) + 'K'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1)
}

/* Helper: build an SVG arc path from angle a1 to a2 (degrees) */
function svgArc(cx, cy, r, a1Deg, a2Deg) {
  const toRad = (d) => (d * Math.PI) / 180
  const x1 = cx + r * Math.cos(toRad(a1Deg)), y1 = cy + r * Math.sin(toRad(a1Deg))
  const x2 = cx + r * Math.cos(toRad(a2Deg)), y2 = cy + r * Math.sin(toRad(a2Deg))
  const large = (a2Deg - a1Deg) > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}
function pointOnArc(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/* ── 1. Solid Gauge — thick 180° arc fill + tapered needle ── */
function PreviewSolidGauge({ options = {} }) {
  const d = useDialData(options, { title: 'Vehicle Speed' })
  const uid = useId().replace(/:/g, '')
  const fillId = `gaugeFill-${uid}`
  const shadowId = `gaugeShadow-${uid}`
  // Ease the reading so the needle, fill and number glide gradually
  // toward a new value instead of snapping to it.
  const animValue = useAnimatedNumber(d.value, { duration: 700 })
  const isLive = typeof d.live === 'number'
  const pct = dialPercent(animValue, d.min, d.max)
  const display = isLive
    ? abbreviateNum(d.isFloat ? parseFloat(animValue.toFixed(1)) : Math.round(animValue))
    : d.display

  const cx = 50, cy = 52, r = 38, sw = 10
  const startDeg = 180, sweepDeg = 180
  const arcPath = svgArc(cx, cy, r, startDeg, startDeg + sweepDeg)
  const toRad = (deg) => (deg * Math.PI) / 180
  const valDeg = startDeg + (sweepDeg * pct / 100)
  // Flat (butt) caps: the bar begins / ends exactly at its centerline endpoints
  // (no rounded blob bulging perpendicular to the needle), and the fill stops
  // flush on the needle angle — so the needle tip lines up precisely with the
  // start (0%) and end (100%) of the bar.
  const fillEndDeg = startDeg + (sweepDeg * pct / 100)
  const showFill = pct > 0 && fillEndDeg > startDeg + 0.01
  const fillPath = showFill ? svgArc(cx, cy, r, startDeg, fillEndDeg) : null
  // Needle tip lands on the bar's centerline endpoint, exactly where the flat
  // bar starts / ends.
  const needleLen = r
  const needleAngle = toRad(valDeg)
  const tipX = cx + needleLen * Math.cos(needleAngle)
  const tipY = cy + needleLen * Math.sin(needleAngle)
  const baseSpread = 2.7
  const perpAngle = needleAngle + Math.PI / 2
  const b1x = cx + baseSpread * Math.cos(perpAngle)
  const b1y = cy + baseSpread * Math.sin(perpAngle)
  const b2x = cx - baseSpread * Math.cos(perpAngle)
  const b2y = cy - baseSpread * Math.sin(perpAngle)
  // Counterweight tail so the needle reads as a balanced pointer.
  const tailLen = 8
  const tailX = cx - tailLen * Math.cos(needleAngle)
  const tailY = cy - tailLen * Math.sin(needleAngle)
  // Subtle tick marks around the arc for a polished gauge feel.
  const tickCount = 10
  const ticks = []
  for (let i = 0; i <= tickCount; i++) {
    const a = toRad(startDeg + (sweepDeg * i) / tickCount)
    const major = i % 5 === 0
    const inR = r + sw / 2 + 1.5
    const outR = inR + (major ? 3 : 1.8)
    ticks.push(
      <line key={i}
        x1={cx + inR * Math.cos(a)} y1={cy + inR * Math.sin(a)}
        x2={cx + outR * Math.cos(a)} y2={cy + outR * Math.sin(a)}
        stroke={hexToRgba(d.hex, major ? 0.5 : 0.28)}
        strokeWidth={major ? 1.4 : 0.8} strokeLinecap="round" />
    )
  }
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="-6 -2 112 71">
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={d.hex} stopOpacity="0.62" />
              <stop offset="100%" stopColor={d.hex} stopOpacity="1" />
            </linearGradient>
            <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1.1" stdDeviation="1" floodColor="#0b1220" floodOpacity="0.28" />
            </filter>
          </defs>
          {ticks}
          {/* Flat (butt) ends keep the bar's 0 / 100 edges square so the needle
              tip aligns precisely with the start / end of the bar. */}
          <path d={arcPath} fill="none" stroke={hexToRgba(d.hex, 0.13)}
            strokeWidth={sw} strokeLinecap="butt" />
          {showFill && (
            <path d={fillPath} fill="none" stroke={`url(#${fillId})`}
              strokeWidth={sw} strokeLinecap="butt" />
          )}
          <g filter={`url(#${shadowId})`}>
            <line x1={cx} y1={cy} x2={tailX} y2={tailY}
              stroke="#2D3436" strokeWidth={2.6} strokeLinecap="round" />
            <polygon
              points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
              fill="#2D3436" />
          </g>
          <circle cx={cx} cy={cy} r={4.6} fill="#2D3436" />
          <circle cx={cx} cy={cy} r={4.6} fill="none"
            stroke={d.hex} strokeWidth={1.1} opacity={0.85} />
          <circle cx={cx} cy={cy} r={1.9} fill="#fff" opacity={0.92} />
          <text x={cx - r} y={cy + 12} textAnchor="middle"
            className="dial-svg-label dial-gauge-label">{abbreviateNum(d.min)}</text>
          <text x={cx + r} y={cy + 12} textAnchor="middle"
            className="dial-svg-label dial-gauge-label">{abbreviateNum(d.max)}</text>
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 2. Semi Dial — 180° arc with tick marks, numbers, needle ── */
function PreviewSemiDial({ options = {} }) {
  const d = useDialData(options, { title: 'Vehicle Speed' })
  // Ease the reading so the needle glides along the arc instead of jumping.
  const animValue = useAnimatedNumber(d.value, { duration: 700 })
  const isLive = typeof d.live === 'number'
  const pct = dialPercent(animValue, d.min, d.max)
  const display = isLive
    ? abbreviateNum(d.isFloat ? parseFloat(animValue.toFixed(1)) : Math.round(animValue))
    : d.display
  const cx = 50, cy = 52, r = 38, sw = 5
  const startDeg = 180, sweepDeg = 180
  const toRad = (deg) => (deg * Math.PI) / 180
  const needleAngle = startDeg + (sweepDeg * pct / 100)
  const trackPath = svgArc(cx, cy, r, startDeg, startDeg + sweepDeg)
  const tickCount = 10
  const ticks = []
  for (let i = 0; i <= tickCount; i++) {
    const angle = startDeg + (sweepDeg * i / tickCount)
    const rad = toRad(angle)
    const isMajor = i % 2 === 0
    const outerR = r + 2
    const innerR = isMajor ? r - 6 : r - 3
    ticks.push(
      <line key={`t${i}`}
        x1={cx + innerR * Math.cos(rad)} y1={cy + innerR * Math.sin(rad)}
        x2={cx + outerR * Math.cos(rad)} y2={cy + outerR * Math.sin(rad)}
        stroke={hexToRgba(d.hex, isMajor ? 0.5 : 0.25)}
        strokeWidth={isMajor ? 1.5 : 0.8} strokeLinecap="round" />
    )
    // Endpoint (0 / max) labels are drawn at the bottom like the solid gauge;
    // intermediate majors stay around the arc.
    if (isMajor && i !== 0 && i !== tickCount) {
      const labelR = r + 10
      const lx = cx + labelR * Math.cos(rad)
      const ly = cy + labelR * Math.sin(rad)
      const labelVal = Math.round(d.min + (d.max - d.min) * i / tickCount)
      ticks.push(
        <text key={`l${i}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
          fill="currentColor" opacity={0.55} className="dial-svg-label">
          {abbreviateNum(labelVal)}
        </text>
      )
    }
  }
  const needleRad = toRad(needleAngle)
  // Tip reaches the arc's centerline endpoint so it lands exactly on the start /
  // end points (matches the solid gauge).
  const needleLen = r
  const tipX = cx + needleLen * Math.cos(needleRad)
  const tipY = cy + needleLen * Math.sin(needleRad)
  const baseSpread = 2.2
  const perpAngle = needleRad + Math.PI / 2
  const b1x = cx + baseSpread * Math.cos(perpAngle)
  const b1y = cy + baseSpread * Math.sin(perpAngle)
  const b2x = cx - baseSpread * Math.cos(perpAngle)
  const b2y = cy - baseSpread * Math.sin(perpAngle)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="-6 -2 112 71">
          {/* Flat (butt) arc ends so the start / end align exactly with the
              needle tip — matches the solid gauge. */}
          <path d={trackPath} fill="none" stroke={hexToRgba(d.hex, 0.12)}
            strokeWidth={sw} strokeLinecap="butt" />
          {ticks}
          <polygon
            points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
            fill="#2D3436" />
          <circle cx={cx} cy={cy} r={3.5} fill="#2D3436" />
          <circle cx={cx} cy={cy} r={1.5} fill="#fff" opacity={0.7} />
          {/* Start / end labels at the bottom under the arc ends — matches the solid gauge */}
          <text x={cx - r} y={cy + 12} textAnchor="middle"
            className="dial-svg-label dial-gauge-label">{abbreviateNum(d.min)}</text>
          <text x={cx + r} y={cy + 12} textAnchor="middle"
            className="dial-svg-label dial-gauge-label">{abbreviateNum(d.max)}</text>
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 3. Full Dial — 270° arc with dot indicator ── */
function PreviewFullDial({ options = {} }) {
  const d = useDialData(options, { title: 'Motor Speed' })
  const cx = 50, cy = 50, r = 44, sw = 8
  const startDeg = 135, sweepDeg = 270
  const endDeg = startDeg + sweepDeg
  const valDeg = startDeg + (sweepDeg * d.pct / 100)
  const arcPath = svgArc(cx, cy, r, startDeg, endDeg)
  const totalLen = (sweepDeg / 360) * 2 * Math.PI * r
  const fillLen = totalLen * (d.pct / 100)
  const dotStyle = {
    transformOrigin: `${cx}px ${cy}px`,
    transform: `rotate(${valDeg}deg)`,
    transition: 'transform 0.6s ease',
  }
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg dial-svg-full" viewBox="-2 -2 104 104">
          <path d={arcPath} fill="none" stroke={hexToRgba(d.hex, 0.15)}
            strokeWidth={sw} strokeLinecap="round" />
          <path d={arcPath} fill="none" stroke={d.hex}
            strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={`${fillLen} ${totalLen}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          <circle cx={cx + r} cy={cy} r={5} fill={d.hex} style={dotStyle} />
          <circle cx={cx + r} cy={cy} r={2} fill="#fff" style={dotStyle} />
          {(() => {
            const mp = pointOnArc(cx, cy, r + sw / 2 + 2, startDeg)
            const xp = pointOnArc(cx, cy, r + sw / 2 + 2, endDeg)
            return (<>
              <text x={mp.x - 2} y={mp.y + 8} textAnchor="start" className="dial-svg-label dial-svg-label-lg">{abbreviateNum(d.min)}</text>
              <text x={xp.x + 2} y={xp.y + 8} textAnchor="end" className="dial-svg-label dial-svg-label-lg">{abbreviateNum(d.max)}</text>
            </>)
          })()}
        </svg>
        <div className="dial-center">
          <span className="dial-value">{d.display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 4. Progress Dial — 270° with color zones + needle ── */
function PreviewProgressDial({ options = {} }) {
  const d = useDialData(options, { title: 'Engine Power' })
  // Ease the reading so the needle glides along the arc instead of jumping.
  const animValue = useAnimatedNumber(d.value, { duration: 700 })
  const isLive = typeof d.live === 'number'
  const pct = dialPercent(animValue, d.min, d.max)
  const display = isLive
    ? abbreviateNum(d.isFloat ? parseFloat(animValue.toFixed(1)) : Math.round(animValue))
    : d.display
  const cx = 50, cy = 50, r = 38, sw = 8
  const startDeg = 135, sweepDeg = 270
  const toRad = (deg) => (deg * Math.PI) / 180
  const zones = [
    { from: 0,  to: 60, color: d.hex },
    { from: 60, to: 80, color: '#F0A500' },
    { from: 80, to: 100, color: '#E74C3C' },
  ]
  const zoneArcs = zones.map((z, i) => {
    const a1 = startDeg + sweepDeg * (z.from / 100)
    const a2 = startDeg + sweepDeg * (z.to / 100)
    // Flat (butt) caps on every zone so the arc's start matches its flat end.
    return <path key={i} d={svgArc(cx, cy, r, a1, a2)} fill="none"
      stroke={z.color} strokeWidth={sw} strokeLinecap="butt" />
  })
  const unfilled = startDeg + sweepDeg * (Math.max(zones[zones.length - 1].to, 100) / 100)
  const needleAngle = startDeg + (sweepDeg * pct / 100)
  const needleRad = toRad(needleAngle)
  const needleLen = r - 6
  const tipX = cx + needleLen * Math.cos(needleRad)
  const tipY = cy + needleLen * Math.sin(needleRad)
  const baseSpread = 2.5
  const perpAngle = needleRad + Math.PI / 2
  const b1x = cx + baseSpread * Math.cos(perpAngle)
  const b1y = cy + baseSpread * Math.sin(perpAngle)
  const b2x = cx - baseSpread * Math.cos(perpAngle)
  const b2y = cy - baseSpread * Math.sin(perpAngle)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="0 0 100 100">
          <path d={svgArc(cx, cy, r, startDeg, startDeg + sweepDeg)} fill="none"
            stroke={hexToRgba(d.hex, 0.08)} strokeWidth={sw} strokeLinecap="butt" />
          {zoneArcs}
          <polygon
            points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
            fill="#2D3436" />
          <circle cx={cx} cy={cy} r={4} fill="#2D3436" />
          <circle cx={cx} cy={cy} r={1.8} fill="#fff" opacity={0.7} />
          {(() => {
            const mp = pointOnArc(cx, cy, r + sw / 2 + 1, startDeg)
            const xp = pointOnArc(cx, cy, r + sw / 2 + 1, startDeg + sweepDeg)
            return (<>
              <text x={mp.x - 2} y={mp.y + 7} textAnchor="start" className="dial-svg-label">{abbreviateNum(d.min)}</text>
              <text x={xp.x + 2} y={xp.y + 7} textAnchor="end" className="dial-svg-label">{abbreviateNum(d.max)}</text>
            </>)
          })()}
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 5. Threshold Dial — 180° arc, color zones fill up to the value ── */
function PreviewThresholdDial({ options = {} }) {
  const d = useDialData(options, { title: 'Engine Power' })
  // Ease the reading so the coloured arc grows / shrinks gradually.
  const animValue = useAnimatedNumber(d.value, { duration: 700 })
  const isLive = typeof d.live === 'number'
  const display = isLive
    ? abbreviateNum(d.isFloat ? parseFloat(animValue.toFixed(1)) : Math.round(animValue))
    : d.display
  const cx = 50, cy = 52, r = 38, sw = 12
  const startDeg = 180, sweepDeg = 180
  const endDeg = startDeg + sweepDeg
  const valPct = dialPercent(animValue, d.min, d.max)
  const zones = [
    { from: 0,  to: 50, color: '#27AE60' },
    { from: 50, to: 75, color: '#F39C12' },
    { from: 75, to: 100, color: '#E74C3C' },
  ]
  const arcPath = svgArc(cx, cy, r, startDeg, endDeg)
  const totalLen = (sweepDeg / 360) * 2 * Math.PI * r
  const zoneArcs = zones.map((z, i) => {
    const zoneStart = totalLen * (z.from / 100)
    const clampedTo = Math.min(z.to, valPct)
    const zoneFill = valPct <= z.from ? 0 : totalLen * ((clampedTo - z.from) / 100)
    return <path key={i} d={arcPath} fill="none"
      stroke={z.color} strokeWidth={sw}
      strokeLinecap={i === 0 && zoneFill > 0 ? 'round' : 'butt'}
      strokeDasharray={`0 ${zoneStart} ${Math.max(0, zoneFill)} ${totalLen}`} />
  })
  const rotateDeg = startDeg + (sweepDeg * valPct / 100)
  const tipColor = valPct >= 75 ? '#E74C3C' : valPct >= 50 ? '#F39C12' : '#27AE60'
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="-6 -2 112 76">
          <path d={arcPath} fill="none" stroke="rgba(0,0,0,0.08)"
            strokeWidth={sw} strokeLinecap="round" />
          {zoneArcs}
          <circle cx={cx + r} cy={cy} r={sw / 2} fill={tipColor}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              transform: `rotate(${rotateDeg}deg)`,
              transition: 'fill 0.3s ease',
            }} />
          {/* 0 / max labels sit clear below the arc baseline (the 12px round
              caps extend ~sw/2 below cy, so the labels start under that). */}
          <text x={cx - r} y={cy + 18} textAnchor="middle"
            className="dial-svg-label dial-gauge-label">{abbreviateNum(d.min)}</text>
          <text x={cx + r} y={cy + 18} textAnchor="middle"
            className="dial-svg-label dial-gauge-label">{abbreviateNum(d.max)}</text>
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 6. Full Circle Dial — 360° ring with value + "of X" ── */
function PreviewFullCircleDial({ options = {} }) {
  const d = useDialData(options, { title: 'Mileage Summary' })
  const r = 38, sw = 8
  const circ = 2 * Math.PI * r
  const offset = circ - (circ * d.pct / 100)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke={hexToRgba(d.hex, 0.15)}
            strokeWidth={sw} />
          <circle cx="50" cy="50" r={r} fill="none" stroke={d.hex}
            strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
        <div className="dial-center">
          <span className="dial-value">{d.display}</span>
          <span className="dial-of">of {abbreviateNum(d.max)}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── DialConfigure — config form for dial/gauge widgets ── */
function DialConfigure({ variant, devices, initial, onBack, onSubmit, themeDefaults }) {
  const def = DIAL_VARIANT_DEFS[variant] || DIAL_VARIANT_DEFS.solid_gauge
  const isEditing = !!initial
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const themeCardDefault = themeDefaults?.cardColor || 'peach'
  const themeIconDefault = themeDefaults?.iconColor || 'orange'

  const [widgetName, setWidgetName]   = useState(initial?.widget_name || '')
  const [title, setTitle]             = useState(initCfg.title || '')
  const [description, setDescription] = useState(initCfg.description || '')
  const [unit, setUnit]               = useState(initStat.unit || '')
  const [icon, setIcon]               = useState(initStat.icon || '')
  const [min, setMin]                 = useState(initStat.min != null ? String(initStat.min) : '0')
  const [max, setMax]                 = useState(initStat.max != null ? String(initStat.max) : '100')
  const [cardColor, setCardColor]     = useState(initStat.card_color || themeCardDefault)
  const [iconColor, setIconColor]     = useState(initStat.icon_color || themeIconDefault)
  const [bindings, setBindings]       = useState(() =>
    def.fields.map((_, i) => {
      const ex = initBindings[i]
      return ex
        ? { device_id: ex.device_id != null ? String(ex.device_id) : '', payload_path: ex.payload_path || '', label: ex.label || '' }
        : { device_id: '', payload_path: '', label: '' }
    })
  )
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)

  function setBinding(i, k, v) {
    setBindings((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)))
    setErrors((e) => { const nk = `bindings.${i}.${k}`; if (!e[nk]) return e; const next = { ...e }; delete next[nk]; return next })
  }

  const previewOptions = {
    title: title || def.sampleTitle,
    description: description || '',
    color: cardColor, iconColor, icon, unit,
    min: Number(min), max: Number(max),
    bindings,
  }

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!widgetName.trim()) fes.widget_name = 'Widget name is required.'
    bindings.forEach((b, i) => {
      if (!b.device_id)           fes[`bindings.${i}.device_id`]    = 'Pick a device.'
      if (!b.payload_path.trim()) fes[`bindings.${i}.payload_path`] = 'Required.'
    })
    setErrors(fes)
    if (Object.keys(fes).length > 0) return
    const config = {
      title: title || '', description: description || '', variant,
      bindings: bindings.map((b, i) => ({
        device_id: Number(b.device_id),
        payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''),
        label: b.label || def.fields[i].label,
      })),
      static: {
        min: Number(min), max: Number(max),
        ...(unit ? { unit } : {}),
        ...(def.hasIcon && icon ? { icon } : {}),
        card_color: cardColor,
        icon_color: iconColor,
      },
      ui: {},
    }
    onSubmit?.({ widget_name: widgetName, widget_type: 'dial', config }, setSaving, setErrors, setBanner)
  }

  return (
    <div className="card-config">
      <div className="card-config-preview-col">
        <div className="card-config-example-label">{isEditing ? 'Editing' : 'Example'}</div>
        <div className="card-config-preview-frame">
          <DialPreview variant={variant} options={previewOptions} />
        </div>
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
              <input type="text" value={widgetName} disabled={saving} autoFocus
                onChange={(e) => { setWidgetName(e.target.value); if (errors.widget_name) setErrors((x) => ({ ...x, widget_name: undefined })) }}
                placeholder="temp_gauge" />
            </DField>
            <DField label="Title (shown on the card)">
              <input type="text" value={title} disabled={saving}
                onChange={(e) => setTitle(e.target.value)} placeholder={def.sampleTitle} />
            </DField>
            <DField label="Description (subtitle)" full>
              <input type="text" value={description} disabled={saving}
                onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Current reading" />
            </DField>
            {def.hasIcon && (
              <DField label="Icon" full>
                <IconPickerField value={icon} disabled={saving} onChange={setIcon} />
              </DField>
            )}
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field">
            <span className="form-label">Card color</span>
            <CardColorPicker value={cardColor} onChange={setCardColor} disabled={saving} usedColors={themeDefaults?.usedColors} />
          </div>
          <div className="form-field">
            <span className="form-label">Gauge color</span>
            <IconColorPicker value={iconColor} onChange={setIconColor} disabled={saving} usedColors={themeDefaults?.usedIconColors} />
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Data binding</div>
          {def.fields.map((f, i) => (
            <BindingFields key={i} field={f} binding={bindings[i]}
              devices={devices} disabled={saving}
              errors={{ device_id: errors[`bindings.${i}.device_id`], payload_path: errors[`bindings.${i}.payload_path`] }}
              onChange={(k, v) => setBinding(i, k, v)} />
          ))}
          <div className="ctrl-minmax-group">
            <div className="form-grid-2">
              <DField label="Min">
                <input type="text" inputMode="decimal" value={min} disabled={saving}
                  onChange={(e) => setMin(e.target.value)} />
              </DField>
              <DField label="Max">
                <input type="text" inputMode="decimal" value={max} disabled={saving}
                  onChange={(e) => setMax(e.target.value)} />
              </DField>
              {def.hasUnit && (
                <DField label="Unit" full>
                  <input type="text" value={unit} disabled={saving}
                    onChange={(e) => setUnit(e.target.value)} placeholder="°C, %, RPM…" />
                </DField>
              )}
            </div>
          </div>
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

/* =====================================================================
   CUSTOM FILL COMPONENTS
   ===================================================================== */
/* =====================================================================
   CHART COMPONENTS
   ===================================================================== */
function ChartVariantGallery({ onPick }) {
  return (
    <div className="card-gallery">
      {CHART_VARIANTS.map((v) => (
        <button key={v.id} type="button" className="card-variant"
          onClick={() => onPick?.(v.id)} aria-label={`Use ${v.title}`}>
          <div className="card-variant-title">{v.title}</div>
          <div className="card-variant-preview"><ChartPreview variant={v.id} /></div>
        </button>
      ))}
    </div>
  )
}

function ChartPreview({ variant, options = {} }) {
  switch (variant) {
    case 'bar_vertical':   return <PreviewBarVertical options={options} />
    case 'bar_horizontal': return <PreviewBarHorizontal options={options} />
    case 'donut_chart':    return <PreviewDonutChart options={options} />
    default: return null
  }
}

function useChartData(options, defaults) {
  const title = options.title || defaults.title
  const style = cardStyleFor(options.color || 'peach')
  const unit  = options.unit ?? ''
  const bindings = options.bindings || []
  const vals = bindings.map((b, i) => {
    const v = resolveBindingValue(b, options.devicesById)
    return {
      label: b?.label || `Item ${i + 1}`,
      value: typeof v === 'number' ? v : (defaults.samples?.[i] ?? (i + 1) * 25),
      live: typeof v === 'number',
      color: CHART_BAR_COLORS[i % CHART_BAR_COLORS.length],
    }
  })
  if (vals.length === 0) {
    const samples = defaults.samples || [75, 50, 90, 35]
    const labels  = defaults.labels  || ['Jan', 'Feb', 'Mar', 'Apr']
    samples.forEach((s, i) => vals.push({ label: labels[i], value: s, live: false, color: CHART_BAR_COLORS[i] }))
  }
  const maxVal = Math.max(...vals.map((v) => v.value), 1)
  return { title, style, unit, vals, maxVal, isLive: !!options.devicesById }
}

/* ── Vertical Bar Chart ── */
function PreviewBarVertical({ options = {} }) {
  const d = useChartData(options, { title: 'Monthly Sales', samples: [75, 50, 90, 35], labels: ['Jan', 'Feb', 'Mar', 'Apr'] })
  const barCount = d.vals.length
  const chartL = 14, chartR = 4, chartT = 2, chartB = 14
  const chartW = 100 - chartL - chartR, chartH = 70 - chartT - chartB
  const barW = Math.min(14, (chartW / barCount) * 0.6)
  const gap = (chartW - barW * barCount) / (barCount + 1)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="chart-svg" viewBox="0 0 100 70">
          <line x1={chartL} y1={chartT} x2={chartL} y2={chartT + chartH} stroke="currentColor" opacity={0.12} strokeWidth="0.5" />
          <line x1={chartL} y1={chartT + chartH} x2={chartL + chartW} y2={chartT + chartH} stroke="currentColor" opacity={0.12} strokeWidth="0.5" />
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = chartT + chartH * (1 - f)
            return <line key={f} x1={chartL} y1={y} x2={chartL + chartW} y2={y} stroke="currentColor" opacity={0.06} strokeWidth="0.4" />
          })}
          {d.vals.map((v, i) => {
            const barH = (v.value / d.maxVal) * chartH
            const x = chartL + gap + i * (barW + gap)
            const y = chartT + chartH - barH
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={barH} rx={barW / 4} fill={v.color} opacity={0.8}
                  style={{ transition: 'y 0.5s ease, height 0.5s ease' }} />
                <text x={x + barW / 2} y={chartT + chartH + 7} textAnchor="middle"
                  className="chart-label">{v.label}</text>
                <text x={x + barW / 2} y={y - 2} textAnchor="middle"
                  className="chart-val">{abbreviateNum(v.value)}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </CvCard>
  )
}

/* ── Horizontal Bar Chart ── */
function PreviewBarHorizontal({ options = {} }) {
  const d = useChartData(options, { title: 'Resource Usage', samples: [80, 55, 70, 40], labels: ['CPU', 'RAM', 'Disk', 'Net'] })
  const barCount = d.vals.length
  const chartL = 20, chartR = 6, chartT = 2, chartB = 2
  const chartW = 100 - chartL - chartR, chartH = 70 - chartT - chartB
  const barH = Math.min(10, (chartH / barCount) * 0.6)
  const gap = (chartH - barH * barCount) / (barCount + 1)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="chart-svg" viewBox="0 0 100 70">
          {d.vals.map((v, i) => {
            const barW = (v.value / d.maxVal) * chartW
            const y = chartT + gap + i * (barH + gap)
            return (
              <g key={i}>
                <rect x={chartL} y={y} width={chartW} height={barH} rx={barH / 4}
                  fill="currentColor" opacity={0.05} />
                <rect x={chartL} y={y} width={barW} height={barH} rx={barH / 4}
                  fill={v.color} opacity={0.8}
                  style={{ transition: 'width 0.5s ease' }} />
                <text x={chartL - 2} y={y + barH / 2 + 1.5} textAnchor="end"
                  className="chart-label">{v.label}</text>
                <text x={chartL + barW + 2} y={y + barH / 2 + 1.5} textAnchor="start"
                  className="chart-val">{abbreviateNum(v.value)}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </CvCard>
  )
}

/* ── Donut Chart ── */
function PreviewDonutChart({ options = {} }) {
  const d = useChartData(options, { title: 'Distribution', samples: [40, 30, 20, 10], labels: ['A', 'B', 'C', 'D'] })
  const cx = 50, cy = 35, r = 26, sw = 10
  const total = d.vals.reduce((s, v) => s + Math.max(0, v.value), 0) || 1
  const circ = 2 * Math.PI * r
  let cumOffset = 0
  const segments = d.vals.map((v, i) => {
    const pct = Math.max(0, v.value) / total
    const len = circ * pct
    const gap = d.vals.length > 1 ? 2 : 0
    const seg = { len: Math.max(0, len - gap), offset: circ - cumOffset + circ * 0.25, color: v.color, label: v.label, pct }
    cumOffset += len
    return seg
  })
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="chart-svg" viewBox="0 0 100 70">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" opacity={0.06} strokeWidth={sw} />
          {segments.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={sw} strokeLinecap="butt"
              strokeDasharray={`${s.len} ${circ}`}
              strokeDashoffset={s.offset}
              style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }} />
          ))}
          <text x={cx} y={cy - 1} textAnchor="middle" className="chart-center-val">
            {abbreviateNum(total)}
          </text>
          <text x={cx} y={cy + 6} textAnchor="middle" className="chart-center-label">
            {d.unit || 'total'}
          </text>
        </svg>
        <div className="chart-legend">
          {d.vals.map((v, i) => (
            <span key={i} className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: v.color }} />
              <span className="chart-legend-text">{v.label}</span>
            </span>
          ))}
        </div>
      </div>
    </CvCard>
  )
}

/* ── ChartConfigure ── */
function ChartConfigure({ variant, devices, initial, onBack, onSubmit, themeDefaults }) {
  const def = CHART_VARIANT_DEFS[variant] || CHART_VARIANT_DEFS.bar_vertical
  const isEditing = !!initial
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const themeCardDefault = themeDefaults?.cardColor || 'peach'
  const themeIconDefault = themeDefaults?.iconColor || 'orange'
  const [widgetName, setWidgetName]   = useState(initial?.widget_name || '')
  const [title, setTitle]             = useState(initCfg.title || '')
  const [description, setDescription] = useState(initCfg.description || '')
  const [unit, setUnit]               = useState(initStat.unit || '')
  const [cardColor, setCardColor]     = useState(initStat.card_color || themeCardDefault)
  const [iconColor, setIconColor]     = useState(initStat.icon_color || themeIconDefault)
  const [bindings, setBindings]       = useState(() =>
    def.fields.map((_, i) => {
      const ex = initBindings[i]
      return ex ? { device_id: ex.device_id != null ? String(ex.device_id) : '', payload_path: ex.payload_path || '', label: ex.label || '' }
               : { device_id: '', payload_path: '', label: '' }
    })
  )
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)
  function setBinding(i, k, v) {
    setBindings((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)))
    setErrors((e) => { const nk = `bindings.${i}.${k}`; if (!e[nk]) return e; const next = { ...e }; delete next[nk]; return next })
  }
  const previewOptions = { title: title || def.sampleTitle, description, color: cardColor, iconColor, unit, bindings }
  function submit(e) {
    e.preventDefault(); setBanner(null)
    const fes = {}
    if (!widgetName.trim()) fes.widget_name = 'Widget name is required.'
    bindings.forEach((b, i) => {
      if (!b.device_id) fes[`bindings.${i}.device_id`] = 'Pick a device.'
      if (!b.payload_path.trim()) fes[`bindings.${i}.payload_path`] = 'Required.'
    })
    setErrors(fes); if (Object.keys(fes).length > 0) return
    const config = {
      title: title || '', description: description || '', variant,
      bindings: bindings.map((b, i) => ({ device_id: Number(b.device_id), payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''), label: b.label || def.fields[i].label })),
      static: { ...(unit ? { unit } : {}), card_color: cardColor, icon_color: iconColor },
      ui: {},
    }
    onSubmit?.({ widget_name: widgetName, widget_type: 'chart', config }, setSaving, setErrors, setBanner)
  }
  return (
    <div className="card-config">
      <div className="card-config-preview-col">
        <div className="card-config-example-label">{isEditing ? 'Editing' : 'Example'}</div>
        <div className="card-config-preview-frame"><ChartPreview variant={variant} options={previewOptions} /></div>
        {!isEditing && onBack && (
          <button type="button" className="card-config-change" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
              <input type="text" value={widgetName} disabled={saving} autoFocus onChange={(e) => { setWidgetName(e.target.value); if (errors.widget_name) setErrors((x) => ({ ...x, widget_name: undefined })) }} placeholder="sales_chart" />
            </DField>
            <DField label="Title"><input type="text" value={title} disabled={saving} onChange={(e) => setTitle(e.target.value)} placeholder={def.sampleTitle} /></DField>
            <DField label="Description (subtitle)" full><input type="text" value={description} disabled={saving} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Q4 summary" /></DField>
            {def.hasUnit && <DField label="Unit"><input type="text" value={unit} disabled={saving} onChange={(e) => setUnit(e.target.value)} placeholder="units, %, $…" /></DField>}
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field"><span className="form-label">Card color</span>
            <CardColorPicker value={cardColor} onChange={setCardColor} disabled={saving} usedColors={themeDefaults?.usedColors} />
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">{def.fields.length} data bindings</div>
          {def.fields.map((f, i) => (
            <BindingFields key={i} field={f} binding={bindings[i]} devices={devices} disabled={saving}
              errors={{ device_id: errors[`bindings.${i}.device_id`], payload_path: errors[`bindings.${i}.payload_path`] }}
              onChange={(k, v) => setBinding(i, k, v)} />
          ))}
        </div>
        <div className="modal-foot">
          {!isEditing && onBack && <button type="button" className="btn-secondary" onClick={onBack} disabled={saving}>Back</button>}
          <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : (isEditing ? 'Save Changes' : 'Add Widget')}</button>
        </div>
      </form>
    </div>
  )
}

function FillVariantGallery({ onPick }) {
  return (
    <div className="card-gallery card-gallery-fill">
      {FILL_VARIANTS.map((v) => (
        <button key={v.id} type="button" className="card-variant"
          onClick={() => onPick?.(v.id)} aria-label={`Use ${v.title}`}>
          <div className="card-variant-title">{v.title}</div>
          <div className="card-variant-preview">
            <FillPreview variant={v.id} />
          </div>
        </button>
      ))}
    </div>
  )
}

function FillPreview({ variant, options = {} }) {
  switch (variant) {
    case 'battery_fill':     return <PreviewBatteryFill options={options} />
    case 'tank_rect_fill':   return <PreviewTankRectFill options={options} />
    case 'tank_sphere_fill': return <PreviewTankSphereFill options={options} />
    default: return null
  }
}

function useFillData(options, defaults) {
  const title   = options.title || defaults.title
  const style   = cardStyleFor(options.color || 'peach')
  const hex     = getIconColor(options.iconColor || 'orange').hex
  const min     = Number(options.min ?? 0)
  const max     = Number(options.max ?? 100)
  const unit    = options.unit ?? ''
  const b       = options.bindings?.[0]
  const live    = resolveBindingValue(b, options.devicesById)
  const declType = resolveBindingDeclaredType(b, options.devicesById)
  const value   = typeof live === 'number' ? live : (defaults.sampleVal ?? (min + max) / 2)
  const pct     = dialPercent(value, min, max)
  const isFloat = declType === 'float'
  const display = typeof live === 'number'
    ? (isFloat ? abbreviateNum(parseFloat(live.toFixed(1))) : abbreviateNum(Number.isInteger(live) ? live : parseFloat(live.toFixed(1))))
    : (options.devicesById ? '-' : abbreviateNum(defaults.sampleVal ?? Math.round((min + max) / 2)))
  return { title, style, hex, min, max, unit, value, pct, display }
}

/* ── 1. Battery ── */
function PreviewBatteryFill({ options = {} }) {
  const d = useFillData(options, { title: 'Battery', sampleVal: 80 })
  const fillW = 58 * (d.pct / 100)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="fill-svg" viewBox="0 0 92 48">
          <rect x="4" y="6" width="72" height="36" rx="7" ry="7" fill="none"
            stroke={hexToRgba(d.hex, 0.22)} strokeWidth="2.5" />
          <rect x="76" y="16" width="7" height="16" rx="3" ry="3"
            fill={hexToRgba(d.hex, 0.22)} />
          <rect x="9" y="11" width={Math.max(0, fillW)} height="26" rx="4" ry="4"
            fill={d.hex} opacity={0.75} style={{ transition: 'width 0.6s ease' }} />
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{d.display}</span>
          <span className="dial-unit">{d.unit || '%'}</span>
        </div>
      </div>
    </CvCard>
  )
}

/* ── 2. Level Tank 1 (tall beaker with spout) ── */
function PreviewTankRectFill({ options = {} }) {
  const d = useFillData(options, { title: 'Level Tank 1', sampleVal: 40 })
  const [uid] = useState(() => Math.random().toString(36).slice(2, 8))
  const cx = 50, topY = 5, bw = 38, bh = 62, r = 4, sw = 2
  const innerT = topY + sw, innerH = bh - sw * 2
  const fillH = innerH * (d.pct / 100)
  const fillTop = innerT + innerH - fillH
  const spoutW = 6
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="fill-svg" viewBox="0 0 100 80">
          <defs>
            <clipPath id={`tc${uid}`}>
              <rect x={cx - bw / 2 + sw} y={innerT} width={bw - sw * 2} height={innerH} rx={r - 1} />
            </clipPath>
          </defs>
          <rect x={cx - bw / 2} y={topY} width={bw} height={bh} rx={r} ry={r}
            fill="none" stroke={hexToRgba(d.hex, 0.22)} strokeWidth={sw} />
          <path d={`M ${cx + bw / 2} ${topY + 2} L ${cx + bw / 2 + spoutW} ${topY - 2} L ${cx + bw / 2 + spoutW} ${topY + 6} L ${cx + bw / 2} ${topY + 8}`}
            fill="none" stroke={hexToRgba(d.hex, 0.22)} strokeWidth={sw} strokeLinejoin="round" />
          {[0.25, 0.5, 0.75].map((f) => {
            const ly = innerT + innerH * (1 - f)
            return <line key={f} x1={cx - bw / 2 + sw + 2} y1={ly} x2={cx - bw / 2 + sw + 7} y2={ly}
              stroke={hexToRgba(d.hex, 0.18)} strokeWidth="1" />
          })}
          <rect x={cx - bw / 2 + sw} y={fillTop} width={bw - sw * 2} height={fillH + r}
            fill={d.hex} opacity={0.45} clipPath={`url(#tc${uid})`}
            style={{ transition: 'y 0.6s ease, height 0.6s ease' }} />
          {d.pct > 0 && d.pct < 100 && (
            <g clipPath={`url(#tc${uid})`}>
              <line x1={cx - bw / 2 + sw} y1={fillTop} x2={cx + bw / 2 - sw} y2={fillTop}
                stroke={d.hex} strokeWidth="1.2" opacity={0.55}
                style={{ transition: 'y1 0.6s ease, y2 0.6s ease' }} />
              <ellipse cx={cx} cy={fillTop} rx={(bw - sw * 2) / 2 - 2} ry="1.5"
                fill="#fff" opacity={0.12}
                style={{ transition: 'cy 0.6s ease' }} />
            </g>
          )}
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{d.display}</span>
          <span className="dial-unit">{d.unit || 'ltr'}</span>
        </div>
      </div>
    </CvCard>
  )
}

/* ── 3. Level Tank 2 (sphere) ── */
function PreviewTankSphereFill({ options = {} }) {
  const d = useFillData(options, { title: 'Level Tank 2', sampleVal: 60 })
  const [uid] = useState(() => Math.random().toString(36).slice(2, 8))
  const cx = 50, cy = 42, r = 28
  const fillY = cy + r - (2 * r * d.pct / 100)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="fill-svg" viewBox="0 0 100 82">
          <defs>
            <clipPath id={`sc${uid}`}>
              <circle cx={cx} cy={cy} r={r - 1.5} />
            </clipPath>
          </defs>
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={hexToRgba(d.hex, 0.2)} strokeWidth="2.5" />
          <rect x={cx - r} y={fillY} width={r * 2} height={r * 2}
            fill={d.hex} opacity={0.45} clipPath={`url(#sc${uid})`}
            style={{ transition: 'y 0.6s ease' }} />
          <ellipse cx={cx} cy={fillY} rx={r - 4} ry="2.5"
            fill={d.hex} opacity={0.2} clipPath={`url(#sc${uid})`}
            style={{ transition: 'cy 0.6s ease' }} />
          <ellipse cx={cx - 4} cy={cy - r + 7} rx="8" ry="3"
            fill="#fff" opacity={0.12} transform={`rotate(-10 ${cx - 4} ${cy - r + 7})`} />
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{d.display}</span>
          <span className="dial-unit">{d.unit || '%'}</span>
        </div>
      </div>
    </CvCard>
  )
}


/* ── FillConfigure — config form (identical structure to DialConfigure) ── */
function FillConfigure({ variant, devices, initial, onBack, onSubmit, themeDefaults }) {
  const def = FILL_VARIANT_DEFS[variant] || FILL_VARIANT_DEFS.battery_fill
  const isEditing = !!initial
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const themeCardDefault = themeDefaults?.cardColor || 'peach'
  const themeIconDefault = themeDefaults?.iconColor || 'orange'
  const [widgetName, setWidgetName]   = useState(initial?.widget_name || '')
  const [title, setTitle]             = useState(initCfg.title || '')
  const [description, setDescription] = useState(initCfg.description || '')
  const [unit, setUnit]               = useState(initStat.unit || '')
  const [min, setMin]                 = useState(initStat.min != null ? String(initStat.min) : '0')
  const [max, setMax]                 = useState(initStat.max != null ? String(initStat.max) : '100')
  const [cardColor, setCardColor]     = useState(initStat.card_color || themeCardDefault)
  const [iconColor, setIconColor]     = useState(initStat.icon_color || themeIconDefault)
  const [bindings, setBindings]       = useState(() =>
    def.fields.map((_, i) => {
      const ex = initBindings[i]
      return ex ? { device_id: ex.device_id != null ? String(ex.device_id) : '', payload_path: ex.payload_path || '', label: ex.label || '' }
               : { device_id: '', payload_path: '', label: '' }
    })
  )
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)
  function setBinding(i, k, v) {
    setBindings((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)))
    setErrors((e) => { const nk = `bindings.${i}.${k}`; if (!e[nk]) return e; const next = { ...e }; delete next[nk]; return next })
  }
  const previewOptions = { title: title || def.title, description, color: cardColor, iconColor, unit, min: Number(min), max: Number(max), bindings }
  function submit(e) {
    e.preventDefault(); setBanner(null)
    const fes = {}
    if (!widgetName.trim()) fes.widget_name = 'Widget name is required.'
    bindings.forEach((b, i) => {
      if (!b.device_id) fes[`bindings.${i}.device_id`] = 'Pick a device.'
      if (!b.payload_path.trim()) fes[`bindings.${i}.payload_path`] = 'Required.'
    })
    setErrors(fes); if (Object.keys(fes).length > 0) return
    const config = {
      title: title || '', description: description || '', variant,
      bindings: bindings.map((b, i) => ({ device_id: Number(b.device_id), payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''), label: b.label || def.fields[i].label })),
      static: { min: Number(min), max: Number(max), ...(unit ? { unit } : {}), card_color: cardColor, icon_color: iconColor },
      ui: {},
    }
    onSubmit?.({ widget_name: widgetName, widget_type: 'fill', config }, setSaving, setErrors, setBanner)
  }
  return (
    <div className="card-config">
      <div className="card-config-preview-col">
        <div className="card-config-example-label">{isEditing ? 'Editing' : 'Example'}</div>
        <div className="card-config-preview-frame"><FillPreview variant={variant} options={previewOptions} /></div>
        {!isEditing && onBack && (
          <button type="button" className="card-config-change" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
              <input type="text" value={widgetName} disabled={saving} autoFocus onChange={(e) => { setWidgetName(e.target.value); if (errors.widget_name) setErrors((x) => ({ ...x, widget_name: undefined })) }} placeholder="battery_level" />
            </DField>
            <DField label="Title"><input type="text" value={title} disabled={saving} onChange={(e) => setTitle(e.target.value)} placeholder={def.title} /></DField>
            <DField label="Description (subtitle)" full><input type="text" value={description} disabled={saving} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Main tank" /></DField>
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field"><span className="form-label">Card color</span>
            <CardColorPicker value={cardColor} onChange={setCardColor} disabled={saving} usedColors={themeDefaults?.usedColors} />
          </div>
          <div className="form-field"><span className="form-label">Fill color</span>
            <IconColorPicker value={iconColor} onChange={setIconColor} disabled={saving} usedColors={themeDefaults?.usedIconColors} />
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Data binding</div>
          {def.fields.map((f, i) => (<BindingFields key={i} field={f} binding={bindings[i]} devices={devices} disabled={saving} errors={{ device_id: errors[`bindings.${i}.device_id`], payload_path: errors[`bindings.${i}.payload_path`] }} onChange={(k, v) => setBinding(i, k, v)} />))}
          <div className="ctrl-minmax-group"><div className="form-grid-2">
            <DField label="Min"><input type="text" inputMode="decimal" value={min} disabled={saving} onChange={(e) => setMin(e.target.value)} /></DField>
            <DField label="Max"><input type="text" inputMode="decimal" value={max} disabled={saving} onChange={(e) => setMax(e.target.value)} /></DField>
            {def.hasUnit && <DField label="Unit" full><input type="text" value={unit} disabled={saving} onChange={(e) => setUnit(e.target.value)} placeholder="%, ltr, °C…" /></DField>}
          </div></div>
        </div>
        <div className="modal-foot">
          {!isEditing && onBack && <button type="button" className="btn-secondary" onClick={onBack} disabled={saving}>Back</button>}
          <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : (isEditing ? 'Save Changes' : 'Add Widget')}</button>
        </div>
      </form>
    </div>
  )
}

/* =====================================================================
   LOG WIDGETS — read-only. Gallery + previews + configure.
   ===================================================================== */
function LogVariantGallery({ onPick }) {
  return (
    <div className="card-gallery">
      {LOG_VARIANTS.map((v) => (
        <button key={v.id} type="button" className="card-variant"
          onClick={() => onPick?.(v.id)} aria-label={`Use ${v.title}`}>
          <div className="card-variant-title">{v.title}</div>
          <div className="card-variant-preview">
            <LogPreview variant={v.id} />
          </div>
        </button>
      ))}
    </div>
  )
}

function LogPreview({ variant, options = {} }) {
  switch (variant) {
    case 'log_feed':     return <PreviewLogFeed     options={options} />
    case 'log_console':  return <PreviewLogConsole  options={options} />
    case 'log_timeline': return <PreviewLogTimeline options={options} />
    default: return null
  }
}

/* Resolve the bound log list (or fall back to sample rows for the
   gallery / unconfigured state). Honors a `limit` (max rows shown). */
function useLogData(options, defaults) {
  const title = options.title || defaults.title
  const style = cardStyleFor(options.color || 'slate')
  const hex   = getIconColor(options.iconColor || 'slate').hex
  const raw   = resolveBindingRawValue(options.bindings?.[0], options.devicesById)
  const normalized = normalizeLogEntries(raw)
  const entries = (normalized && normalized.length ? normalized : SAMPLE_LOGS)
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 50
  // Newest last in the source; show the most recent `limit`.
  const shown = entries.slice(-limit)
  const isSample = !normalized || normalized.length === 0
  return { title, style, hex, entries: shown, isSample }
}

function PreviewLogFeed({ options = {} }) {
  const d = useLogData(options, { title: 'Activity Log' })
  return (
    <div className="cv-card log-card log-card-feed" style={d.style}>
      <div className="log-head">
        <span className="cv-title">{d.title}</span>
        <span className="log-count">{d.entries.length}{d.isSample ? ' · sample' : ''}</span>
      </div>
      <ul className="log-feed-list">
        {d.entries.map((e, i) => (
          <li key={i} className={'log-feed-row ' + logLevelClass(e.level)}>
            <span className="log-dot" aria-hidden="true" />
            {e.time && <span className="log-time">{e.time}</span>}
            <span className="log-msg">{e.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PreviewLogConsole({ options = {} }) {
  const d = useLogData(options, { title: 'System Console' })
  return (
    <div className="cv-card log-card log-card-console" style={d.style}>
      <div className="log-head log-head-console">
        <span className="log-console-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="cv-title">{d.title}</span>
      </div>
      <div className="log-console-body">
        {d.entries.map((e, i) => (
          <div key={i} className={'log-console-line ' + logLevelClass(e.level)}>
            {e.time && <span className="log-console-time">{e.time}</span>}
            {e.level && <span className="log-console-level">{(e.level || 'log').toUpperCase()}</span>}
            <span className="log-console-msg">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PreviewLogTimeline({ options = {} }) {
  const d = useLogData(options, { title: 'Events' })
  return (
    <div className="cv-card log-card log-card-timeline" style={d.style}>
      <div className="log-head">
        <span className="cv-title">{d.title}</span>
        <span className="log-count">{d.entries.length}{d.isSample ? ' · sample' : ''}</span>
      </div>
      <ul className="log-timeline-list">
        {d.entries.map((e, i) => (
          <li key={i} className={'log-timeline-row ' + logLevelClass(e.level)}>
            <span className="log-timeline-marker" aria-hidden="true"><span className="log-timeline-dot" /></span>
            <div className="log-timeline-content">
              <div className="log-timeline-msg">{e.message}</div>
              {e.time && <div className="log-timeline-time">{e.time}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LogConfigure({ variant, devices, initial, onBack, onSubmit, themeDefaults }) {
  const def = LOG_VARIANT_DEFS[variant] || LOG_VARIANT_DEFS.log_feed
  const isEditing = !!initial
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const themeCardDefault = themeDefaults?.cardColor || 'snow'
  const themeIconDefault = themeDefaults?.iconColor || 'slate'
  const [widgetName, setWidgetName]   = useState(initial?.widget_name || '')
  const [title, setTitle]             = useState(initCfg.title || '')
  const [limit, setLimit]             = useState(initStat.limit != null ? String(initStat.limit) : '50')
  const [cardColor, setCardColor]     = useState(initStat.card_color || themeCardDefault)
  const [iconColor, setIconColor]     = useState(initStat.icon_color || themeIconDefault)
  const [binding, setBindingState]    = useState(() => {
    const ex = initBindings[0]
    return ex ? { device_id: ex.device_id != null ? String(ex.device_id) : '', payload_path: ex.payload_path || '', label: ex.label || '' }
              : { device_id: '', payload_path: '', label: '' }
  })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)
  function setBinding(k, v) {
    setBindingState((b) => ({ ...b, [k]: v }))
    setErrors((e) => { const nk = `bindings.0.${k}`; if (!e[nk]) return e; const next = { ...e }; delete next[nk]; return next })
  }
  const devicesById = useMemo(() => {
    const m = new Map(); for (const d of devices || []) m.set(Number(d.id), d); return m
  }, [devices])
  const previewOptions = { title: title || def.title, color: cardColor, iconColor, limit: Number(limit), bindings: [binding], devicesById }

  function submit(e) {
    e.preventDefault(); setBanner(null)
    const fes = {}
    if (!widgetName.trim()) fes.widget_name = 'Widget name is required.'
    if (!binding.device_id) fes['bindings.0.device_id'] = 'Pick a device.'
    if (!binding.payload_path.trim()) fes['bindings.0.payload_path'] = 'Required.'
    setErrors(fes); if (Object.keys(fes).length > 0) return
    const config = {
      title: title || '', variant,
      bindings: [{ device_id: Number(binding.device_id), payload_path: binding.payload_path.replace(/^\/+|\/+$/g, ''), label: binding.label || def.fields[0].label }],
      static: { limit: Math.max(1, Number(limit) || 50), card_color: cardColor, icon_color: iconColor },
      ui: {},
    }
    onSubmit?.({ widget_name: widgetName, widget_type: 'log', config }, setSaving, setErrors, setBanner)
  }
  return (
    <div className="card-config">
      <div className="card-config-preview-col">
        <div className="card-config-example-label">{isEditing ? 'Editing' : 'Example'}</div>
        <div className="card-config-preview-frame card-config-preview-frame-log"><LogPreview variant={variant} options={previewOptions} /></div>
        {!isEditing && onBack && (
          <button type="button" className="card-config-change" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
              <input type="text" value={widgetName} disabled={saving} autoFocus onChange={(e) => { setWidgetName(e.target.value); if (errors.widget_name) setErrors((x) => ({ ...x, widget_name: undefined })) }} placeholder="device_log" />
            </DField>
            <DField label="Title"><input type="text" value={title} disabled={saving} onChange={(e) => setTitle(e.target.value)} placeholder={def.title} /></DField>
            <DField label="Rows to show"><input type="text" inputMode="numeric" value={limit} disabled={saving} onChange={(e) => setLimit(e.target.value)} placeholder="50" /></DField>
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field"><span className="form-label">Card color</span>
            <CardColorPicker value={cardColor} onChange={setCardColor} disabled={saving} usedColors={themeDefaults?.usedColors} />
          </div>
          <div className="form-field"><span className="form-label">Accent color</span>
            <IconColorPicker value={iconColor} onChange={setIconColor} disabled={saving} usedColors={themeDefaults?.usedIconColors} />
          </div>
        </div>
        <div className="card-config-section">
          <div className="card-config-section-head">Log source</div>
          <p className="log-config-hint">Bind to a payload path that holds a <strong>list</strong> of log entries. Each entry can be a string or an object with <code>time</code>, <code>level</code>, and <code>message</code>.</p>
          <BindingFields field={def.fields[0]} binding={binding} devices={devices} disabled={saving} errors={{ device_id: errors['bindings.0.device_id'], payload_path: errors['bindings.0.payload_path'] }} onChange={(k, v) => setBinding(k, v)} />
        </div>
        <div className="modal-foot">
          {!isEditing && onBack && <button type="button" className="btn-secondary" onClick={onBack} disabled={saving}>Back</button>}
          <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : (isEditing ? 'Save Changes' : 'Add Widget')}</button>
        </div>
      </form>
    </div>
  )
}

function ControlPreview({ variant, options, onCommand }) {
  switch (variant) {
    case 'switch':        return <PreviewSwitchControl     options={options} onCommand={onCommand} />
    case 'dual_toggle':   return <PreviewDualToggleControl options={options} onCommand={onCommand} />
    case 'press_switch':  return <PreviewPressSwitchControl options={options} onCommand={onCommand} />
    case 'single_button': return <PreviewSingleButtonControl options={options} onCommand={onCommand} />
    case 'multi_button':  return <PreviewMultiButtonControl options={options} onCommand={onCommand} />
    case 'stepper':       return <PreviewStepperControl    options={options} onCommand={onCommand} />
    case 'slider':        return <PreviewSliderControl     options={options} onCommand={onCommand} />
    case 'text_input':    return <PreviewTextInputControl  options={options} onCommand={onCommand} />
    case 'number_input':  return <PreviewNumberInputControl options={options} onCommand={onCommand} />
    case 'list_input':    return <PreviewListInputControl   options={options} onCommand={onCommand} />
    case 'json_input':    return <PreviewJsonInputControl   options={options} onCommand={onCommand} />
    default: return null
  }
}

/* Tiny helper — renders an icon glyph in the control card's accent
   colour. Uses the control's configured iconColor (from ICON_COLORS
   palette) so it matches the card palette. */
function CtrlIcon({ iconId, fallbackName = 'bolt', iconColor }) {
  // 'none' is the explicit "no icon" sentinel — render nothing (not even the
  // fallback glyph) so a widget can opt out of an icon entirely.
  if (iconId === 'none') return null
  const hex = getIconColor(iconColor || 'orange').hex
  if (iconId) {
    return (
      <span className="ctrl-card-ic" style={{ background: hexToRgba(hex, 0.14) }}>
        <img src={`https://api.iconify.design/${iconId}.svg?color=${encodeURIComponent(hex)}`} alt="" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="ctrl-card-ic" style={{ background: hexToRgba(hex, 0.14) }}>
      <CvIcon name={fallbackName} color={hex} />
    </span>
  )
}

/* Build inline card style for a control (same as data cards). Also
   derives the --ctrl-btn colour from the card palette's text colour
   so buttons match the card surface. */
function ctrlCardStyle(colorId) {
  const base = cardStyleFor(colorId)
  const c = getCardColor(colorId)
  const textHex = c.text || '#3D2A18'
  const subHex  = c.sub  || '#896241'
  return {
    ...base,
    '--ctrl-btn-from':    textHex,
    '--ctrl-btn-to':      textHex,
    // Switch track off-state — muted tint of the card's text colour
    // so the track blends with the card surface instead of being a
    // flat generic gray.
    '--ctrl-switch-off-from': hexToRgba(subHex, 0.35),
    '--ctrl-switch-off-to':   hexToRgba(subHex, 0.25),
  }
}

/* Parse + dispatch a typed write. Shared by every control that PUTs
   a configured value. */
function dispatchWrite(onCommand, binding, type, rawValue, devicesById) {
  if (!onCommand || !binding?.device_id || !binding?.payload_path) return false
  let sendType = type
  if (devicesById && (type === 'int' || type === 'float')) {
    const fieldType = resolveBindingDeclaredType(binding, devicesById)
    if (fieldType === 'float' && type === 'int')  sendType = 'float'
    if (fieldType === 'int'   && type === 'float') sendType = 'int'
  }
  let value = rawValue
  if (sendType === 'int')     value = parseInt(rawValue, 10)
  else if (sendType === 'float') value = parseFloat(rawValue)
  else if (sendType === 'boolean') value = (rawValue === true || String(rawValue).toLowerCase() === 'true')
  else if (sendType === 'list' || sendType === 'dict') {
    // List / dict values are authored as JSON strings — parse them so we
    // send the actual array / object, matching the bound field's type.
    try { value = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue }
    catch { return false }
    if (sendType === 'list' && !Array.isArray(value)) return false
    if (sendType === 'dict' && (typeof value !== 'object' || value === null || Array.isArray(value))) return false
  }
  if ((sendType === 'int' || sendType === 'float') && !Number.isFinite(value)) return false
  return onCommand(binding.device_id, 'put', binding.payload_path, { type: sendType, value })
}

/* Shared chrome for control widgets — same .cv-card surface as the
   data cards so they read as one family. */
function ControlCard({ children, title, sub }) {
  return (
    <div className="cv-card ctrl-card">
      {title && <div className="cv-title">{title}</div>}
      <div className="ctrl-card-body">{children}</div>
      {sub && <div className="cv-sub ctrl-card-sub">{sub}</div>}
    </div>
  )
}

/* Read per-binding toggle config (on_value/off_value) with fallbacks. */
function getToggleConfig(binding) {
  return {
    onVal:   binding?.on_value  ?? 'true',
    onType:  binding?.on_type   || 'boolean',
    offVal:  binding?.off_value ?? 'false',
    offType: binding?.off_type  || 'boolean',
  }
}
function isToggleOn(live, onVal) {
  if (live == null) return false
  // List / dict states: compare structurally against the JSON on-value.
  if (typeof live === 'object') {
    try { return JSON.stringify(live) === JSON.stringify(JSON.parse(onVal)) }
    catch { return false }
  }
  // Numeric states: compare by value so "1.0" matches a live 1, "0.0"
  // matches 0, etc. (string comparison would wrongly fail 1 vs "1.0").
  if (typeof live === 'number' && onVal != null && String(onVal).trim() !== '') {
    const rn = Number(onVal)
    if (Number.isFinite(rn)) return live === rn
  }
  return String(live) === String(onVal)
}

function PreviewSwitchControl({ options = {}, onCommand }) {
  const b    = options.bindings?.[0]
  // Raw value so list/dict states resolve (resolveBindingValue returns null
  // for objects). Scalars behave identically.
  const live = resolveBindingRawValue(b, options.devicesById)
  const { onVal, onType, offVal, offType } = getToggleConfig(b)
  const isOn = isToggleOn(live, onVal)
  const isLive = !!onCommand
  function toggle() {
    if (!isLive || !b) return
    if (isOn) dispatchWrite(onCommand, b, offType, offVal, options.devicesById)
    else      dispatchWrite(onCommand, b, onType, onVal, options.devicesById)
  }
  return (
    <div className={'cv-card ctrl-card ctrl-card-toggle' + (isOn ? ' is-on' : '')} style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Bedroom Light'}</div>
          <div className="cv-sub">
            {options.description || (isLive
              ? isOn ? `ON · sends ${offVal}` : `OFF · sends ${onVal}`
              : 'Tap to toggle')}
          </div>
        </div>
      </div>
      <div className="ctrl-toggle-body">
        <button
          type="button"
          className={'ctrl-switch ctrl-switch-lg' + (isOn ? ' is-on' : '')}
          onClick={toggle}
          aria-pressed={isOn}
          disabled={!isLive}
        >
          <span className="ctrl-switch-knob" />
        </button>
        <div className={'ctrl-toggle-status' + (isOn ? ' is-on' : '')}>
          {isLive ? (isOn ? 'ON' : 'OFF') : '—'}
        </div>
      </div>
    </div>
  )
}

/* ── Dual Toggle — two independent boolean toggles in one card. Each
   has its own label + switch bound to a separate payload path. */
function PreviewDualToggleControl({ options = {}, onCommand }) {
  const bA = options.bindings?.[0]
  const bB = options.bindings?.[1]
  const liveA = resolveBindingValue(bA, options.devicesById)
  const liveB = resolveBindingValue(bB, options.devicesById)
  const cfgA = getToggleConfig(bA)
  const cfgB = getToggleConfig(bB)
  // State is derived purely from the live device value — the switch only
  // flips AFTER the device's value actually updates (the command round-trips
  // and the device echoes the new value back). No optimistic flip.
  const isOnA = isToggleOn(liveA, cfgA.onVal)
  const isOnB = isToggleOn(liveB, cfgB.onVal)
  const isLive = !!onCommand

  function toggleA() {
    if (!isLive || !bA?.device_id || !bA?.payload_path) return
    if (isOnA) dispatchWrite(onCommand, bA, cfgA.offType, cfgA.offVal, options.devicesById)
    else       dispatchWrite(onCommand, bA, cfgA.onType,  cfgA.onVal,  options.devicesById)
  }
  function toggleB() {
    if (!isLive || !bB?.device_id || !bB?.payload_path) return
    if (isOnB) dispatchWrite(onCommand, bB, cfgB.offType, cfgB.offVal, options.devicesById)
    else       dispatchWrite(onCommand, bB, cfgB.onType,  cfgB.onVal,  options.devicesById)
  }
  const labelA = options.bindings?.[0]?.label || 'Switch A'
  const labelB = options.bindings?.[1]?.label || 'Switch B'
  return (
    <div className="cv-card ctrl-card ctrl-card-dual" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Room Control'}</div>
          {options.description && <div className="cv-sub">{options.description}</div>}
        </div>
      </div>
      <div className="ctrl-dual-row">
        <div className="ctrl-dual-item">
          <div>
            <div className="ctrl-dual-label">{labelA}</div>
            <div className="ctrl-dual-sub">{(isOnA ? bA?.on_label : bA?.off_label) ?? ''}</div>
          </div>
          <button
            type="button"
            className={'ctrl-switch' + (isOnA ? ' is-on' : '')}
            onClick={toggleA}
            aria-pressed={isOnA}
            disabled={!isLive}
          >
            <span className="ctrl-switch-knob" />
          </button>
        </div>
        <div className="ctrl-dual-item">
          <div>
            <div className="ctrl-dual-label">{labelB}</div>
            <div className="ctrl-dual-sub">{(isOnB ? bB?.on_label : bB?.off_label) ?? ''}</div>
          </div>
          <button
            type="button"
            className={'ctrl-switch' + (isOnB ? ' is-on' : '')}
            onClick={toggleB}
            aria-pressed={isOnB}
            disabled={!isLive}
          >
            <span className="ctrl-switch-knob" />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Press Switch — large circular toggle button. Glows when "on",
   recessed when "off". Click toggles between on_value / off_value. */
function PreviewPressSwitchControl({ options = {}, onCommand }) {
  const b    = options.bindings?.[0]
  // Raw value so list/dict states resolve (resolveBindingValue returns null
  // for objects, which would pin the switch to OFF and never send the OFF
  // value on the second press). Scalars behave identically.
  const live = resolveBindingRawValue(b, options.devicesById)
  const { onVal, onType, offVal, offType } = getToggleConfig(b)
  const isOn = isToggleOn(live, onVal)
  const isLive = !!onCommand
  function toggle() {
    if (!isLive || !b) return
    if (isOn) dispatchWrite(onCommand, b, offType, offVal, options.devicesById)
    else      dispatchWrite(onCommand, b, onType, onVal, options.devicesById)
  }
  const iconId = options.icon || ''
  // The press button surface uses the ICON color (not the card's text
  // colour) so the user can pick the button's hue via the Icon Color
  // swatch. The icon glyph stays white for contrast.
  const iconHex = getIconColor(options.iconColor).hex
  // Drive the colour through CSS vars so the stylesheet can animate the
  // ON / OFF states differently (idle-raised vs lit-pulsing) instead of a
  // single static box-shadow.
  const pressStyle = {
    background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.30), transparent 50%), linear-gradient(180deg, ${iconHex} 0%, color-mix(in srgb, ${iconHex} 70%, black) 100%)`,
    '--press-glow':   hexToRgba(iconHex, 0.45),
    '--press-glow-2': hexToRgba(iconHex, 0.24),
    '--press-glow-3': hexToRgba(iconHex, 0.12),
  }
  return (
    <div className={'cv-card ctrl-card ctrl-card-press' + (isOn ? ' is-on' : '')} style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={iconId || undefined} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Power'}</div>
          <div className="cv-sub">
            {options.description || (isLive
              ? isOn ? `ON · sends ${offVal}` : `OFF · sends ${onVal}`
              : 'Push to toggle')}
          </div>
        </div>
      </div>
      <button
        type="button"
        className={'ctrl-press-switch' + (isOn ? ' is-on' : '')}
        style={pressStyle}
        onClick={toggle}
        disabled={!isLive}
        aria-pressed={isOn}
        aria-label={options.title || 'Press'}
      >
        {iconId ? (
          <img
            src={`https://api.iconify.design/${iconId}.svg?color=${encodeURIComponent('#ffffff')}`}
            alt="" aria-hidden="true"
          />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M5.5 8.5a8 8 0 1 0 13 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <div className={'ctrl-press-status' + (isOn ? ' is-on' : '')}>
        <span className="ctrl-press-dot" />
        {isLive ? (isOn ? 'ON' : 'OFF') : '—'}
      </div>
    </div>
  )
}

/* ── Single Action Card — icon + title + description + one full-width
   button. The button text is state-driven: it shows the user's ON label
   while the device reads ON, and the OFF label while it reads OFF. Click
   toggles between on_value / off_value. */
function PreviewSingleButtonControl({ options = {}, onCommand }) {
  const b    = options.bindings?.[0]
  // Raw value so list/dict states resolve (resolveBindingValue returns
  // null for objects). Scalars behave identically.
  const live = resolveBindingRawValue(b, options.devicesById)
  const { onVal, onType, offVal, offType } = getToggleConfig(b)
  const isOn = isToggleOn(live, onVal)
  const isLive = !!onCommand
  const onLabel  = b?.on_label  || 'On'
  const offLabel = b?.off_label || 'Off'
  const label  = isOn ? onLabel : offLabel
  function toggle() {
    if (!isLive || !b) return
    if (isOn) dispatchWrite(onCommand, b, offType, offVal, options.devicesById)
    else      dispatchWrite(onCommand, b, onType, onVal, options.devicesById)
  }
  return (
    <div className={'cv-card ctrl-card ctrl-card-single' + (isOn ? ' is-on' : '')} style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Room Light'}</div>
          {options.description && <div className="cv-sub">{options.description}</div>}
        </div>
      </div>
      <button
        type="button"
        className={'ctrl-action-btn ctrl-btn-primary' + (isOn ? ' is-active' : '')}
        onClick={toggle}
        disabled={!isLive}
      >
        {label}
      </button>
    </div>
  )
}

/* ── Multi Action Card — each button sends its own value. The button
   matching the live payload value is highlighted (active). */
function PreviewMultiButtonControl({ options = {}, onCommand }) {
  const isLive = !!onCommand
  // Collect all actions from all bindings (each binding group
  // carries its own actions list + target path).
  const groups = (options.bindings || []).map((b) => ({
    binding: b,
    live: resolveBindingValue(b, options.devicesById),
    actions: Array.isArray(b?.actions) && b.actions.length > 0
      ? b.actions
      : [{ label: 'Action', value: '1', type: 'string' }],
  }))
  const allActions = groups.flatMap((g) =>
    g.actions.map((a) => ({ ...a, binding: g.binding, live: g.live })),
  )
  if (allActions.length === 0) {
    allActions.push(
      { label: 'Action 1', value: '1', type: 'string', binding: null, live: null },
      { label: 'Action 2', value: '2', type: 'string', binding: null, live: null },
    )
  }
  function fire(a) {
    if (!isLive || !a.binding) return
    dispatchWrite(onCommand, a.binding, a.type || 'string', a.value, options.devicesById)
  }
  return (
    <div className="cv-card ctrl-card ctrl-card-multi" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Quick Actions'}</div>
          {options.description && <div className="cv-sub">{options.description}</div>}
        </div>
      </div>
      <div className="ctrl-btn-row">
        {allActions.map((a, i) => {
          const active = a.live != null && String(a.live) === String(a.value)
          return (
            <button
              key={i}
              type="button"
              className={'ctrl-action-btn ctrl-btn-sm' + (active ? ' is-active' : '')}
              onClick={() => fire(a)}
              disabled={!isLive}
              title={a.label}
            >
              {a.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* Press feedback for +/− steppers — tracks which direction was last
   pressed so the UI can flash that button (and pop the value in that
   direction) for a moment, giving the user an unmistakable cue about
   what they just pressed. `pulse` increments on every press so a repeated
   tap of the SAME button still replays the animation (via React key). */
function usePressFlash() {
  const [pressed, setPressed] = useState(null) // 'up' | 'down' | null
  const [pulse, setPulse] = useState(0)
  const timer = useRef(null)
  function flash(dir) {
    setPressed(dir)
    setPulse((n) => n + 1)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPressed(null), 460)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { pressed, pulse, flash }
}

/* ── Stepper — title + value display + minus / plus buttons. */
function PreviewStepperControl({ options = {}, onCommand }) {
  const b = options.bindings?.[0]
  const live = resolveBindingValue(b, options.devicesById)
  // Detect if the target field is float so we always send the right type.
  const declaredType = resolveBindingDeclaredType(b, options.devicesById)
  const isFloat = declaredType === 'float' || String(options.step || '').includes('.')
  const min  = Number(options.min ?? 0)
  const max  = Number(options.max ?? 100)
  const step = Number(options.step ?? (isFloat ? 0.1 : 1))
  const value = typeof live === 'number' ? live : (isFloat ? (min + max) / 2 : Math.round((min + max) / 2))
  const isLive = !!onCommand
  const { pressed, pulse, flash } = usePressFlash()
  function bump(d) {
    if (!isLive || !b) return
    flash(d > 0 ? 'up' : 'down')   // immediate cue — which button was pressed
    const raw = value + d * step
    const next = Math.max(min, Math.min(max, raw))
    // Float fields → always send as float with 2 decimal precision.
    // Integer step on a float field → value still sent as float (e.g. 25.00).
    if (isFloat) {
      dispatchWrite(onCommand, b, 'float', parseFloat(next.toFixed(2)), options.devicesById)
    } else {
      dispatchWrite(onCommand, b, 'int', Math.round(next), options.devicesById)
    }
  }
  // Display format: float values show 2 decimals, int shows integer.
  const displayValue = isFloat ? value.toFixed(2) : String(value)
  return (
    <div className="cv-card ctrl-card ctrl-card-stepper" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="thermometer" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Temperature'}</div>
          <div className="cv-sub">{options.description || `Range ${min}–${max}${options.unit ? ` ${options.unit}` : ''}`}</div>
        </div>
      </div>
      <div className="ctrl-stepper-row">
        <button type="button" className={'ctrl-step-btn ctrl-step-minus' + (pressed === 'down' ? ' is-pressed' : '')} onClick={() => bump(-1)} disabled={!isLive || value <= min} aria-label="decrease">−</button>
        <div className="ctrl-step-value">
          <span key={pulse} className={'cv-big ctrl-bump-num' + (pressed ? ' bump-' + pressed : '')}>{displayValue}</span>
          {options.unit && <span className="cv-unit">{options.unit}</span>}
        </div>
        <button type="button" className={'ctrl-step-btn ctrl-step-plus' + (pressed === 'up' ? ' is-pressed' : '')} onClick={() => bump(1)} disabled={!isLive || value >= max} aria-label="increase">+</button>
      </div>
    </div>
  )
}

/* ── Number Entry — typed numeric input with unit + send. */
function PreviewNumberInputControl({ options = {}, onCommand }) {
  const live = resolveBindingValue(options.bindings?.[0], options.devicesById)
  const [draft, setDraft] = useState(typeof live === 'number' ? String(live) : '')
  const [status, setStatus] = useState(null)
  const isLive = !!onCommand
  useEffect(() => { if (typeof live === 'number') setDraft(String(live)) }, [live])
  function send() {
    if (!isLive) return
    if (!draft.trim()) { setStatus({ type: 'err', text: 'Value cannot be empty' }); return }
    if (isNaN(Number(draft))) { setStatus({ type: 'err', text: 'Must be a number' }); return }
    const t = draft.includes('.') ? 'float' : 'int'
    const ok = dispatchWrite(onCommand, options.bindings?.[0], t, draft, options.devicesById)
    if (ok !== false) setStatus({ type: 'ok', text: 'Sent' })
    setTimeout(() => setStatus(null), 2000)
  }
  return (
    <div className="cv-card ctrl-card ctrl-card-num" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="thermometer" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Set Temperature'}</div>
          <div className="cv-sub">{options.description || (isLive ? 'Type a new value' : 'Type + send')}</div>
        </div>
      </div>
      <div className="ctrl-input-row">
        <input
          type="text" inputMode="decimal"
          className="ctrl-text-input"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setStatus(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder={isLive ? '0' : '23'}
          disabled={!isLive}
        />
        {options.unit && <span className="ctrl-input-unit">{options.unit}</span>}
        <button type="button" className="ctrl-input-send" onClick={send} disabled={!isLive}>Send</button>
      </div>
      {status && <div className={'ctrl-status ctrl-status-' + status.type}>{status.text}</div>}
    </div>
  )
}

/* (legacy bare-button preview kept for reference / future use) */
function PreviewButtonControl({ variant = 'button', options = {}, onCommand }) {
  const isLive = !!onCommand
  function fire() {
    if (!isLive) return
    const b = options.bindings?.[0]
    if (!b?.device_id || !b?.payload_path) return
    const wv = options.writeValue
    const wt = options.writeValueType || 'string'
    let parsed = wv
    if (wt === 'int')     parsed = parseInt(wv, 10)
    else if (wt === 'float') parsed = parseFloat(wv)
    else if (wt === 'boolean') parsed = (String(wv).toLowerCase() === 'true' || wv === true)
    if (wt !== 'string' && !Number.isFinite(parsed) && wt !== 'boolean') return
    onCommand(b.device_id, 'put', b.payload_path, { type: wt, value: parsed })
  }
  // Button label / icon vary per variant. Icon + Power render glyph
  // instead of (or alongside) the text label.
  const label = options.buttonLabel || 'Send'
  const iconId = options.icon || ''
  const accent = '#F36A1E'  // pulled inline so iconify URL is stable
  const showIconOnly = variant === 'button_icon' || variant === 'button_power'

  let content
  if (variant === 'button_power') {
    content = (
      <svg width="44%" height="44%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3v9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M5.5 8.5a8 8 0 1 0 13 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    )
  } else if (variant === 'button_icon' && iconId) {
    content = (
      <img
        src={`https://api.iconify.design/${iconId}.svg?color=${encodeURIComponent('#ffffff')}`}
        alt=""
        aria-hidden="true"
        style={{ width: '52%', height: '52%' }}
      />
    )
  } else if (showIconOnly) {
    // Icon button with no icon picked yet — render a "+" placeholder
    content = (
      <svg width="42%" height="42%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    )
  } else {
    content = label
  }
  const subText = isLive ? `Sends "${options.writeValue ?? '—'}"` : (CONTROL_VARIANT_DEFS[variant]?.sampleSub || 'Send the configured value')
  const titleText = options.title || CONTROL_VARIANT_DEFS[variant]?.sampleTitle || 'Action'
  return (
    <ControlCard title={titleText} sub={subText}>
      <button
        type="button"
        className={`ctrl-action-btn ctrl-style-${variant}`}
        onClick={fire}
        disabled={!isLive}
        aria-label={showIconOnly ? label : undefined}
      >
        {content}
      </button>
    </ControlCard>
  )
}

function PreviewSliderControl({ options = {}, onCommand }) {
  const b = options.bindings?.[0]
  const live = resolveBindingValue(b, options.devicesById)
  const declaredType = resolveBindingDeclaredType(b, options.devicesById)
  const isFloat = declaredType === 'float' || String(options.step || '').includes('.')
  const min  = Number(options.min ?? 0)
  const max  = Number(options.max ?? 100)
  const step = Number(options.step ?? (isFloat ? 0.1 : 1))
  const isLive = !!onCommand
  const value = typeof live === 'number' ? live : (isFloat ? (min + max) / 2 : Math.round((min + max) / 2))
  const displayValue = isFloat ? Number(value).toFixed(2) : String(Math.round(value))
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0
  const { pressed, pulse, flash } = usePressFlash()

  function bump(d) {
    if (!isLive || !b) return
    flash(d > 0 ? 'up' : 'down')   // immediate cue — which button was pressed
    const raw = value + d * step
    const next = Math.max(min, Math.min(max, raw))
    if (isFloat) {
      dispatchWrite(onCommand, b, 'float', parseFloat(next.toFixed(2)), options.devicesById)
    } else {
      dispatchWrite(onCommand, b, 'int', Math.round(next), options.devicesById)
    }
  }
  return (
    <div className="cv-card ctrl-card ctrl-card-slider" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Brightness'}</div>
          <div className="cv-sub">{options.description || (isLive ? `${displayValue}${options.unit ? ' ' + options.unit : ''}` : `Tap +/− · ${min}–${max}`)}</div>
        </div>
        <span className="ctrl-card-readout">
          <span key={pulse} className={'cv-big ctrl-bump-num' + (pressed ? ' bump-' + pressed : '')}>{displayValue}</span>
          {options.unit && <span className="cv-unit">{options.unit}</span>}
        </span>
      </div>
      <div className={'ctrl-level-row' + (pressed ? ' is-bumped bump-' + pressed : '')}>
        <button type="button" className={'ctrl-step-btn ctrl-step-minus' + (pressed === 'down' ? ' is-pressed' : '')} onClick={() => bump(-1)} disabled={!isLive || value <= min} aria-label="decrease">−</button>
        <div className="ctrl-level-track">
          <div className="ctrl-level-fill" style={{ width: `${pct}%` }} />
        </div>
        <button type="button" className={'ctrl-step-btn ctrl-step-plus' + (pressed === 'up' ? ' is-pressed' : '')} onClick={() => bump(1)} disabled={!isLive || value >= max} aria-label="increase">+</button>
      </div>
    </div>
  )
}

function PreviewTextInputControl({ options = {}, onCommand }) {
  const live = resolveBindingValue(options.bindings?.[0], options.devicesById)
  const [draft, setDraft] = useState(typeof live === 'string' ? live : '')
  const [status, setStatus] = useState(null)
  const isLive = !!onCommand
  useEffect(() => { if (typeof live === 'string') setDraft(live) }, [live])
  function send() {
    if (!isLive) return
    if (!draft.trim()) { setStatus({ type: 'err', text: 'Value cannot be empty' }); return }
    const ok = dispatchWrite(onCommand, options.bindings?.[0], 'string', draft, options.devicesById)
    if (ok !== false) setStatus({ type: 'ok', text: 'Sent' })
    setTimeout(() => setStatus(null), 2000)
  }
  return (
    <div className="cv-card ctrl-card ctrl-card-text" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="bolt" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Device Name'}</div>
          <div className="cv-sub">{options.description || (isLive ? `Current: ${live ?? '—'}` : 'Type + send')}</div>
        </div>
      </div>
      <div className="ctrl-input-row">
        <input
          type="text"
          className="ctrl-text-input"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setStatus(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder={isLive ? 'Type a value…' : 'Sample value'}
          disabled={!isLive}
        />
        <button type="button" className="ctrl-input-send" onClick={send} disabled={!isLive}>Send</button>
      </div>
      {status && <div className={'ctrl-status ctrl-status-' + status.type}>{status.text}</div>}
    </div>
  )
}

/* ── List Entry — textarea for a list array + send button. */
function validateList(text) {
  const trimmed = text.trim()
  if (!trimmed) return 'List cannot be empty.'
  if (trimmed[0] !== '[') return 'Must start with ['
  if (trimmed[trimmed.length - 1] !== ']') return 'Must end with ]'
  let parsed
  try { parsed = JSON.parse(trimmed) } catch (e) {
    const m = e.message || ''
    const pos = m.match(/position\s+(\d+)/i)
    if (pos) return `Syntax error at position ${pos[1]}`
    return 'Invalid list syntax'
  }
  if (!Array.isArray(parsed)) return 'Must be a list [ ... ]'
  return null
}

function PreviewListInputControl({ options = {}, onCommand }) {
  const b = options.bindings?.[0]
  const live = resolveBindingRawValue(b, options.devicesById)
  const [draft, setDraft] = useState(Array.isArray(live) ? JSON.stringify(live, null, 2) : '[]')
  const [err, setErr] = useState('')
  const [status, setStatus] = useState(null)
  const isLive = !!onCommand
  useEffect(() => { if (Array.isArray(live)) setDraft(JSON.stringify(live, null, 2)) }, [live])
  function send() {
    if (!isLive || !b) return
    setStatus(null)
    const e = validateList(draft)
    if (e) { setErr(e); return }
    setErr('')
    onCommand(b.device_id, 'put', b.payload_path, { type: 'list', value: JSON.parse(draft.trim()) })
    setStatus({ type: 'ok', text: 'List sent' })
    setTimeout(() => setStatus(null), 2000)
  }
  const itemCount = (() => {
    try { const p = JSON.parse(draft); return Array.isArray(p) ? p.length : null } catch { return null }
  })()
  return (
    <div className="cv-card ctrl-card ctrl-card-list" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="list" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Config List'}</div>
          <div className="cv-sub">{options.description || (isLive ? 'Edit list + send' : 'List entry')}</div>
        </div>
      </div>
      <div className="ctrl-list-body">
        <textarea
          className={'ctrl-list-input' + (err ? ' input-error' : '')}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() }}
          placeholder={'[\n  "item1",\n  "item2"\n]'}
          disabled={!isLive}
          rows={5}
        />
        <div className="ctrl-list-foot">
          <div className="ctrl-list-meta">
            {err
              ? <span className="ctrl-list-err">{err}</span>
              : status
                ? <span className={'ctrl-status ctrl-status-' + status.type}>{status.text}</span>
                : itemCount != null && <span className="ctrl-list-count">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>}
          </div>
          <button type="button" className="ctrl-input-send" onClick={send} disabled={!isLive}>Send</button>
        </div>
      </div>
    </div>
  )
}

/* ── JSON Entry — textarea for a JSON object + send button. */
function PreviewJsonInputControl({ options = {}, onCommand }) {
  const b = options.bindings?.[0]
  const live = resolveBindingRawValue(b, options.devicesById)
  const isObj = live != null && typeof live === 'object' && !Array.isArray(live)
  const [draft, setDraft] = useState(isObj ? JSON.stringify(live, null, 2) : '{}')
  const [err, setErr] = useState('')
  const isLive = !!onCommand
  useEffect(() => {
    if (live != null && typeof live === 'object' && !Array.isArray(live))
      setDraft(JSON.stringify(live, null, 2))
  }, [live])
  const [status, setStatus] = useState(null)
  function send() {
    if (!isLive || !b) return
    setStatus(null)
    try {
      const parsed = JSON.parse(draft)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { setErr('Must be a JSON object'); return }
      setErr('')
      onCommand(b.device_id, 'put', b.payload_path, { type: 'dict', value: parsed })
      setStatus({ type: 'ok', text: 'Sent' })
      setTimeout(() => setStatus(null), 2000)
    } catch { setErr('Invalid JSON') }
  }
  return (
    <div className="cv-card ctrl-card ctrl-card-json" style={ctrlCardStyle(options.color)}>
      <div className="ctrl-card-row">
        <CtrlIcon iconId={options.icon} fallbackName="code" iconColor={options.iconColor} />
        <div className="ctrl-card-titles">
          <div className="cv-title">{options.title || 'Config Object'}</div>
          <div className="cv-sub">{options.description || (isLive ? 'Edit object + send' : 'JSON object + send')}</div>
        </div>
      </div>
      <div className="ctrl-json-body">
        <textarea
          className={'ctrl-json-input' + (err ? ' input-error' : '')}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr(''); setStatus(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() }}
          placeholder='{"key": "value"}'
          disabled={!isLive}
          rows={3}
        />
        <div className="ctrl-json-foot">
          {err ? <span className="ctrl-json-err">{err}</span> : status ? <span className={'ctrl-status ctrl-status-' + status.type}>{status.text}</span> : <span />}
          <button type="button" className="ctrl-input-send" onClick={send} disabled={!isLive}>Send</button>
        </div>
      </div>
    </div>
  )
}

/* =====================================================================
   ControlConfigure — configure form for control widgets. Smaller than
   CardConfigure (no card color / pattern / icon). Variant-specific
   fields: writeValue (button), min/max/step (slider).
   ===================================================================== */
/* Editable list of {label, value, type} rows. Used by multi_button
   to let the user define each action's button label, write value,
   and value type. */
function ActionValueInput({ type, value, onChange, disabled, hasError }) {
  if (type === 'boolean') {
    return (
      <select
        className={'ctrl-actions-input' + (hasError ? ' input-error' : '')}
        value={value === '' ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="" disabled>Select…</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  if (type === 'int') {
    return (
      <input
        type="text"
        inputMode="numeric"
        className={'ctrl-actions-input' + (hasError ? ' input-error' : '')}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || v === '-' || /^-?\d+$/.test(v)) onChange(v)
        }}
        placeholder="e.g. 1"
        disabled={disabled}
      />
    )
  }
  if (type === 'float') {
    return (
      <input
        type="text"
        inputMode="decimal"
        className={'ctrl-actions-input' + (hasError ? ' input-error' : '')}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || v === '-' || v === '.' || v === '-.' || /^-?\d*\.?\d*$/.test(v)) onChange(v)
        }}
        placeholder="e.g. 1.5"
        disabled={disabled}
      />
    )
  }
  return (
    <input
      type="text"
      className={'ctrl-actions-input' + (hasError ? ' input-error' : '')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g. cool"
      disabled={disabled}
    />
  )
}

function ActionsEditor({ actions, onChange, disabled, lockedType, errors }) {
  function update(i, k, v) {
    onChange(actions.map((a, idx) => (idx === i ? { ...a, [k]: v } : a)))
  }
  function remove(i) { onChange(actions.filter((_, idx) => idx !== i)) }
  function add() { onChange([...actions, { label: '', value: '', type: lockedType || 'string' }]) }
  return (
    <div className="ctrl-actions-editor">
      <div className="ctrl-actions-head">
        <span className="form-label" style={{ flex: 1 }}>Actions{lockedType ? ` · ${lockedType}` : ''}</span>
        <button type="button" className="row-btn" onClick={add} disabled={disabled}>+ Add</button>
      </div>
      <div className="ctrl-actions-list">
        {actions.map((a, i) => {
          const valErr = errors?.[`action.${i}`]
          const lblErr = errors?.[`action_label.${i}`]
          const hasErr = valErr || lblErr
          const activeType = lockedType || a.type || 'string'
          return (
            <div key={i} className={'ctrl-actions-row' + (hasErr ? ' has-error' : '')}>
              <input
                type="text"
                className={'ctrl-actions-input' + (lblErr ? ' input-error' : '')}
                value={a.label}
                onChange={(e) => update(i, 'label', e.target.value)}
                placeholder="e.g. Cool"
                disabled={disabled}
              />
              <ActionValueInput
                type={activeType}
                value={a.value}
                onChange={(v) => update(i, 'value', v)}
                disabled={disabled}
                hasError={!!valErr}
              />
              <select
                className="ctrl-actions-select"
                value={activeType}
                onChange={(e) => update(i, 'type', e.target.value)}
                disabled={disabled || !!lockedType}
              >
                <option value="string">string</option>
                <option value="int">int</option>
                <option value="float">float</option>
                <option value="boolean">boolean</option>
              </select>
              <button
                type="button"
                className="row-btn danger"
                onClick={() => remove(i)}
                disabled={disabled || actions.length <= 1}
                aria-label="Remove action"
              >×</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ControlConfigure({ variant, devices, initial, onBack, onSubmit, themeDefaults }) {
  const def = CONTROL_VARIANT_DEFS[variant] || CONTROL_VARIANT_DEFS.switch
  const isEditing = !!initial
  const initCfg  = initial?.config || {}
  const initStat = initCfg.static || {}
  const initBindings = Array.isArray(initCfg.bindings) ? initCfg.bindings : []
  const themeCardDefault = themeDefaults?.cardColor || 'peach'
  const themeIconDefault = themeDefaults?.iconColor || 'orange'

  const [widgetName, setWidgetName]   = useState(initial?.widget_name || '')
  const [title, setTitle]             = useState(initCfg.title || '')
  const [description, setDescription] = useState(initCfg.description || '')
  const [unit, setUnit]               = useState(initStat.unit || '')
  const [icon, setIcon]               = useState(initStat.icon || '')
  const [cardColor, setCardColor]     = useState(initStat.card_color || themeCardDefault)
  const [iconColor, setIconColor]     = useState(initStat.icon_color || themeIconDefault)
  const [writeValue, setWriteValue] = useState(initStat.write_value ?? '')
  const [writeValueType, setWriteValueType] = useState(initStat.write_value_type || 'string')
  const [buttonLabel, setButtonLabel] = useState(initStat.button_label || 'Send')
  // Stringify saved numbers so the form inputs show them correctly.
  // Float values (0.1) display as "0.1"; integers (0) display as "0".
  const [min, setMin] = useState(initStat.min != null ? String(initStat.min) : '0')
  const [max, setMax] = useState(initStat.max != null ? String(initStat.max) : '100')
  const [step, setStep] = useState(initStat.step != null ? String(initStat.step) : '1')
  // Per-binding actions: each binding carries its own actions list.
  // Legacy widgets may have actions in config.static — migrate on load.
  function makeBinding(ex, fieldDef) {
    const base = ex
      ? {
          device_id: ex.device_id != null ? String(ex.device_id) : '',
          payload_path: ex.payload_path || '',
          label: ex.label || '',
          on_value: ex.on_value ?? '', off_value: ex.off_value ?? '',
          on_type: ex.on_type || '', off_type: ex.off_type || '',
          on_label: ex.on_label || '', off_label: ex.off_label || '',
        }
      : { device_id: '', payload_path: '', label: '', on_value: '', off_value: '', on_type: '', off_type: '', on_label: '', off_label: '' }
    // Per-binding actions (if this variant supports them)
    if (def.hasPerBindingActions) {
      base.actions = Array.isArray(ex?.actions) && ex.actions.length > 0
        ? ex.actions
        : (Array.isArray(initStat.actions) && initStat.actions.length > 0)
          ? initStat.actions   // legacy migration: global → first binding
          : (def.sampleActions || [{ label: '', value: '', type: 'string' }])
    }
    return base
  }
  const [bindings, setBindings] = useState(() => {
    // For hasPerBindingActions, load ALL saved bindings (not just
    // def.fields.length). The user can add/remove targets dynamically.
    if (def.hasPerBindingActions && initBindings.length > 0) {
      return initBindings.map((ex) => makeBinding(ex, def.fields[0]))
    }
    return def.fields.map((f, i) => makeBinding(initBindings[i], f))
  })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [banner, setBanner] = useState(null)

  // Auto-adapt Min / Max / Step when the payload path CHANGES (user
  // picks a different field). Skipped on initial mount when editing an
  // existing widget so saved values aren't overwritten with defaults.
  const firstPath  = bindings[0]?.payload_path
  const firstDevId = bindings[0]?.device_id
  const prevPathRef = useRef(firstPath)
  useEffect(() => {
    if (!def.hasMinMax || !firstPath || !firstDevId) return
    // On initial mount of an existing widget, the path matches what
    // was saved → skip reset so user's custom min/max/step persist.
    if (prevPathRef.current === firstPath && isEditing) {
      return
    }
    prevPathRef.current = firstPath
    const device = devices.find((d) => String(d.id) === String(firstDevId))
    if (!device?.payload) return
    const norm = (s) => '/' + String(s).replace(/^\/+|\/+$/g, '')
    const paths = flattenScalarPaths(device.payload)
    const found = paths.find((p) => norm(p.path) === norm(firstPath))
    if (!found) return
    if (found.type === 'float') {
      setMin('0.00')
      setMax('100.00')
      setStep('0.10')
    } else {
      setMin('0')
      setMax('100')
      setStep('1')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstPath, firstDevId])

  function setBinding(i, k, v) {
    setBindings((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)))
    setErrors((e) => {
      const nk = `bindings.${i}.${k}`
      if (!e[nk]) return e
      const next = { ...e }; delete next[nk]; return next
    })
  }
  function addTarget() {
    setBindings((bs) => [...bs, makeBinding(null, def.fields[0])])
  }
  function removeTarget(i) {
    setBindings((bs) => bs.filter((_, idx) => idx !== i))
  }
  function setBindingActions(i, acts) {
    setBindings((bs) => bs.map((b, idx) => (idx === i ? { ...b, actions: acts } : b)))
  }

  function detectBindingType(b) {
    if (!b?.device_id || !b?.payload_path) return null
    const device = devices.find((d) => String(d.id) === String(b.device_id))
    if (!device?.payload) return null
    const norm = (s) => '/' + String(s).replace(/^\/+|\/+$/g, '')
    const paths = flattenScalarPaths(device.payload)
    return paths.find((p) => norm(p.path) === norm(b.payload_path))?.type || null
  }

  const bindingTypes = useMemo(
    () => bindings.map((b) => detectBindingType(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindings.map((b) => `${b.device_id}|${b.payload_path}`).join(','), devices],
  )

  const prevBindingTypesRef = useRef(null)
  useEffect(() => {
    if (!def.hasPerBindingActions) return
    const prev = prevBindingTypesRef.current
    const isFirst = prev === null
    prevBindingTypesRef.current = bindingTypes
    let changed = false
    const updated = bindings.map((b, i) => {
      const t = bindingTypes[i]
      if (!t || !Array.isArray(b.actions)) return b
      if (!isFirst && t === prev?.[i]) return b
      const alreadyCorrect = b.actions.every((a) => a.type === t)
      if (isFirst && alreadyCorrect) return b
      changed = true
      if (isFirst) {
        return { ...b, actions: b.actions.map((a) => ({ ...a, type: t })) }
      }
      return { ...b, actions: b.actions.map((a) => ({ ...a, type: t, value: '' })) }
    })
    if (changed) setBindings(updated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingTypes])

  const previewOptions = {
    title: title || def.sampleTitle,
    description: description || def.sampleSub || '',
    bindings,
    writeValue, writeValueType, buttonLabel,
    min, max, step, unit, icon,
    color: cardColor, iconColor,
  }

  function submit(e) {
    e.preventDefault()
    setBanner(null)
    const fes = {}
    if (!widgetName.trim()) fes.widget_name = 'Widget name is required.'
    bindings.forEach((b, i) => {
      const fieldDef = def.fields[Math.min(i, def.fields.length - 1)] || def.fields[0]
      if (!b.device_id)            fes[`bindings.${i}.device_id`]    = 'Pick a device.'
      if (!b.payload_path.trim())  fes[`bindings.${i}.payload_path`] = 'Required.'
      // Toggle / dual-toggle / press-switch: the ON/OFF payload must
      // match the type of the selected device field. The detected type
      // (bindingTypes[i]) is authoritative; fall back to the binding's
      // own type when the device hasn't reported a payload.
      if (fieldDef?.withToggleValues) {
        const vType = bindingTypes[i] || b.on_type || 'boolean'
        const onErr  = validateToggleValue(b.on_value,  bindingTypes[i] || b.on_type  || vType)
        const offErr = validateToggleValue(b.off_value, bindingTypes[i] || b.off_type || vType)
        if (onErr)  fes[`bindings.${i}.on_value`]  = onErr
        if (offErr) fes[`bindings.${i}.off_value`] = offErr
      }
      // Action Card — both ON/OFF button labels are required.
      if (fieldDef?.withButtonLabels) {
        if (!String(b.on_label  ?? '').trim()) fes[`bindings.${i}.on_label`]  = 'Required.'
        if (!String(b.off_label ?? '').trim()) fes[`bindings.${i}.off_label`] = 'Required.'
      }
      if (def.hasPerBindingActions && Array.isArray(b.actions)) {
        const bType = bindingTypes[i]
        b.actions.forEach((a, j) => {
          const v = String(a.value).trim()
          if (!v) { fes[`bindings.${i}.action.${j}`] = 'Value is required.'; }
          else if (bType === 'int' && !/^-?\d+$/.test(v)) { fes[`bindings.${i}.action.${j}`] = 'Must be an integer.'; }
          else if (bType === 'float' && !/^-?\d*\.\d+$/.test(v)) { fes[`bindings.${i}.action.${j}`] = 'Must be a decimal (e.g. 1.0).'; }
          if (!String(a.label).trim()) fes[`bindings.${i}.action_label.${j}`] = 'Label is required.'
        })
      }
    })
    setErrors(fes)
    if (Object.keys(fes).length > 0) return

    const config = {
      title: title || '',
      description: description || '',
      variant,
      bindings: bindings.map((b, i) => {
        const fieldDef = def.fields[Math.min(i, def.fields.length - 1)] || def.fields[0]
        // When the field locks the type to the selected payload field,
        // persist that detected type as authoritative so the saved ON/OFF
        // payload can only ever be of the selected field's type.
        const lockedType = (fieldDef?.lockToggleType && bindingTypes[i]) || null
        return ({
        device_id: Number(b.device_id),
        payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''),
        label: b.label || (def.fields[i]?.label ?? 'Target'),
        ...(b.on_value  ? { on_value: b.on_value, on_type: lockedType || b.on_type || 'boolean' } : {}),
        ...(b.off_value ? { off_value: b.off_value, off_type: lockedType || b.off_type || 'boolean' } : {}),
        // Optional per-state display labels (dual_toggle).
        ...(b.on_label  ? { on_label: b.on_label }   : {}),
        ...(b.off_label ? { off_label: b.off_label } : {}),
        // Per-binding actions (multi_button).
        ...(Array.isArray(b.actions) && b.actions.length > 0
          ? { actions: b.actions.map((a) => ({ label: a.label, value: a.value, type: bindingTypes[i] || a.type || 'string' })) }
          : {}),
        })
      }),
      static: {
        ...(unit ? { unit } : {}),
        ...(def.hasIcon && icon ? { icon } : {}),
        ...(def.hasWriteValue ? { write_value: writeValue, write_value_type: writeValueType } : {}),
        ...(def.hasButtonLabel || def.hasWriteValue ? { button_label: buttonLabel } : {}),
        ...(def.hasMinMax ? { min: Number(min), max: Number(max), step: Number(step) } : {}),
        card_color: cardColor,
        icon_color: iconColor,
      },
      ui: {},
    }
    onSubmit?.({ widget_name: widgetName, widget_type: 'control', config }, setSaving, setErrors, setBanner)
  }

  return (
    <div className="card-config">
      <div className="card-config-preview-col">
        <div className="card-config-example-label">{isEditing ? 'Editing' : 'Example'}</div>
        <div className="card-config-preview-frame">
          <ControlPreview variant={variant} options={previewOptions} />
        </div>
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
              <input type="text" value={widgetName} disabled={saving} autoFocus
                onChange={(e) => { setWidgetName(e.target.value); if (errors.widget_name) setErrors((x) => ({ ...x, widget_name: undefined })) }}
                placeholder="pump_switch" />
            </DField>
            <DField label="Title (shown on the card)">
              <input type="text" value={title} disabled={saving}
                onChange={(e) => setTitle(e.target.value)} placeholder={def.sampleTitle} />
            </DField>
            <DField label="Description (subtitle)" full>
              <input type="text" value={description} disabled={saving}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={def.sampleSub || 'e.g. Living room controls'} />
            </DField>
            {def.hasButtonLabel && (
              <DField label="Button label" full>
                <input type="text" value={buttonLabel} disabled={saving}
                  onChange={(e) => setButtonLabel(e.target.value)}
                  placeholder="Toggle" />
              </DField>
            )}
            {/* Min/Max/Step/Unit moved to the Target section below the binding */}
            {def.hasWriteValue && (
              <>
                <DField label="Value to send">
                  <input type="text" value={writeValue} disabled={saving}
                    onChange={(e) => setWriteValue(e.target.value)} placeholder="e.g. 1, true, reset" />
                </DField>
                <DField label="Value type">
                  <select value={writeValueType} disabled={saving}
                    onChange={(e) => setWriteValueType(e.target.value)}>
                    <option value="string">string</option>
                    <option value="int">int</option>
                    <option value="float">float</option>
                    <option value="boolean">boolean</option>
                  </select>
                </DField>
                <DField label="Button label" full>
                  <input type="text" value={buttonLabel} disabled={saving}
                    onChange={(e) => setButtonLabel(e.target.value)} placeholder="Send" />
                </DField>
              </>
            )}
            {def.hasIcon && (
              <DField label="Icon" full>
                <IconPickerField value={icon} disabled={saving} onChange={setIcon} />
              </DField>
            )}
            {def.hasUnit && !def.hasMinMax && (
              <DField label="Unit (optional)" full>
                <input type="text" value={unit} disabled={saving}
                  onChange={(e) => setUnit(e.target.value)} placeholder="°C, %, …" />
              </DField>
            )}
          </div>
        </div>

        <div className="card-config-section">
          <div className="card-config-section-head">Appearance</div>
          <div className="form-field">
            <span className="form-label">Card color</span>
            <CardColorPicker value={cardColor} onChange={setCardColor} disabled={saving} usedColors={themeDefaults?.usedColors} />
          </div>
          <div className="form-field">
            <span className="form-label">Icon color</span>
            <IconColorPicker value={iconColor} onChange={setIconColor} disabled={saving} usedColors={themeDefaults?.usedIconColors} />
          </div>
        </div>

        <div className="card-config-section">
          <div className="card-config-section-head">
            {def.hasPerBindingActions ? `Target${bindings.length > 1 ? 's' : ''} & Actions` : 'Data binding'}
          </div>
          {bindings.map((b, i) => {
            const fieldDef = def.fields[Math.min(i, def.fields.length - 1)] || def.fields[0]
            return (
              <div key={i} className="ctrl-target-group">
                {def.hasPerBindingActions && bindings.length > 1 && (
                  <div className="ctrl-target-head">
                    <span className="ctrl-target-num">Target {i + 1}</span>
                    <button type="button" className="row-btn danger" onClick={() => removeTarget(i)} disabled={saving}>Remove</button>
                  </div>
                )}
                <BindingFields
                  field={fieldDef}
                  binding={b}
                  devices={devices}
                  disabled={saving}
                  errors={{
                    device_id:    errors[`bindings.${i}.device_id`],
                    payload_path: errors[`bindings.${i}.payload_path`],
                    on_value:     errors[`bindings.${i}.on_value`],
                    off_value:    errors[`bindings.${i}.off_value`],
                    on_label:     errors[`bindings.${i}.on_label`],
                    off_label:    errors[`bindings.${i}.off_label`],
                  }}
                  onChange={(k, v) => setBinding(i, k, v)}
                />
                {def.hasPerBindingActions && Array.isArray(b.actions) && (
                  <ActionsEditor
                    actions={b.actions}
                    onChange={(acts) => setBindingActions(i, acts)}
                    disabled={saving}
                    lockedType={bindingTypes[i] || null}
                    errors={Object.fromEntries(
                      Object.entries(errors)
                        .filter(([k]) => k.startsWith(`bindings.${i}.action`))
                        .map(([k, v]) => [k.replace(`bindings.${i}.`, ''), v])
                    )}
                  />
                )}
              </div>
            )
          })}
          {def.hasPerBindingActions && (
            <button type="button" className="btn-secondary ctrl-add-target" onClick={addTarget} disabled={saving}>
              + Add Target
            </button>
          )}
          {def.hasMinMax && (
            <div className="ctrl-minmax-group">
              <div className="form-grid-2">
                <DField label="Min">
                  <input type="text" inputMode="decimal" value={min} disabled={saving}
                    onChange={(e) => setMin(e.target.value)} />
                </DField>
                <DField label="Max">
                  <input type="text" inputMode="decimal" value={max} disabled={saving}
                    onChange={(e) => setMax(e.target.value)} />
                </DField>
                <DField label="Step">
                  <input type="text" inputMode="decimal" value={step} disabled={saving}
                    onChange={(e) => setStep(e.target.value)} />
                </DField>
                <DField label="Unit (optional)">
                  <input type="text" value={unit} disabled={saving}
                    onChange={(e) => setUnit(e.target.value)} placeholder="°C, %, …" />
                </DField>
              </div>
            </div>
          )}
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
// Per-binding unit. Falls back to the sample only in the picker preview
// (no live devices); on the real dashboard an unset unit shows nothing.
function bUnit(options, i, fallback) {
  const u = options.bindings?.[i]?.unit
  if (u) return u
  return options.devicesById ? '' : fallback
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
  // A binding can hold a fixed value instead of a device/payload (e.g. the
  // Progress card's target). Use it directly when present.
  if (binding?.use_static) {
    const n = Number(binding.static_value)
    return Number.isFinite(n) ? n : null
  }
  if (!binding?.device_id || !binding?.payload_path || !devicesById) return null
  const device = devicesById.get(Number(binding.device_id))
  if (!device?.payload) return null
  const segs = String(binding.payload_path).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let node = device.payload
  for (const s of segs) {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return null
    node = node[s]
  }
  // Unwrap typed wrapper ({ type, value }) to get the raw scalar.
  if (isTypedWrapper(node)) {
    node = node.value
  }
  if (node === null || node === undefined) return null
  if (typeof node === 'object') return null            // arrays / nested
  return node
}

function resolveBindingRawValue(binding, devicesById) {
  if (!binding?.device_id || !binding?.payload_path || !devicesById) return null
  const device = devicesById.get(Number(binding.device_id))
  if (!device?.payload) return null
  const segs = String(binding.payload_path).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let node = device.payload
  for (const s of segs) {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return null
    node = node[s]
  }
  if (isTypedWrapper(node)) node = node.value
  return node ?? null
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

/* Resolve the DECLARED type of a binding's target path from the
   device's payload wrapper (e.g. {type:"float", value:24.0} → "float").
   Used by the stepper / slider to know whether to send int or float. */
function resolveBindingDeclaredType(binding, devicesById) {
  if (!binding?.device_id || !binding?.payload_path || !devicesById) return null
  const device = devicesById.get(Number(binding.device_id))
  if (!device?.payload) return null
  const segs = String(binding.payload_path).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let node = device.payload
  for (const s of segs) {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return null
    node = node[s]
  }
  if (isTypedWrapper(node)) return normalizeDeclaredType(node.type, node.value)
  if (typeof node === 'number') return Number.isInteger(node) ? 'int' : 'float'
  if (typeof node === 'string') return 'string'
  if (typeof node === 'boolean') return 'boolean'
  if (Array.isArray(node)) return 'list'
  if (typeof node === 'object' && node !== null) return 'dict'
  return null
}

/* Pick a binding value (resolved live) or fall back to a sample.
   Behaviour by context:
     - Picker preview (no `devicesById`)  → return `fallback`
       (sample number so the design preview looks complete)
     - Live dashboard (`devicesById` set) → resolved scalar if the path
       exists; otherwise `-` (path deleted, device missing, binding
       incomplete — anything that doesn't resolve to a scalar). Never
       falls back to the sample value once a real device is wired up. */
function bValue(options, i, fallback) {
  if (!options.devicesById) return fallback
  const b = options.bindings?.[i]
  if (!b?.device_id || !b?.payload_path) return '-'
  const v = resolveBindingValue(b, options.devicesById)
  if (v == null) return '-'
  if (typeof v === 'boolean') {
    const onText  = (b?.on_label  || '').trim()
    const offText = (b?.off_label || '').trim()
    if (v) return onText  || 'true'
    return     offText || 'false'
  }
  const declType = resolveBindingDeclaredType(b, options.devicesById)
  if (declType === 'float' && typeof v === 'number' && Number.isInteger(v)) return v.toFixed(1)
  return formatValue(v)
}

/* ---- preview "card" pieces, all sharing the .cv-card chrome ---- */
function PreviewSimpleValue({ options = {} }) {
  const { title, style } = useCardChrome(options, { title: 'Engine Temperature' })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
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
      {options.description && <div className="cv-desc">{options.description}</div>}
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

/* Format a percent-change delta into { sign, text }, capping the magnitude
   so an extreme change can't overflow the card. Beyond ±999% it shows
   "+999%+" / "-999%+" instead of a runaway number. */
function formatDeltaPct(pct) {
  const CAP = 999
  const sign = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  if (Math.abs(pct) > CAP) return { sign, text: `${pct > 0 ? '+' : '-'}${CAP}%+` }
  return { sign, text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` }
}

function PreviewComparison({ options = {} }) {
  const { title, style, iconColor, icon, unit } = useCardChrome(options, {
    title: 'Fuel Consumption', icon: '', unit: 'Ltrs',
  })
  // Compute delta when both bindings resolve to numbers. Three states:
  //   • cur > prev  → green "+X.X%"
  //   • cur < prev  → red   "-X.X%"
  //   • cur == prev → gray  "0%"
  // When prev is 0 we can't compute a percent, but if cur is also 0
  // it's still "no change"; if cur > 0 we show "+∞ %" (up) gracefully.
  const cur = resolveBindingValue(options.bindings?.[0], options.devicesById)
  const prev = resolveBindingValue(options.bindings?.[1], options.devicesById)
  let delta = null
  if (typeof cur === 'number' && typeof prev === 'number') {
    if (cur === prev) {
      delta = { sign: 'flat', text: '0%' }
    } else if (prev === 0) {
      delta = { sign: cur > 0 ? 'up' : 'down', text: cur > 0 ? '+∞%' : '−∞%' }
    } else {
      const pct = ((cur - prev) / Math.abs(prev)) * 100
      if (pct === 0) delta = { sign: 'flat', text: '0%' }
      else delta = formatDeltaPct(pct)
    }
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="cv-inline">
        <CvIcon name="fuel" iconId={icon} color={iconColor} />
        <div className="cv-inline-body">
          <div className="cv-row-mini">
            <span className="cv-sub">{bLabel(options, 0, 'Current')}</span>
          </div>
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
  // Multivalue Card 1 carries a unit PER binding (no card-level unit).
  const { title, style, iconColor, icon } = useCardChrome(options, {
    title: 'Conf Room Data Trend', icon: '',
  })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="cv-inline">
        <CvIcon name="thermometer" iconId={icon} color={iconColor} size="lg" />
        <div className="cv-grid-2x2">
          <Stat label={bLabel(options, 0, 'Minimum')}    value={bValue(options, 0, '14.2')} unit={bUnit(options, 0, 'Celcius')} />
          <Stat label={bLabel(options, 1, 'Last Value')} value={bValue(options, 1, '14.4')} unit={bUnit(options, 1, 'Celcius')} />
          <Stat label={bLabel(options, 2, 'Maximum')}    value={bValue(options, 2, '30.2')} unit={bUnit(options, 2, 'Celcius')} />
          <Stat label={bLabel(options, 3, 'Average')}    value={bValue(options, 3, '18.4')} unit={bUnit(options, 3, 'Celcius')} />
        </div>
      </div>
    </CvCard>
  )
}

function PreviewMultivalueRow({ options = {} }) {
  // Multivalue Card 2 carries a unit PER binding (no card-level unit).
  const { title, style, iconColor } = useCardChrome(options, {
    title: 'Conf Room Data Trend',
  })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="cv-row-3">
        <StatStacked icon="bolt"        iconId={bIcon(options, 0, '')} color={iconColor}
          label={bLabel(options, 0, 'Odometer - Last Value')} value={bValue(options, 0, '14.4')} unit={bUnit(options, 0, 'Celcius')} />
        <StatStacked icon="drop"        iconId={bIcon(options, 1, '')} color={iconColor}
          label={bLabel(options, 1, 'Heat Level - Maximum')} value={bValue(options, 1, '18.4')} unit={bUnit(options, 1, 'Celcius')} />
        <StatStacked icon="speedometer" iconId={bIcon(options, 2, '')} color={iconColor}
          label={bLabel(options, 2, 'RPM- Average')} value={bValue(options, 2, '30.2')} unit={bUnit(options, 2, 'Celcius')} />
      </div>
    </CvCard>
  )
}

function PreviewMultivalueAssorted({ options = {} }) {
  const { title, style, iconColor } = useCardChrome(options, { title: 'Conf Room Details' })
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="cv-row-2">
        <div className="cv-inline">
          <CvIcon name="thermometer" iconId={bIcon(options, 0, '')} color={iconColor} />
          <Stat label={bLabel(options, 0, 'Sum (Today)')} value={bValue(options, 0, '14.4')} unit={bUnit(options, 0, 'Celcius')} unitBelow />
        </div>
        <div className="cv-inline">
          <CvIcon name="bell" iconId={bIcon(options, 1, '')} color={iconColor} />
          <Stat label={bLabel(options, 1, 'Alarms')} value={bValue(options, 1, '12')} unit={bUnit(options, 1, 'Count')} unitBelow />
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
    // Divide by the magnitude so the sign always reflects the direction:
    // current greater than previous → +, smaller → −.
    const pct = ((cur - trend) / Math.abs(trend)) * 100
    delta = formatDeltaPct(pct)
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
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
  const isLive  = !!options.devicesById
  const liveVal = resolveBindingValue(options.bindings?.[0], options.devicesById)
  const totalVal = resolveBindingValue(options.bindings?.[1], options.devicesById)
  // Picked bar color from the ICON_COLORS palette. Two-stop gradient
  // (chosen hex → 35% lighter via color-mix) gives the bar more depth
  // than a flat fill while staying readable on any card background.
  const barHex = getIconColor(options.barColor).hex
  const barFill = `linear-gradient(90deg, ${barHex} 0%, color-mix(in srgb, ${barHex} 65%, white) 100%)`
  // Picker preview defaults — replaced by computed values when both
  // bindings resolve to numbers on the dashboard.
  const doneLbl = options.doneLabel || 'done'
  const leftLbl = options.leftLabel || 'left'
  let percent      = 68
  let valueText    = '68%'
  let targetText   = '5,000'
  let doneText     = `3,400 ${doneLbl}`
  let leftText     = `1,600 ${leftLbl}`
  if (typeof liveVal === 'number' && typeof totalVal === 'number' && totalVal > 0) {
    percent    = Math.max(0, Math.min(100, (liveVal / totalVal) * 100))
    valueText  = `${percent.toFixed(0)}%`
    targetText = formatValue(totalVal)
    doneText   = `${formatValue(liveVal)} ${doneLbl}`
    leftText   = `${formatValue(Math.max(0, totalVal - liveVal))} ${leftLbl}`
  } else if (isLive) {
    // At least one binding doesn't resolve — show "-" instead of
    // sample values so the user can tell the card has no live data.
    percent    = 0
    valueText  = typeof liveVal === 'number' ? formatValue(liveVal) : '-'
    targetText = typeof totalVal === 'number' ? formatValue(totalVal) : '-'
    doneText   = '-'
    leftText   = '-'
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="cv-stack">
        <div className="cv-progress-row">
          <span className="cv-big">{valueText}</span>
          <span className="cv-sub">of {targetText}</span>
        </div>
        <div className="cv-bar"><span style={{ width: `${percent}%`, background: barFill }} /></div>
        <div className="cv-progress-foot">
          <span className="cv-sub">{doneText}</span>
          <span className="cv-sub">{leftText}</span>
        </div>
      </div>
    </CvCard>
  )
}

function Stat({ label, value, unit, unitBelow = false }) {
  return (
    <div className="cv-stat">
      <div className="cv-stat-label">{label}</div>
      <div className={'cv-stat-line' + (unitBelow ? ' cv-stat-line-stacked' : '')}>
        <span className="cv-mid">{value}</span>
        {unit && <span className={'cv-unit' + (unitBelow ? ' cv-unit-below' : '')}>{unit}</span>}
      </div>
    </div>
  )
}

function StatStacked({ icon, iconId, color, label, value, unit }) {
  return (
    <div className="cv-stat-stacked">
      <CvIcon name={icon} iconId={iconId} color={color} />
      <div className="cv-stat-label cv-stat-label-center">{label}</div>
      <div className="cv-stat-line cv-stat-line-stacked">
        <span className="cv-mid">{value}</span>
        {unit && <span className="cv-unit cv-unit-below">{unit}</span>}
      </div>
    </div>
  )
}

function CvIcon({ name, iconId, color, size = 'md' }) {
  // 'none' is the explicit "no icon" sentinel — render nothing (not even the
  // fallback glyph) so a widget can opt out of an icon entirely.
  if (iconId === 'none' || name === 'none') return null
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
    case 'controls': return (
      <svg {...s}>
        {/* a slider track with a circular knob — visual shorthand for "input controls" */}
        <rect x="3.5" y="10.5" width="17" height="3" rx="1.5" stroke={stroke} strokeWidth={sw} />
        <circle cx="15" cy="12" r="3" stroke={stroke} strokeWidth={sw} fill="none" />
        <circle cx="15" cy="12" r="1.3" fill={stroke} />
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
    case 'logs': return (
      <svg {...s}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke={stroke} strokeWidth={sw} />
        <path d="M7 9h7M7 12h10M7 15h6" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
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
