import { useCallback, useState } from 'react'

import { applyClarity } from '../lib/sense'

// Holds clarity / drift / seed state on the App side.
//
// The judge LLM call itself runs server-side now, chained after the
// foundation rewriter as part of the workshop's background metabolize
// task. The frontend learns about new judge values via useFoundationPoll,
// which calls hydrate() here to update React state + apply CSS.

export default function useJudge() {
  const [clarity, setClarity] = useState(0)
  const [drift, setDrift] = useState('')
  const [seed, setSeed] = useState('')

  const hydrate = useCallback((data) => {
    if (!data) return
    if (typeof data.clarity === 'number') {
      setClarity(data.clarity)
      applyClarity(data.clarity)
    }
    if (typeof data.drift === 'string') setDrift(data.drift)
    if (typeof data.seed === 'string') setSeed(data.seed)
  }, [])

  const clear = useCallback(() => {
    setClarity(0)
    setDrift('')
    setSeed('')
    applyClarity(0)
  }, [])

  return { clarity, drift, seed, hydrate, clear }
}
