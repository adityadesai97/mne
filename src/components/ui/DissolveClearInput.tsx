import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppTheme } from '@/hooks/useAppTheme'

interface DissolveClearInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Optional leading icon, absolutely positioned the same way the search
   *  icon on the existing field was — stacked above the glow layer so it
   *  never gets tinted by it. */
  icon?: ReactNode
  /** Background, border, radius, focus ring — the field's outer chrome. */
  wrapperClassName?: string
  /** Padding, text size/leading — applied identically to the real input,
   *  the mirror, and the fake placeholder so all three sit in the exact
   *  same text position and swapping between them is invisible. */
  fieldClassName?: string
  'aria-label'?: string
  clearAriaLabel?: string
}

// Minimal cubic-bezier(x1,y1,x2,y2) sampler so the JS-driven easing matches
// the curve transitions.dev tunes for this effect (Newton's method on the
// bezier parametrization — same approach the source snippet uses).
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let s = t
    for (let i = 0; i < 8; i++) {
      const dx = ((ax * s + bx) * s + cx) * s - t
      const d = (3 * ax * s + 2 * bx) * s + cx
      if (Math.abs(dx) < 1e-6 || d === 0) break
      s -= dx / d
    }
    return ((ay * s + by) * s + cy) * s
  }
}

// transitions.dev's tuned defaults for this transition (--clear-* variables).
const EASE = bezier(0.22, 1, 0.36, 1)
const TOTAL_MS = 1000
const OUT_DUR = 400
const IN_DUR = 400
const OUT_FLY = 12
const IN_FLY = 12
const BLUR_PX = 2
const GLOW_DELAY = 50
const GLOW_PEAK_AT = 0.15
const GLOW_SPREAD = 1.5
// Dark-mode variant per the source doc's "Dark mode" note: multiply vanishes
// on a dark surface, so flip to screen and paint white instead of black,
// with a stronger opacity ceiling to read at the same visual weight.
const GLOW_OPACITY = { light: 0.42, dark: 0.85 }

/**
 * A text input whose clear (×) button dissolves the typed text instead of
 * just vanishing it: the text flies down + blurs + fades while a soft
 * per-word streak glows under each word, and the placeholder falls in from
 * above. Ported from transitions.dev's "input clear with dissolve" — the
 * streak's rise/peak/fall envelope and per-word gradient stack are driven
 * per-frame in JS because they can't be expressed as a static @keyframe.
 *
 * `theme="auto"`-equivalent: reads the app's resolved dark/light class via
 * useAppTheme (the source snippet's own theme check reads a `data-theme`
 * attribute, which this app doesn't set — see src/lib/theme.ts).
 */
