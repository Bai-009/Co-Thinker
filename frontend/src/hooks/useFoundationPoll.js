import { useCallback, useEffect, useRef, useState } from 'react'

import { API, getJSON } from '../lib/api'
import { applyClarity, applySense } from '../lib/sense'

// After a workshop turn ends, the foundation rewriter and judge run as a
// detached server-side task. This hook polls /api/chat/foundation +
// /api/chat/clarity + /api/chat/sense at a steady cadence so the UI
// eventually reflects the new state, even though the user is no longer
// waiting on it.
//
// Cadence: 1.5s after start(), then every 1.5s. Stops when:
//   - 4 seconds have passed since the last detected change (the
//     metabolize task has finished settling), OR
//   - 35 seconds have elapsed since start (hard cap, in case the
//     rewriter/judge errored silently or unchanged outputs mean we'll
//     never see a diff).
//
// The previous fixed three-tap schedule (1.5/3/6s) systematically missed
// the judge LLM call which lands ~12s after thinker done — leaving
// clarity/drift/seed permanently one turn behind.
//
// hydrate() seeds the "last seen" baseline (used on conversation switch
// so the next poll doesn't false-positive vs. the previous conversation).
// reset() clears state when entering "new conversation" mode.

const POLL_INTERVAL_MS = 1500
const POLL_HARD_CAP_MS = 35000
const STABLE_AFTER_CHANGE_MS = 4000
const FLASH_DURATION_MS = 1800

export default function useFoundationPoll({
  setFoundation,
  setFoundationNarrative,
  setPlan,
  judgeHydrate,
}) {
  const [flash, setFlash] = useState(false)
  const lastSeenRef = useRef({
    foundation: '',
    foundation_narrative: '',
    plan: '',
    clarity: 0,
    drift: '',
    seed: '',
    sense: { certainty: 0.5, resonance: 0.5 },
  })
  const timeoutsRef = useRef([])
  const flashTimerRef = useRef(null)

  const cancelPending = useCallback(() => {
    for (const id of timeoutsRef.current) clearTimeout(id)
    timeoutsRef.current = []
  }, [])

  const triggerFlash = useCallback(() => {
    setFlash(true)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(false), FLASH_DURATION_MS)
  }, [])

  const pollOnce = useCallback(async () => {
    let changed = false
    try {
      const [f, c, s] = await Promise.all([
        getJSON(API.foundation),
        getJSON(API.clarity),
        getJSON(API.sense),
      ])
      const last = lastSeenRef.current

      const newFoundation = f.foundation || ''
      const newNarrative = f.foundation_narrative || ''
      const newPlan = f.plan || ''
      if (newFoundation !== last.foundation) {
        setFoundation(newFoundation)
        last.foundation = newFoundation
        changed = true
      }
      if (newNarrative !== last.foundation_narrative) {
        setFoundationNarrative(newNarrative)
        last.foundation_narrative = newNarrative
        changed = true
      }
      if (newPlan !== last.plan) {
        if (setPlan) setPlan(newPlan)
        last.plan = newPlan
        changed = true
      }

      const newClarity = typeof c.clarity === 'number' ? c.clarity : 0
      const newDrift = c.drift || ''
      const newSeed = c.seed || ''
      if (
        newClarity !== last.clarity ||
        newDrift !== last.drift ||
        newSeed !== last.seed
      ) {
        if (judgeHydrate) {
          judgeHydrate({ clarity: newClarity, drift: newDrift, seed: newSeed })
        } else {
          applyClarity(newClarity)
        }
        last.clarity = newClarity
        last.drift = newDrift
        last.seed = newSeed
        changed = true
      }

      const newCert = typeof s.certainty === 'number' ? s.certainty : 0.5
      const newRes = typeof s.resonance === 'number' ? s.resonance : 0.5
      if (
        newCert !== last.sense.certainty ||
        newRes !== last.sense.resonance
      ) {
        applySense(newCert, newRes)
        last.sense = { certainty: newCert, resonance: newRes }
        changed = true
      }
    } catch {
      // Soft-fail — polling is decorative; a missed poll just means we
      // wait for the next one.
    }
    return changed
  }, [setFoundation, setFoundationNarrative, setPlan, judgeHydrate])

  const start = useCallback(() => {
    cancelPending()
    const startTime = Date.now()
    let lastChangeTime = startTime
    let hadChange = false

    const tick = async () => {
      // Hard cap — stop regardless of whether anything changed.
      if (Date.now() - startTime >= POLL_HARD_CAP_MS) return

      const changed = await pollOnce()
      if (changed) {
        hadChange = true
        lastChangeTime = Date.now()
        triggerFlash()
      }
      // Once we've seen ANY change, stop after a stability window — the
      // metabolize task usually emits foundation first then judge a few
      // seconds later. Waiting ~4s past the last change catches the tail.
      if (hadChange && Date.now() - lastChangeTime >= STABLE_AFTER_CHANGE_MS) {
        return
      }

      const id = setTimeout(tick, POLL_INTERVAL_MS)
      timeoutsRef.current.push(id)
    }

    const firstId = setTimeout(tick, POLL_INTERVAL_MS)
    timeoutsRef.current.push(firstId)
  }, [cancelPending, pollOnce, triggerFlash])

  const hydrate = useCallback((data) => {
    if (!data) return
    const last = lastSeenRef.current
    if (typeof data.foundation === 'string') last.foundation = data.foundation
    if (typeof data.foundation_narrative === 'string') {
      last.foundation_narrative = data.foundation_narrative
    }
    if (typeof data.plan === 'string') last.plan = data.plan
    if (typeof data.clarity === 'number') last.clarity = data.clarity
    if (typeof data.drift === 'string') last.drift = data.drift
    if (typeof data.seed === 'string') last.seed = data.seed
    if (typeof data.certainty === 'number') {
      last.sense = { ...last.sense, certainty: data.certainty }
    }
    if (typeof data.resonance === 'number') {
      last.sense = { ...last.sense, resonance: data.resonance }
    }
  }, [])

  const reset = useCallback(() => {
    cancelPending()
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setFlash(false)
    lastSeenRef.current = {
      foundation: '',
      foundation_narrative: '',
      plan: '',
      clarity: 0,
      drift: '',
      seed: '',
      sense: { certainty: 0.5, resonance: 0.5 },
    }
  }, [cancelPending])

  useEffect(() => {
    return () => {
      cancelPending()
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [cancelPending])

  return { flash, start, hydrate, reset }
}
