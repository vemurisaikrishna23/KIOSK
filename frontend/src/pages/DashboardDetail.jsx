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
  return VARIANT_LAYOUT_DEFAULTS[variant] || CONTROL_LAYOUT_DEFAULTS[variant] || DIAL_LAYOUT_DEFAULTS[variant] || FILL_LAYOUT_DEFAULTS[variant] || CHART_LAYOUT_DEFAULTS[variant] || DEFAULT_WIDGET_LAYOUT
}
function isControlVariant(v) { return !!(v && CONTROL_VARIANT_DEFS[v]) }
function isCardVariant(v)    { return !!(v && CARD_VARIANT_DEFS[v]) }
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
function getIconColor(id)   { return ICON_COLORS.find((c) => c.id === id) || ICON_COLORS[0] }

/* Dashboard-level palettes. Each theme drives:
   – panel gradients (.db-group, .db-group-bottom)
   – cell tint + border
   – accent (the floating "+" add-widget button)
   – default card / icon color for newly-added widgets, so widgets
     inherit the dashboard's mood unless the user picks otherwise. */
const DASHBOARD_THEMES = [
  {
    id: 'peach', label: 'Peach',
    pageBg:     '#F0DCB8',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(255,222,192,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(255,240,220,0.45), transparent 70%), linear-gradient(170deg, #FFFBF5 0%, #FCEFD9 60%, #F8E0BC 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(255,222,192,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(255,240,220,0.45), transparent 70%), linear-gradient(190deg, #FFFDF8 0%, #FCF3E3 60%, #F8E4C6 100%)',
    border:     'rgba(246, 228, 208, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.50)',
    cellBorder: 'rgba(244, 212, 175, 0.55)',
    accent:     '#F36A1E',
    accentLight:'#FF8A47',
    accentDeep: '#D85510',
    defaultCardColor: 'peach',
    defaultIconColor: 'orange',
  },
  {
    id: 'ocean', label: 'Ocean',
    pageBg:     '#D7E5F2',
    panelBg:    'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(180,210,250,0.55), transparent 65%), radial-gradient(ellipse 110% 70% at 0% 100%, rgba(220,235,250,0.45), transparent 70%), linear-gradient(170deg, #F5FAFE 0%, #E0EDFB 60%, #B7D5FA 100%)',
    bottomBg:   'radial-gradient(ellipse 110% 80% at 0% 0%, rgba(180,210,250,0.55), transparent 65%), radial-gradient(ellipse 120% 70% at 100% 100%, rgba(220,235,250,0.45), transparent 70%), linear-gradient(190deg, #F7FBFE 0%, #E3EFFB 60%, #BBD8FA 100%)',
    border:     'rgba(190, 215, 245, 0.85)',
    cellBg:     'rgba(255, 255, 255, 0.55)',
    cellBorder: 'rgba(180, 210, 245, 0.55)',
    accent:     '#2D6EE0',
    accentLight:'#5089E8',
    accentDeep: '#1F54B5',
    defaultCardColor: 'sky',
    defaultIconColor: 'blue',
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
function getTheme(id) { return DASHBOARD_THEMES.find((t) => t.id === id) || DASHBOARD_THEMES[0] }
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
function cardStyleFor(colorId) {
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
    try { return localStorage.getItem(themeKey) || 'peach' } catch { return 'peach' }
  })
  // Tracks the last theme we know the server already has, so the
  // auto-PATCH effect doesn't fire for changes that came FROM the
  // server (initial load + cross-tab sync).
  const themePersistRef = useRef(themeId)

  // Adopt server theme once the dashboard loads.
  useEffect(() => {
    const serverTheme = dashboard?.theme
    if (serverTheme && serverTheme !== themeId) {
      themePersistRef.current = serverTheme
      setThemeId(serverTheme)
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

  const activeTheme = getTheme(themeId)
  const themeVars   = themeCssVars(activeTheme)

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
  }, [])

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
  const sendDashboardCommand = useCallback((deviceId, action, path, payload) => {
    const ws = dashboardWsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setToast({ type: 'error', text: 'Not connected — try again in a moment.' })
      return false
    }
    const msg = { device_id: Number(deviceId), action, path: String(path || '') }
    if (action !== 'delete') msg.payload = payload
    try { ws.send(JSON.stringify(msg)); return true } catch { return false }
  }, [])

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
      dashboardWsRef.current = ws

      ws.onopen = () => {
        attempt = 0
        // eslint-disable-next-line no-console
        console.debug('[dashboard-ws] connected')
      }
      ws.onclose = (ev) => {
        // eslint-disable-next-line no-console
        console.debug('[dashboard-ws] closed', ev?.code, ev?.reason)
        if (dashboardWsRef.current === ws) dashboardWsRef.current = null
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
        const cols = c2Cols
        const perRow = Math.max(1, Math.floor(cols / defaults.w))
        const idx = c2Components.length
        initialLayout = {
          x: (idx % perRow) * defaults.w,
          y: Math.floor(idx / perRow) * defaults.h,
          w: defaults.w,
          h: defaults.h,
        }
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
    <div className={'kiosk-app' + (previewMode ? ' is-db-preview' : '') + (publicMode ? ' is-public' : '')} style={themeVars}>
      {!publicMode && <TopBar />}

      <div className={'admin-page db-page' + (previewMode ? ' is-preview' : '')}>
        {!previewMode && (
          <div className="db-page-actions-row">
            <Link to={publicMode ? '/public' : `/applications/${appId}`} className="back-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {publicMode ? 'Back to Applications' : 'Back to Application'}
            </Link>
            {!publicMode && (
            <div className="db-theme-picker" role="group" aria-label="Dashboard theme">
              <span className="db-theme-picker-label">Theme</span>
              {DASHBOARD_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={'db-theme-swatch' + (themeId === t.id ? ' is-active' : '')}
                  style={{ background: t.panelBg, borderColor: t.border }}
                  title={t.label}
                  aria-label={t.label}
                  aria-pressed={themeId === t.id}
                  onClick={() => setThemeId(t.id)}
                />
              ))}
            </div>
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
            {publicMode && dashboard?.dashboard_name && (
              <span className="db-public-title">{dashboard.dashboard_name}</span>
            )}
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

            <div className="db-shell" ref={previewShellRef} style={themeVars}>
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
                                    canUpdate={canUpdate && !previewMode}
                                    canDelete={canDelete && !previewMode}
                                    sendCommand={sendDashboardCommand}
                                    onEdit={() => {
                                      // Card- AND control-variant widgets go through
                                      // the new picker-driven configure (preserves
                                      // variant + layout). Legacy widgets fall back
                                      // to the old form.
                                      const v = c?.config?.variant
                                      if (v && (CARD_VARIANT_DEFS[v] || CONTROL_VARIANT_DEFS[v] || DIAL_VARIANT_DEFS[v] || FILL_VARIANT_DEFS[v] || CHART_VARIANT_DEFS[v])) {
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
              <section className="db-group db-group-bottom db-c3">
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
                                  canUpdate={canUpdate && !previewMode}
                                  canDelete={canDelete && !previewMode}
                                  sendCommand={sendDashboardCommand}
                                  onEdit={() => {
                                    const v = c?.config?.variant
                                    if (v && (CARD_VARIANT_DEFS[v] || CONTROL_VARIANT_DEFS[v] || DIAL_VARIANT_DEFS[v] || FILL_VARIANT_DEFS[v] || CHART_VARIANT_DEFS[v])) {
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
                {canUpdate && !previewMode && (
                  <button type="button" className="db-c2-add db-c3-add"
                    onClick={() => openWidgetCreate(3)} aria-label="Add widget" title="Add widget to bottom panel">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </section>
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
          onClose={() => { setPickerOpen(false); setEditingWidget(null); setTargetContainer(2) }}
          devices={devices}
          initialComponent={editingWidget}
          themeDefaults={{
            cardColor: activeTheme.defaultCardColor,
            iconColor: activeTheme.defaultIconColor,
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

function DashWidgetView({ component, devicesById, canUpdate, canDelete, onEdit, onDelete, sendCommand }) {
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
        {(canUpdate || canDelete) && (
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
        {(canUpdate || canDelete) && (
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
function CellGrid({ cols = 10, rows = 7, fixedCols = false, cellW = null }) {
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
      <div className="db-cam-head">
        <div className="db-cam-head-title">
          <h2>
            {active?.camera_name || 'Live feed'}
            {active?.is_primary && <span className="db-cam-head-badge">primary</span>}
          </h2>
        </div>
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
]

function WidgetPickerModal({ onClose, devices, onSubmit, initialComponent, themeDefaults }) {
  const isEditing = !!initialComponent
  // Edit mode: jump straight to the variant configure view, skip the
  // gallery, and don't let the user change variant (would invalidate
  // the bindings).
  const initVariant = initialComponent?.config?.variant || null
  const [selected, setSelected] = useState(
    initVariant ? (isControlVariant(initVariant) ? 'controls' : isChartVariant(initVariant) ? 'charts' : isDialVariant(initVariant) ? 'dials' : isFillVariant(initVariant) ? 'custom_fill' : 'cards') : 'cards'
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
    fields: [{ key: 'target', label: 'Target binding', withToggleValues: true }],
    hasIcon: true,
    sampleTitle: 'Bedroom Light',
    sampleSub:   'Tap to toggle',
  },
  // ── Dual toggle — two independent boolean controls ──
  dual_toggle: {
    title: 'Dual Toggle',
    fields: [
      { key: 'target_a', label: 'Toggle A', withToggleValues: true },
      { key: 'target_b', label: 'Toggle B', withToggleValues: true },
    ],
    hasIcon: true,
    sampleTitle: 'Room Control',
    sampleSub:   'Two switches',
  },
  // ── Press switch — momentary push button ──────────
  press_switch: {
    title: 'Press Switch',
    fields: [{ key: 'target', label: 'Target binding', withToggleValues: true }],
    hasIcon: true,
    sampleTitle: 'Power',
    sampleSub:   'Push to toggle',
  },
  // ── Single-shot action buttons ─────────────────────
  single_button: {
    title: 'Action Card',
    fields: [{ key: 'target', label: 'Target binding', withToggleValues: true }],
    hasIcon: true,
    hasButtonLabel: true,          // user-configurable button text
    sampleTitle: 'Room Light',
    sampleSub:   'Tap to toggle',
  },
  // ── Multiple actions in a single card ──────────────
  multi_button: {
    title: 'Multi Action',
    fields: [{ key: 'target', label: 'Target binding' }],
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
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['int', 'float'] }],
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
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['string'] }],
    hasIcon: true,
    sampleTitle: 'Device Name',
    sampleSub:   'Type + send',
  },
  // ── Number entry (with unit) ───────────────────────
  number_input: {
    title: 'Number Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['int', 'float'] }],
    hasUnit: true,
    hasIcon: true,
    sampleTitle: 'Set Temperature',
    sampleSub:   'Type + send',
  },
  list_input: {
    title: 'List Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['list'] }],
    hasIcon: true,
    sampleTitle: 'Config List',
    sampleSub:   'JSON array + send',
  },
  json_input: {
    title: 'JSON Entry',
    fields: [{ key: 'target', label: 'Target binding', allowedTypes: ['dict'] }],
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
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Battery', sampleVal: 80,
  },
  tank_rect_fill: {
    title: 'Level Tank 1',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Level Tank 1', sampleVal: 40,
  },
  tank_sphere_fill: {
    title: 'Level Tank 2',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
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
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Vehicle Speed', sampleVal: 50,
  },
  semi_dial: {
    title: 'Semi Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Vehicle Speed', sampleVal: 50,
  },
  full_dial: {
    title: 'Full Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Motor Speed', sampleVal: 110,
  },
  progress_dial: {
    title: 'Progress Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Engine Power', sampleVal: 3520,
  },
  threshold_dial: {
    title: 'Threshold Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
    hasMinMax: true, hasUnit: true, hasIcon: false,
    sampleTitle: 'Engine Power', sampleVal: 2025,
  },
  full_circle_dial: {
    title: 'Full Circle Dial',
    fields: [{ key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] }],
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
    fields: [{ key: 'value', label: 'Value source', withBoolLabels: true }],
    hasIcon: false,
    hasUnit: false,
    sampleTitle: 'Engine Temperature',
    sampleSub: 'Temperature',
  },
  simple_icon: {
    title: 'Simple Card 2',
    fields: [{ key: 'value', label: 'Value source', withBoolLabels: true }],
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
      { key: 'm1', label: 'Minimum',    allowedTypes: ['int', 'float', 'boolean'], withBoolLabels: true },
      { key: 'm2', label: 'Last Value', allowedTypes: ['int', 'float', 'boolean'], withBoolLabels: true },
      { key: 'm3', label: 'Maximum',    allowedTypes: ['int', 'float', 'boolean'], withBoolLabels: true },
      { key: 'm4', label: 'Average',    allowedTypes: ['int', 'float', 'boolean'], withBoolLabels: true },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Conf Room Data Trend',
  },
  multivalue_row: {
    title: 'Multivalue Card 2',
    fields: [
      { key: 'm1', label: 'Metric 1', withIcon: true, withBoolLabels: true },
      { key: 'm2', label: 'Metric 2', withIcon: true, withBoolLabels: true },
      { key: 'm3', label: 'Metric 3', withIcon: true, withBoolLabels: true },
    ],
    hasIcon: false,
    hasUnit: true,
    sampleTitle: 'Conf Room Data Trend',
  },
  multivalue_assorted: {
    title: 'Multivalue Card 3 (Assorted)',
    fields: [
      { key: 'm1', label: 'Metric 1', withIcon: true, withBoolLabels: true },
      { key: 'm2', label: 'Metric 2', withIcon: true, withBoolLabels: true },
    ],
    hasIcon: false,
    hasUnit: false,
    sampleTitle: 'Conf Room Details',
  },
  trend: {
    title: 'Trend Card',
    fields: [
      { key: 'value', label: 'Value source', allowedTypes: ['int', 'float'] },
      // Trend / delta source must be the SAME numeric type as the value
      // source so percentage deltas are meaningful. The actual allowedTypes
      // here are narrowed at runtime in CardConfigure based on the first
      // binding's resolved type (see effectiveAllowedTypes).
      { key: 'trend', label: 'Trend / delta source (optional)', allowedTypes: ['int', 'float'], matchTypeOfFirst: true },
    ],
    hasIcon: true,
    hasUnit: true,
    sampleTitle: 'Production Rate',
  },
  progress: {
    title: 'Progress Card',
    fields: [
      { key: 'value', label: 'Current value source', allowedTypes: ['int', 'float'] },
      { key: 'total', label: 'Total / target value source', allowedTypes: ['int', 'float'], matchTypeOfFirst: true },
    ],
    hasIcon: false,
    hasUnit: false,
    // No static target field — both current AND total now come from
    // live payload bindings, so the percentage is always derived from
    // real device values.
    hasBarColor: true,        // surfaces a colour picker for the bar fill
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
  const [bindings, setBindings] = useState(() =>
    def.fields.map((_, i) => {
      const ex = initBindings[i]
      return ex
        ? {
            device_id: ex.device_id != null ? String(ex.device_id) : '',
            payload_path: ex.payload_path || '',
            label: ex.label || '',
            icon: ex.icon || '',
            on_label: ex.on_label || '',
            off_label: ex.off_label || '',
          }
        : { device_id: '', payload_path: '', label: '', icon: '', on_label: '', off_label: '' }
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
      description: description || '',
      variant,
      bindings: bindings.map((b, i) => ({
        device_id: Number(b.device_id),
        payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''),
        label: b.label || def.fields[i].label,
        icon: b.icon || '',
        // Custom labels for boolean values. Only meaningful when the
        // field can resolve to a boolean (see field.withBoolLabels).
        ...(b.on_label  ? { on_label: b.on_label }   : {}),
        ...(b.off_label ? { off_label: b.off_label } : {}),
      })),
      static: {
        ...(unit       ? { unit }       : {}),
        ...(icon       ? { icon }       : {}),
        ...(target     ? { target }     : {}),
        ...(pattern    ? { pattern }    : {}),
        ...(onLabel    ? { on_label: onLabel }   : {}),
        ...(offLabel   ? { off_label: offLabel } : {}),
        ...(barColor   ? { bar_color: barColor } : {}),
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
          {def.hasBarColor && (
            <div className="form-field">
              <span className="form-label">Progress bar color</span>
              <div className="color-swatches">
                {ICON_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={'color-swatch color-swatch-solid' + (barColor === c.id ? ' is-active' : '')}
                    style={{ background: c.hex }}
                    title={c.label}
                    aria-label={c.label}
                    aria-pressed={barColor === c.id}
                    onClick={() => setBarColor(c.id)}
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
  // changes). This covers both the first pick and subsequent picks —
  // the user should never have to manually set the type after picking
  // a new path; it adapts automatically.
  useEffect(() => {
    if (!field.withToggleValues || !detectedType) return
    const defs = TOGGLE_DEFAULTS[detectedType] || TOGGLE_DEFAULTS.string
    onChange('on_value', defs.on)
    onChange('off_value', defs.off)
    onChange('on_type', detectedType)
    onChange('off_type', detectedType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedType])

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
            allowedTypes={allowedTypes}
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
        {field.withToggleValues && (
          <>
            <DField label="Send when ON">
              <input type="text" value={binding.on_value || ''} disabled={disabled}
                onChange={(e) => onChange('on_value', e.target.value)}
                placeholder={TOGGLE_DEFAULTS[detectedType || 'boolean'].on} />
            </DField>
            <DField label="ON type">
              <select value={binding.on_type || detectedType || 'boolean'} disabled={disabled}
                onChange={(e) => onChange('on_type', e.target.value)}>
                <option value="boolean">boolean</option>
                <option value="string">string</option>
                <option value="int">int</option>
                <option value="float">float</option>
              </select>
            </DField>
            <DField label="Send when OFF">
              <input type="text" value={binding.off_value || ''} disabled={disabled}
                onChange={(e) => onChange('off_value', e.target.value)}
                placeholder={TOGGLE_DEFAULTS[detectedType || 'boolean'].off} />
            </DField>
            <DField label="OFF type">
              <select value={binding.off_type || detectedType || 'boolean'} disabled={disabled}
                onChange={(e) => onChange('off_type', e.target.value)}>
                <option value="boolean">boolean</option>
                <option value="string">string</option>
                <option value="int">int</option>
                <option value="float">float</option>
              </select>
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
    <div className="card-gallery">
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
    <div className="card-gallery">
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
  return { title, style, hex, min, max, unit, value, pct, display, icon: options.icon }
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
  const cx = 50, cy = 50, r = 40, sw = 10
  const startDeg = 180, sweepDeg = 180
  const arcPath = svgArc(cx, cy, r, startDeg, startDeg + sweepDeg)
  const totalLen = (sweepDeg / 360) * 2 * Math.PI * r
  const fillLen = totalLen * (d.pct / 100)
  const toRad = (deg) => (deg * Math.PI) / 180
  const valDeg = startDeg + (sweepDeg * d.pct / 100)
  const needleLen = r - 4
  const needleAngle = toRad(valDeg)
  const tipX = cx + needleLen * Math.cos(needleAngle)
  const tipY = cy + needleLen * Math.sin(needleAngle)
  const baseSpread = 2.5
  const perpAngle = needleAngle + Math.PI / 2
  const b1x = cx + baseSpread * Math.cos(perpAngle)
  const b1y = cy + baseSpread * Math.sin(perpAngle)
  const b2x = cx - baseSpread * Math.cos(perpAngle)
  const b2y = cy - baseSpread * Math.sin(perpAngle)
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="0 0 100 64">
          <path d={arcPath} fill="none" stroke={hexToRgba(d.hex, 0.12)}
            strokeWidth={sw} strokeLinecap="round" />
          <path d={arcPath} fill="none" stroke={d.hex}
            strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={`${fillLen} ${totalLen}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          <polygon
            points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
            fill="#2D3436"
            style={{ transition: 'all 0.6s ease' }} />
          <circle cx={cx} cy={cy} r={3.5} fill="#2D3436" />
          <circle cx={cx} cy={cy} r={1.5} fill="#fff" opacity={0.6} />
          <text x={cx - r - sw / 2} y={cy + sw + 4} textAnchor="start"
            className="dial-svg-label">{abbreviateNum(d.min)}</text>
          <text x={cx + r + sw / 2} y={cy + sw + 4} textAnchor="end"
            className="dial-svg-label">{abbreviateNum(d.max)}</text>
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{d.display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 2. Semi Dial — 180° arc with tick marks, numbers, needle ── */
function PreviewSemiDial({ options = {} }) {
  const d = useDialData(options, { title: 'Vehicle Speed' })
  const cx = 50, cy = 52, r = 38, sw = 5
  const startDeg = 180, sweepDeg = 180
  const toRad = (deg) => (deg * Math.PI) / 180
  const needleAngle = startDeg + (sweepDeg * d.pct / 100)
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
    if (isMajor) {
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
  const needleLen = r - 4
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
        <svg className="dial-svg" viewBox="-6 -2 112 66">
          <path d={trackPath} fill="none" stroke={hexToRgba(d.hex, 0.12)}
            strokeWidth={sw} strokeLinecap="round" />
          {ticks}
          <polygon
            points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
            fill="#2D3436"
            style={{ transition: 'all 0.6s ease' }} />
          <circle cx={cx} cy={cy} r={3.5} fill="#2D3436" />
          <circle cx={cx} cy={cy} r={1.5} fill="#fff" opacity={0.7} />
        </svg>
        <div className="dial-readout">
          <span className="dial-value">{d.display}</span>
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
    return <path key={i} d={svgArc(cx, cy, r, a1, a2)} fill="none"
      stroke={z.color} strokeWidth={sw} strokeLinecap={i === 0 ? 'round' : 'butt'} />
  })
  const unfilled = startDeg + sweepDeg * (Math.max(zones[zones.length - 1].to, 100) / 100)
  const needleAngle = startDeg + (sweepDeg * d.pct / 100)
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
            stroke={hexToRgba(d.hex, 0.08)} strokeWidth={sw} strokeLinecap="round" />
          {zoneArcs}
          <polygon
            points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
            fill="#2D3436"
            style={{ transition: 'all 0.6s ease' }} />
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
          <span className="dial-value">{d.display}</span>
          {d.unit && <span className="dial-unit">{d.unit}</span>}
        </div>
      </div>
    </CvCard>
  )
}

/* ── 5. Threshold Dial — 180° arc, color zones fill up to the value ── */
function PreviewThresholdDial({ options = {} }) {
  const d = useDialData(options, { title: 'Engine Power' })
  const cx = 50, cy = 52, r = 40, sw = 12
  const startDeg = 180, sweepDeg = 180
  const endDeg = startDeg + sweepDeg
  const valPct = d.pct
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
      strokeDasharray={`0 ${zoneStart} ${Math.max(0, zoneFill)} ${totalLen}`}
      style={{ transition: 'stroke-dasharray 0.6s ease' }} />
  })
  const rotateDeg = startDeg + (sweepDeg * valPct / 100)
  const tipColor = valPct >= 75 ? '#E74C3C' : valPct >= 50 ? '#F39C12' : '#27AE60'
  return (
    <CvCard style={d.style}>
      <div className="cv-title">{d.title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
      <div className="dial-wrap">
        <svg className="dial-svg" viewBox="0 0 100 72">
          <path d={arcPath} fill="none" stroke="rgba(0,0,0,0.08)"
            strokeWidth={sw} strokeLinecap="round" />
          {zoneArcs}
          <circle cx={cx + r} cy={cy} r={sw / 2} fill={tipColor}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              transform: `rotate(${rotateDeg}deg)`,
              transition: 'transform 0.6s ease, fill 0.3s ease',
            }} />
          <text x={cx - r - sw / 2} y={cy + sw / 2 + 10} textAnchor="start"
            className="dial-svg-label">{abbreviateNum(d.min)}</text>
          <text x={cx + r + sw / 2} y={cy + sw / 2 + 10} textAnchor="end"
            className="dial-svg-label">{abbreviateNum(d.max)}</text>
        </svg>
        <div className="dial-readout">
          <span className="dial-value dial-value-lg">{d.display}</span>
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
            <div className="color-swatches">
              {CARD_COLORS.map((c) => (
                <button key={c.id} type="button"
                  className={'color-swatch' + (cardColor === c.id ? ' is-active' : '')}
                  style={{ background: c.bg }} title={c.label}
                  aria-pressed={cardColor === c.id}
                  onClick={() => setCardColor(c.id)} disabled={saving} />
              ))}
            </div>
          </div>
          <div className="form-field">
            <span className="form-label">Gauge color</span>
            <div className="color-swatches">
              {ICON_COLORS.map((c) => (
                <button key={c.id} type="button"
                  className={'color-swatch color-swatch-solid' + (iconColor === c.id ? ' is-active' : '')}
                  style={{ background: c.hex }} title={c.label}
                  aria-pressed={iconColor === c.id}
                  onClick={() => setIconColor(c.id)} disabled={saving} />
              ))}
            </div>
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
            <div className="color-swatches">{CARD_COLORS.map((c) => (<button key={c.id} type="button" className={'color-swatch' + (cardColor === c.id ? ' is-active' : '')} style={{ background: c.bg }} title={c.label} aria-pressed={cardColor === c.id} onClick={() => setCardColor(c.id)} disabled={saving} />))}</div>
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
    <div className="card-gallery">
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
            <div className="color-swatches">{CARD_COLORS.map((c) => (<button key={c.id} type="button" className={'color-swatch' + (cardColor === c.id ? ' is-active' : '')} style={{ background: c.bg }} title={c.label} aria-pressed={cardColor === c.id} onClick={() => setCardColor(c.id)} disabled={saving} />))}</div>
          </div>
          <div className="form-field"><span className="form-label">Fill color</span>
            <div className="color-swatches">{ICON_COLORS.map((c) => (<button key={c.id} type="button" className={'color-swatch color-swatch-solid' + (iconColor === c.id ? ' is-active' : '')} style={{ background: c.hex }} title={c.label} aria-pressed={iconColor === c.id} onClick={() => setIconColor(c.id)} disabled={saving} />))}</div>
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
  return live != null && String(live) === String(onVal)
}

function PreviewSwitchControl({ options = {}, onCommand }) {
  const b    = options.bindings?.[0]
  const live = resolveBindingValue(b, options.devicesById)
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
  const isOnA = isToggleOn(liveA, cfgA.onVal)
  const isOnB = isToggleOn(liveB, cfgB.onVal)
  const isLive = !!onCommand
  function toggleA() {
    if (!isLive || !bA) return
    if (isOnA) dispatchWrite(onCommand, bA, cfgA.offType, cfgA.offVal, options.devicesById)
    else       dispatchWrite(onCommand, bA, cfgA.onType,  cfgA.onVal, options.devicesById)
  }
  function toggleB() {
    if (!isLive || !bB) return
    if (isOnB) dispatchWrite(onCommand, bB, cfgB.offType, cfgB.offVal, options.devicesById)
    else       dispatchWrite(onCommand, bB, cfgB.onType,  cfgB.onVal, options.devicesById)
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
            <div className="ctrl-dual-sub">{isLive ? (isOnA ? cfgA.onVal : cfgA.offVal) : 'Toggle'}</div>
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
            <div className="ctrl-dual-sub">{isLive ? (isOnB ? cfgB.onVal : cfgB.offVal) : 'Toggle'}</div>
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
  const live = resolveBindingValue(b, options.devicesById)
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
  const pressStyle = {
    background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.30), transparent 50%), linear-gradient(180deg, ${iconHex} 0%, color-mix(in srgb, ${iconHex} 70%, black) 100%)`,
    boxShadow: isOn
      ? `inset 0 2px 4px rgba(255,255,255,0.30), inset 0 -3px 6px rgba(0,0,0,0.22), 0 4px 8px rgba(0,0,0,0.18), 0 0 0 6px ${hexToRgba(iconHex, 0.22)}, 0 0 0 10px ${hexToRgba(iconHex, 0.10)}, 0 0 32px ${hexToRgba(iconHex, 0.40)}`
      : undefined,
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
    </div>
  )
}

/* ── Single Action Card — looks the same on preview and dashboard:
   icon + title + description + one full-width button with the user's
   custom label. Click toggles between on_value / off_value; active
   state is shown via the button's visual style (inverted colours),
   not by changing the button text. */
function PreviewSingleButtonControl({ options = {}, onCommand }) {
  const b    = options.bindings?.[0]
  const live = resolveBindingValue(b, options.devicesById)
  const { onVal, onType, offVal, offType } = getToggleConfig(b)
  const isOn = isToggleOn(live, onVal)
  const isLive = !!onCommand
  const label  = options.buttonLabel || 'Toggle'
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
      {isLive && (
        <div className="ctrl-send-hint">
          {isOn ? `ON → sends ${offVal}` : `OFF → sends ${onVal}`}
        </div>
      )}
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
              title={`Sends ${a.value}`}
            >
              {a.label}
              {isLive && <span className="ctrl-send-hint">→ {a.value}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
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
  function bump(d) {
    if (!isLive || !b) return
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
        <button type="button" className="ctrl-step-btn" onClick={() => bump(-1)} disabled={!isLive || value <= min} aria-label="decrease">−</button>
        <div className="ctrl-step-value">
          <span className="cv-big">{displayValue}</span>
          {options.unit && <span className="cv-unit">{options.unit}</span>}
        </div>
        <button type="button" className="ctrl-step-btn" onClick={() => bump(1)} disabled={!isLive || value >= max} aria-label="increase">+</button>
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

  function bump(d) {
    if (!isLive || !b) return
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
          <span className="cv-big">{displayValue}</span>
          {options.unit && <span className="cv-unit">{options.unit}</span>}
        </span>
      </div>
      <div className="ctrl-level-row">
        <button type="button" className="ctrl-step-btn" onClick={() => bump(-1)} disabled={!isLive || value <= min} aria-label="decrease">−</button>
        <div className="ctrl-level-track">
          <div className="ctrl-level-fill" style={{ width: `${pct}%` }} />
        </div>
        <button type="button" className="ctrl-step-btn" onClick={() => bump(1)} disabled={!isLive || value >= max} aria-label="increase">+</button>
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
        }
      : { device_id: '', payload_path: '', label: '', on_value: '', off_value: '', on_type: '', off_type: '' }
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
      if (!b.device_id)            fes[`bindings.${i}.device_id`]    = 'Pick a device.'
      if (!b.payload_path.trim())  fes[`bindings.${i}.payload_path`] = 'Required.'
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
      bindings: bindings.map((b, i) => ({
        device_id: Number(b.device_id),
        payload_path: b.payload_path.replace(/^\/+|\/+$/g, ''),
        label: b.label || (def.fields[i]?.label ?? 'Target'),
        ...(b.on_value  ? { on_value: b.on_value, on_type: b.on_type || 'boolean' } : {}),
        ...(b.off_value ? { off_value: b.off_value, off_type: b.off_type || 'boolean' } : {}),
        // Per-binding actions (multi_button).
        ...(Array.isArray(b.actions) && b.actions.length > 0
          ? { actions: b.actions.map((a) => ({ label: a.label, value: a.value, type: bindingTypes[i] || a.type || 'string' })) }
          : {}),
      })),
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
            <div className="color-swatches">
              {CARD_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'color-swatch' + (cardColor === c.id ? ' is-active' : '')}
                  style={{ background: c.bg }}
                  title={c.label}
                  aria-pressed={cardColor === c.id}
                  onClick={() => setCardColor(c.id)}
                  disabled={saving}
                />
              ))}
            </div>
          </div>
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
                  aria-pressed={iconColor === c.id}
                  onClick={() => setIconColor(c.id)}
                  disabled={saving}
                />
              ))}
            </div>
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
      else delta = { sign: pct > 0 ? 'up' : 'down', text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` }
    }
  }
  return (
    <CvCard style={style} pattern={options.pattern}>
      <div className="cv-title">{title}</div>
      {options.description && <div className="cv-desc">{options.description}</div>}
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
      {options.description && <div className="cv-desc">{options.description}</div>}
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
      {options.description && <div className="cv-desc">{options.description}</div>}
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
      {options.description && <div className="cv-desc">{options.description}</div>}
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
  let percent      = 68
  let valueText    = '68%'
  let targetText   = '5,000'
  let doneText     = '3,400 done'
  let leftText     = '1,600 left'
  if (typeof liveVal === 'number' && typeof totalVal === 'number' && totalVal > 0) {
    percent    = Math.max(0, Math.min(100, (liveVal / totalVal) * 100))
    valueText  = `${percent.toFixed(0)}%`
    targetText = formatValue(totalVal)
    doneText   = `${formatValue(liveVal)} done`
    leftText   = `${formatValue(Math.max(0, totalVal - liveVal))} left`
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
