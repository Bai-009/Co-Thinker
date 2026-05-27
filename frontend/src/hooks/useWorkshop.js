import { useCallback, useRef, useState } from 'react'

import { API, postStream } from '../lib/api'
import { readSSE } from '../lib/sse'
import { makeId } from '../lib/messages'

// Workshop turn streamer — thinker phase only.
//
// `streaming` flips false the moment the SSE stream ends (which now
// happens right after the thinker finishes, not after the foundation
// rewriter). The user can immediately type the next message; the
// foundation/sense/clarity update arrives later via useFoundationPoll
// and updates state in the background.
//
// onTurnDone(silent) fires once per completed turn, after `streaming` is
// false. Parent uses it to kick off polling and refresh the sidebar.
//
// Two ways to start a turn:
//
//   send(text) — 双向修改流 A 部分. Append a new user message + start a
//   new thinker. If a prior thinker is still streaming, abort it and
//   mark its half-said voices `interrupted` (strikethrough+fade). Backend
//   persists the partial with [INTERRUPTED] markers so the next thinker
//   reads them and applies thinker.md's adaptive-thinking branch.
//
//   edit(newText) — Post-completion edit. Replace the latest user
//   message's content with newText, drop everything after it (including
//   any assistant reply, partial or complete), restore backend state to
//   the snapshot before that turn, and re-run thinker. No interruption
//   marking — the truncated history is gone, not涂改.

export default function useWorkshop({ setMessages, onTurnDone }) {
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef(null)
  const currentAiIdRef = useRef(null)
  const currentEndedIndicesRef = useRef(new Set())

  // Shared turn runner. Handles the SSE consumption + cleanup that both
  // send and edit need; the only differences are the URL, the request
  // body, how the in-flight prior is killed (mark-interrupted vs.
  // truncate), and how the new user/assistant entries land in React
  // state. Those four points are passed in.
  const runTurn = useCallback(
    async ({ url, body, killPrior, mutateMessages }) => {
      // Stop whatever's currently in flight.
      if (abortRef.current) {
        killPrior({
          priorAiId: currentAiIdRef.current,
          endedIndices: currentEndedIndicesRef.current,
        })
        abortRef.current.abort()
        abortRef.current = null
      }

      const aiId = makeId()
      currentAiIdRef.current = aiId
      const endedIndices = new Set()
      currentEndedIndicesRef.current = endedIndices

      mutateMessages(aiId)
      setStreaming(true)

      const voices = []
      const confs = []
      const controller = new AbortController()
      abortRef.current = controller

      const setAi = (updater) =>
        setMessages((prev) => prev.map((m) => (m.id === aiId ? updater(m) : m)))

      const ensureSlot = (i) => {
        while (voices.length <= i) {
          voices.push('')
          confs.push(0.5)
        }
      }

      let doneFired = false
      let wasSilent = false

      try {
        const response = await postStream(url, body, { signal: controller.signal })

        await readSSE(
          response,
          (evt) => {
            if (evt.type === 'voice_start') {
              ensureSlot(evt.index)
              setAi((m) => ({ ...m, voices: [...voices], confs: [...confs] }))
            } else if (evt.type === 'voice_delta') {
              ensureSlot(evt.index)
              voices[evt.index] = (voices[evt.index] || '') + evt.content
              setAi((m) => ({ ...m, voices: [...voices], confs: [...confs] }))
            } else if (evt.type === 'voice_conf') {
              ensureSlot(evt.index)
              confs[evt.index] =
                typeof evt.confidence === 'number' ? evt.confidence : 0.5
              setAi((m) => ({ ...m, voices: [...voices], confs: [...confs] }))
            } else if (evt.type === 'voice_end') {
              endedIndices.add(evt.index)
            } else if (evt.type === 'done') {
              wasSilent = !!evt.silent
              if (wasSilent) {
                setMessages((prev) => prev.filter((m) => m.id !== aiId))
              } else {
                const finalVoices =
                  evt.voices && evt.voices.length
                    ? evt.voices
                    : voices.filter((v) => v && v.trim())
                const finalConfs =
                  evt.voice_confs && evt.voice_confs.length
                    ? evt.voice_confs
                    : confs.slice(0, finalVoices.length)
                setAi((m) => ({ ...m, voices: finalVoices, confs: finalConfs }))
              }
              doneFired = true
            } else if (evt.type === 'error') {
              setAi(() => ({
                id: aiId,
                role: 'system',
                content: evt.detail || '生成失败',
              }))
            }
          },
          { signal: controller.signal },
        )
      } catch (err) {
        if (err.name !== 'AbortError') {
          setAi(() => ({
            id: aiId,
            role: 'system',
            content: `网络错误：${err.message}`,
          }))
        }
      } finally {
        if (abortRef.current === controller) {
          setStreaming(false)
          abortRef.current = null
          currentAiIdRef.current = null
          currentEndedIndicesRef.current = new Set()
        }
        if (doneFired && onTurnDone) onTurnDone(wasSilent)
      }
    },
    [setMessages, onTurnDone],
  )

  const send = useCallback(
    async (text) => {
      if (!text) return
      await runTurn({
        url: API.workshop,
        body: { content: text },
        killPrior: ({ priorAiId, endedIndices }) => {
          // Mid-stream追打: mark still-open voices as interrupted
          // (strikethrough+fade); already-ended voices render normally.
          if (!priorAiId) return
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== priorAiId) return m
              const voicesArr = m.voices || []
              const interruptedFlags = voicesArr.map(
                (_, i) => !endedIndices.has(i),
              )
              return { ...m, interrupted: interruptedFlags }
            }),
          )
        },
        mutateMessages: (aiId) => {
          const userMsg = { id: makeId(), role: 'user', content: text }
          setMessages((prev) => [
            ...prev,
            userMsg,
            { id: aiId, role: 'assistant', voices: [], confs: [] },
          ])
        },
      })
    },
    [runTurn, setMessages],
  )

  const edit = useCallback(
    async (newText) => {
      if (!newText) return
      await runTurn({
        url: API.edit,
        body: { content: newText },
        // Editing discards the truncated history wholesale — no need
        // to mark anything interrupted, since the entries are about to
        // disappear from React state below.
        killPrior: () => {},
        mutateMessages: (aiId) => {
          setMessages((prev) => {
            // Find the latest user message; replace its content; drop
            // everything after it; append the new empty assistant slot.
            let lastUserIdx = -1
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'user') {
                lastUserIdx = i
                break
              }
            }
            if (lastUserIdx < 0) {
              // No prior user message — fall back to send-shaped state.
              return [
                ...prev,
                { id: makeId(), role: 'user', content: newText },
                { id: aiId, role: 'assistant', voices: [], confs: [] },
              ]
            }
            const next = prev.slice(0, lastUserIdx + 1)
            next[lastUserIdx] = { ...next[lastUserIdx], content: newText }
            next.push({ id: aiId, role: 'assistant', voices: [], confs: [] })
            return next
          })
        },
      })
    },
    [runTurn, setMessages],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { send, edit, abort, streaming }
}
