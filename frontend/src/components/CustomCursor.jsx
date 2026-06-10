import { useEffect, useRef } from 'react'

/**
 * Animated custom cursor (kiosk chrome).
 *
 * Renders an instant accent dot + a trailing ring that eases behind it.
 * Effects:
 *   • idle  — dot glows softly, ring trails with spring easing
 *   • hover — over any interactive element the ring expands + fills
 *   • down  — ring contracts, dot enlarges (tactile press)
 *   • click — a ripple pulses out from the ring
 *
 * Only enabled on fine pointers (mouse) and when reduced-motion is off —
 * otherwise the CSS fallback cursors in index.css remain in effect.
 */
const INTERACTIVE =
  'a[href], button, [role="button"], label, summary, select, input, textarea, ' +
  '.pf-mock-tab, .pf-feed-launch, .pf-proto-step, .pf-intel-card, .pf-feed-card, ' +
  '.pf-aud-card, .pf-nav-iconbtn, .pf-hero-scroll'

export default function CustomCursor() {
  const dotRef = useRef(null)
  const ringRef = useRef(null)
  const raf = useRef(0)
  const state = useRef({ x: 0, y: 0, rx: 0, ry: 0, shown: false })

  useEffect(() => {
    const mqFine = window.matchMedia?.('(pointer: fine)')
    const mqReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mqFine?.matches || mqReduce?.matches) return undefined

    const root = document.documentElement
    const dot = dotRef.current
    const ring = ringRef.current
    const s = state.current
    root.classList.add('kc-cursor-on')

    const onMove = (e) => {
      s.x = e.clientX
      s.y = e.clientY
      if (!s.shown) {
        s.shown = true
        s.rx = s.x
        s.ry = s.y
        root.classList.add('kc-cursor-show')
      }
      const hit = e.target.closest?.(INTERACTIVE)
      root.classList.toggle('kc-cursor-hover', !!hit)
    }
    const onDown = () => root.classList.add('kc-cursor-down')
    const onUp = () => {
      root.classList.remove('kc-cursor-down')
      root.classList.add('kc-cursor-click')
      window.setTimeout(() => root.classList.remove('kc-cursor-click'), 460)
    }
    const onLeave = () => { s.shown = false; root.classList.remove('kc-cursor-show') }

    const tick = () => {
      s.rx += (s.x - s.rx) * 0.18
      s.ry += (s.y - s.ry) * 0.18
      if (dot) dot.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) translate(-50%, -50%)`
      if (ring) ring.style.transform = `translate3d(${s.rx}px, ${s.ry}px, 0) translate(-50%, -50%)`
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    document.addEventListener('mouseleave', onLeave)

    return () => {
      cancelAnimationFrame(raf.current)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onLeave)
      root.classList.remove(
        'kc-cursor-on', 'kc-cursor-show', 'kc-cursor-hover',
        'kc-cursor-down', 'kc-cursor-click',
      )
    }
  }, [])

  return (
    <>
      <div ref={ringRef} className="kc-cursor-ring" aria-hidden="true" />
      <div ref={dotRef} className="kc-cursor-dot" aria-hidden="true" />
    </>
  )
}
