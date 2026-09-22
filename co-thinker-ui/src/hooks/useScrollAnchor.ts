import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 只有停在末尾时新内容才带着视线走；每个视图各记各的位置。 */
export function useScrollAnchor(pane: string, streamDep: unknown, threshold = 64) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastTop = useRef(0)
  const positions = useRef<Record<string, number>>({})
  const previous = useRef(pane)
  const [atBottom, setAtBottom] = useState(true)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    lastTop.current = el.scrollTop
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
    if (pane === 'thread') stick.current = bottom
    setAtBottom(bottom)
  }, [pane, threshold])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', measure, { passive: true })
    return () => el.removeEventListener('scroll', measure)
  }, [measure])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (previous.current !== pane) {
      positions.current[previous.current] = lastTop.current
      const restore = positions.current[pane]
      previous.current = pane
      el.scrollTop = restore ?? (pane === 'thread' ? el.scrollHeight : 0)
      measure()
      return
    }
    if (pane === 'thread' && stick.current) el.scrollTop = el.scrollHeight
  }, [pane, streamDep, measure])

  const toBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    stick.current = true
    setAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  const pin = useCallback(() => {
    stick.current = true
    setAtBottom(true)
  }, [])

  return { ref, atBottom, toBottom, pin }
}