export function DissolveClearInput({
  value,
  onChange,
  placeholder,
  icon,
  wrapperClassName,
  fieldClassName,
  'aria-label': ariaLabel,
  clearAriaLabel = 'Clear',
}: DissolveClearInputProps) {
  const theme = useAppTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const clearingRef = useRef(false)
  const rafRef = useRef(0)
  const [clearing, setClearing] = useState(false)

  const hasValue = value.length > 0

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // The real input's own glyphs render transparent whenever there's a value
  // (see the input's className below) — the mirror is what's actually
  // visible, so it has to track the live value on every keystroke, not just
  // during a clear. Skipped mid-animation: handleClear owns the mirror's
  // content directly while the dissolve plays.
  useEffect(() => {
    const mirror = mirrorRef.current
    if (!mirror || clearingRef.current) return
    mirror.textContent = hasValue ? value.replace(/ /g, ' ') : ''
  }, [value, hasValue])

  function buildGlow(text: string): string {
    const wrap = wrapRef.current
    const input = inputRef.current
    if (!wrap || !input) return ''
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return ''
    ctx.font = getComputedStyle(input).font
    const rgb = theme === 'dark' ? '255,255,255' : '0,0,0'
    const w = wrap.clientWidth || 280
    const padLeft = parseFloat(getComputedStyle(input).paddingLeft) || 12
    const layers: string[] = []
    let x = 0
    for (const seg of text.split(/(\s+)/)) {
      const segW = ctx.measureText(seg).width
      if (seg.trim()) {
        const cx = padLeft + x + segW / 2
        const hw = Math.max(segW * 0.45, 8) * GLOW_SPREAD
        const spots: Array<[number, number, number, number]> = [
          [0, 0.8, 7, 0.22],
          [hw * 0.45, 0.55, 8, 0.18],
          [-hw * 0.4, 0.65, 6, 0.16],
          [hw * 0.15, 0.9, 5, 0.14],
        ]
        for (const [dx, rwm, rh, a] of spots) {
          const lx = (((cx + dx) / w) * 100).toFixed(2)
          layers.push(`radial-gradient(ellipse ${Math.max(hw * rwm, 2).toFixed(1)}px ${rh}px at ${lx}% 100%, rgba(${rgb},${a}), transparent)`)
        }
      }
      x += segW
    }
    return layers.join(', ')
  }

  function handleClear() {
    const input = inputRef.current
    const mirror = mirrorRef.current
    const phold = placeholderRef.current
    const glow = glowRef.current
    const wrap = wrapRef.current
    if (!input || !mirror || !phold || !glow || !wrap || clearingRef.current || !value) return

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onChange('')
      return
    }

    clearingRef.current = true
    setClearing(true)
    const keepFocus = document.activeElement === input
    const text = value.replace(/ /g, ' ')
    mirror.textContent = text
    wrap.classList.add('is-clearing')
    glow.style.background = buildGlow(text)
    glow.style.opacity = '0'
    phold.style.transform = `translateY(-${IN_FLY}px)`
    phold.style.opacity = '0.9'
    phold.style.filter = `blur(${BLUR_PX}px)`

    // The controlled value clears immediately — the mirror carries the
    // outgoing text visually while the real input's glyphs stay hidden.
    onChange('')

    const glowOpacity = GLOW_OPACITY[theme]
    const t0 = performance.now()
    const tick = (now: number) => {
      const el = now - t0
      const eo = EASE(Math.min(1, el / OUT_DUR))
      mirror.style.transform = `translateY(${(eo * OUT_FLY).toFixed(1)}px)`
      mirror.style.opacity = (1 - eo).toFixed(3)
      mirror.style.filter = `blur(${(eo * BLUR_PX).toFixed(1)}px)`

      const ei = EASE(Math.min(1, el / IN_DUR))
      phold.style.transform = `translateY(${(-IN_FLY + ei * IN_FLY).toFixed(1)}px)`
      phold.style.opacity = (0.9 + ei * 0.1).toFixed(3)
      phold.style.filter = `blur(${(BLUR_PX - ei * BLUR_PX).toFixed(1)}px)`

      let g = 0
      if (el > GLOW_DELAY) {
        const gp = Math.min(1, (el - GLOW_DELAY) / Math.max(1, TOTAL_MS - GLOW_DELAY))
        g = gp < GLOW_PEAK_AT ? gp / GLOW_PEAK_AT : 1 - (gp - GLOW_PEAK_AT) / (1 - GLOW_PEAK_AT)
      }
      glow.style.opacity = (g * glowOpacity).toFixed(3)

      if (el < TOTAL_MS) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        wrap.classList.remove('is-clearing')
        mirror.style.cssText = ''
        phold.style.cssText = ''
        mirror.textContent = ''
        glow.style.opacity = '0'
        glow.style.background = ''
        clearingRef.current = false
        setClearing(false)
        if (keepFocus) requestAnimationFrame(() => input.focus({ preventScroll: true }))
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  return (
    <div ref={wrapRef} className={cn('relative overflow-hidden', wrapperClassName)}>
      {icon}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          'relative z-[1] block w-full bg-transparent outline-none',
          hasValue && '[-webkit-text-fill-color:transparent]',
          fieldClassName,
        )}
      />
      <div
        ref={mirrorRef}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 z-[2] flex items-center overflow-hidden whitespace-nowrap',
          hasValue ? 'opacity-100' : 'opacity-0',
          fieldClassName,
        )}
      />
      <div
        ref={placeholderRef}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 z-[2] flex items-center overflow-hidden whitespace-nowrap text-muted-foreground',
          hasValue ? 'opacity-0' : 'opacity-100',
          fieldClassName,
        )}
      >
        {placeholder}
      </div>
      {/* Streak overlay: JS writes a stack of radial-gradient(...) layers into
          background during a clear, then animates opacity. multiply darkens
          the surface underneath in light mode; screen lightens it in dark
          mode (multiply over a dark surface would otherwise vanish). */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[3] opacity-0"
        style={{ mixBlendMode: theme === 'dark' ? 'screen' : 'multiply' }}
      />
      {/* Stays mounted through the ~1s dissolve (not just while hasValue) so
          it doesn't pop out the instant the value clears, ahead of the text
          it's meant to be triggering. */}
      <AnimatePresence>
        {(hasValue || clearing) && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: clearing ? 0 : 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={clearing ? { duration: OUT_DUR / 1000 } : undefined}
            onClick={handleClear}
            aria-label={clearAriaLabel}
            className="absolute right-3 top-1/2 z-[4] -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={15} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
