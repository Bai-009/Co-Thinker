import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { morphSegments } from '../domain/morph'
import '../styles/lineage.css'

/**
 * 一句话在两个说法之间变形。正文照常排版，标点避头尾、选字都不受影响；
 * 动的那一下，在上面盖一层逐字的影子：要散的先散，留下的滑到新位置，新的从模糊里凝出来。动完揭掉影子。
 * `past` 为真时显示旧说法。children 跟在最后一个字后面（例如句末的上标）。
 */
export function Morph({ from, to, past, children }: { from: string; to: string; past: boolean; children?: ReactNode }) {
  const root = useRef<HTMLSpanElement>(null)
  const segments = useMemo(() => morphSegments(from, to), [from, to])
  const shown = useRef<boolean | null>(null)
  const stop = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    if (shown.current === null || shown.current === past) {
      el.classList.toggle('is-past', past)
      shown.current = past
      return
    }
    stop.current?.()
    stop.current = flip(el, () => el.classList.toggle('is-past', past))
    shown.current = past
  }, [past])

  // 换了文字（地基又改了一版），按当前状态摆好，不动画。
  useLayoutEffect(() => {
    root.current?.classList.toggle('is-past', shown.current ?? past)
  }, [segments]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => () => stop.current?.(), [])

  return (
    <span ref={root} className="ct-morph">
      {segments.map(([text, side], k) => (
        <span key={k} data-k={k} className={`ct-morph-tok is-${side}`}>
          {text}
        </span>
      ))}
      {children}
    </span>
  )
}

const EASE = 'cubic-bezier(0.22, 0.72, 0.18, 1)'

function tokenBoxes(root: HTMLElement) {
  const base = root.getBoundingClientRect()
  const out = new Map<string, { text: string; x: number; y: number }>()
  root.querySelectorAll<HTMLElement>('.ct-morph-tok').forEach((el) => {
    if (!el.textContent?.trim() || getComputedStyle(el).display === 'none') return
    const r = el.getBoundingClientRect()
    out.set(el.dataset.k ?? '', { text: el.textContent, x: r.left - base.left, y: r.top - base.top })
  })
  return out
}

/** 记下每个字现在的位置，切换，再记一次，让影子从旧位置走到新位置。返回一个能提前收场的函数。 */
function flip(root: HTMLElement, apply: () => void): () => void {
  const before = tokenBoxes(root)
  const h0 = root.offsetHeight
  apply()
  if (typeof root.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  const after = tokenBoxes(root)
  const h1 = root.offsetHeight

  const layer = document.createElement('span')
  layer.className = 'ct-morph-layer'
  layer.setAttribute('aria-hidden', 'true')
  root.appendChild(layer)
  root.classList.add('is-morphing')
  const shade = (text: string, x: number, y: number) => {
    const g = document.createElement('span')
    g.className = 'ct-morph-ghost'
    g.textContent = text
    g.style.left = `${x}px`
    g.style.top = `${y}px`
    layer.appendChild(g)
    return g
  }

  // 先吐后吸：要散的先散（0–240ms），留下的随后滑到新位置（120–680ms），新凝的最后到（320–840ms）。
  const anims: Animation[] = []
  before.forEach((b, k) => {
    if (after.has(k)) return
    anims.push(
      shade(b.text, b.x, b.y).animate(
        [
          { opacity: 1, filter: 'blur(0)', transform: 'none' },
          { opacity: 0, filter: 'blur(6px)', transform: 'translateY(-3px)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      ),
    )
  })
  after.forEach((a, k) => {
    const b = before.get(k)
    const g = shade(a.text, a.x, a.y)
    anims.push(
      b
        ? g.animate([{ transform: `translate(${b.x - a.x}px, ${b.y - a.y}px)` }, { transform: 'none' }], {
            duration: 560,
            delay: 120,
            easing: EASE,
            fill: 'both',
          })
        : g.animate(
            [
              { opacity: 0, filter: 'blur(6px)', transform: 'translateY(3px) scale(0.98)' },
              { opacity: 1, filter: 'blur(0)', transform: 'none' },
            ],
            { duration: 520, delay: 320, easing: EASE, fill: 'both' },
          ),
    )
  })
  if (h0 !== h1) {
    anims.push(root.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 560, delay: 120, easing: EASE, fill: 'backwards' }))
  }

  let over = false
  const done = () => {
    if (over) return
    over = true
    anims.forEach((x) => x.cancel())
    layer.remove()
    root.classList.remove('is-morphing')
  }
  Promise.all(anims.map((x) => x.finished)).then(done, () => {})
  return done
}
