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

export default function useWorkshop({ setMessages, onTurnDone }) {
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef(null)

  const send = useCallback(
    async (text) => {
      if (!text || streaming) return
      const aiId = makeId()
      const userMsg = { id: makeId(), role: 'user', content: text }
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: aiId, role: 'assistant', voices: [], confs: [] },
      ])
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
        const response = await postStream(
          API.workshop,
          { content: text },
          { signal: controller.signal },
        )

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
              // no-op — final value already accumulated
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
        setStreaming(false)
        abortRef.current = null
        if (doneFired && onTurnDone) onTurnDone(wasSilent)
      }
    },
    [streaming, setMessages, onTurnDone],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { send, abort, streaming }
}
