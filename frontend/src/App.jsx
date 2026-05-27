import React, { useCallback, useEffect, useRef, useState } from 'react'

import BriefModal from './components/BriefModal'
import Composer from './components/Composer'
import FoundationModal from './components/FoundationModal'
import MessageView from './components/MessageView'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import useBrief from './hooks/useBrief'
import useConversations from './hooks/useConversations'
import useFoundationPoll from './hooks/useFoundationPoll'
import useJudge from './hooks/useJudge'
import useTheme from './hooks/useTheme'
import useWorkshop from './hooks/useWorkshop'
import { API, getJSON } from './lib/api'
import { makeId, parseStoredVoices, stripProtocolBlocks } from './lib/messages'
import { applySense } from './lib/sense'

export default function App() {
  // messages: [{id, role: 'user'|'assistant'|'system', content?, voices?, confs?}]
  const [messages, setMessages] = useState([])
  const [composerValue, setComposerValue] = useState('')

  const [foundation, setFoundation] = useState('')
  const [foundationNarrative, setFoundationNarrative] = useState('')
  const [plan, setPlan] = useState('')
  const [foundationOpen, setFoundationOpen] = useState(false)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const mainEndRef = useRef(null)
  const composerRef = useRef(null)

  // When a turn finishes a "new conversation" (id was '' before, server
  // just minted one), the upcoming currentId change must NOT trigger a
  // re-fetch — we already have the streamed state locally. This ref
  // gates that one specific transition.
  const skipNextHydrationRef = useRef(false)

  const judge = useJudge()
  const brief = useBrief()
  const conversations = useConversations()
  const themeCtl = useTheme()
  const poll = useFoundationPoll({
    setFoundation,
    setFoundationNarrative,
    setPlan,
    judgeHydrate: judge.hydrate,
  })

  const handleTurnDone = useCallback(
    (silent) => {
      // First turn after "new" mints a server-side id; mark the upcoming
      // currentId change as already-canonical so we don't double-fetch.
      if (!conversations.currentId) {
        skipNextHydrationRef.current = true
      }
      conversations.refresh()
      // Truly silent turns don't trigger a metabolize task server-side,
      // so polling for them is wasted work.
      if (!silent) poll.start()
    },
    [conversations, poll],
  )

  const { send, edit, streaming } = useWorkshop({
    setMessages,
    onTurnDone: handleTurnDone,
  })

  // Hydrate / clear all session-scoped state whenever the active
  // conversation id changes. Empty id = "new conversation" mode → reset.
  useEffect(() => {
    if (skipNextHydrationRef.current) {
      skipNextHydrationRef.current = false
      return
    }

    const cid = conversations.currentId

    if (!cid) {
      setMessages([])
      setFoundation('')
      setFoundationNarrative('')
      setPlan('')
      setFoundationOpen(false)
      brief.reset()
      judge.clear()
      poll.reset()
      applySense(0.5, 0.5)
      return
    }

    setMessages([])
    setFoundation('')
    setFoundationNarrative('')
    setPlan('')
    setFoundationOpen(false)
    brief.reset()
    poll.reset()

    getJSON(API.history)
      .then((data) => {
        const msgs = (data.messages || [])
          .map((m) => {
            if (m.role === 'assistant') {
              const { voices, confs, interrupted } = parseStoredVoices(m.content)
              if (voices.length) {
                return { id: makeId(), role: 'assistant', voices, confs, interrupted }
              }
              const stripped = stripProtocolBlocks(m.content)
              if (!stripped) return null
              return {
                id: makeId(),
                role: 'assistant',
                voices: [stripped],
                confs: [0.5],
                interrupted: [false],
              }
            }
            return { id: makeId(), role: m.role, content: m.content }
          })
          .filter(Boolean)
        setMessages(msgs)
      })
      .catch(() => setMessages([]))

    getJSON(API.foundation)
      .then((data) => {
        const f = data.foundation || ''
        const n = data.foundation_narrative || ''
        const p = data.plan || ''
        setFoundation(f)
        setFoundationNarrative(n)
        setPlan(p)
        poll.hydrate({ foundation: f, foundation_narrative: n, plan: p })
      })
      .catch(() => {
        setFoundation('')
        setFoundationNarrative('')
        setPlan('')
      })

    getJSON(API.sense)
      .then((data) => {
        const c = typeof data.certainty === 'number' ? data.certainty : 0.5
        const r = typeof data.resonance === 'number' ? data.resonance : 0.5
        applySense(c, r)
        poll.hydrate({ certainty: c, resonance: r })
      })
      .catch(() => applySense(0.5, 0.5))

    getJSON(API.clarity)
      .then((data) => {
        judge.hydrate(data)
        poll.hydrate({
          clarity: typeof data.clarity === 'number' ? data.clarity : 0,
          drift: typeof data.drift === 'string' ? data.drift : '',
          seed: typeof data.seed === 'string' ? data.seed : '',
        })
      })
      .catch(() => judge.clear())
    // judge / brief / poll are stable refs from their hooks; only currentId drives this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.currentId])

  useEffect(() => {
    mainEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  useEffect(() => {
    if (!streaming) composerRef.current?.focus()
  }, [streaming])

  const handleSend = useCallback(async () => {
    const text = composerValue.trim()
    if (!text) return
    // No `streaming` gate — useWorkshop.send() handles the mid-stream
    // case by aborting the in-flight thinker and marking the partial
    // assistant voice as interrupted. This is the front half of the
    // 双向修改流: the human can追打 while AI is still浮现, and AI
    // adaptively continues / refines / pivots from where it was.
    setComposerValue('')
    await send(text)
  }, [composerValue, send])

  const handleEdit = useCallback(
    async (newText) => {
      if (!newText) return
      // edit() handles abort + state truncation internally + POSTs to
      // /api/chat/edit. Backend rolls foundation/sense/clarity back to
      // the pre-turn snapshot, then re-runs thinker with the new content.
      await edit(newText)
    },
    [edit],
  )

  const handleNewConversation = useCallback(() => {
    if (streaming) return
    conversations.newConversation()
  }, [streaming, conversations])

  const handleSwitchConversation = useCallback(
    (id) => {
      if (streaming) return
      conversations.switchTo(id)
    },
    [streaming, conversations],
  )

  const handleDeleteConversation = useCallback(
    (id) => {
      if (streaming) return
      conversations.remove(id)
    },
    [streaming, conversations],
  )

  const isEmpty = messages.length === 0 && !streaming
  const lastMsg = messages[messages.length - 1]
  const showThinkingPulse =
    streaming &&
    lastMsg?.role === 'assistant' &&
    (!lastMsg.voices || lastMsg.voices.length === 0)

  return (
    <div className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <Sidebar
        list={conversations.list}
        currentId={conversations.currentId}
        onNew={handleNewConversation}
        onSwitch={handleSwitchConversation}
        onDelete={handleDeleteConversation}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="stage">
        <Topbar
          onGenerateBrief={brief.generate}
          briefDisabled={streaming || brief.streaming}
          showBrief={!isEmpty}
          onOpenFoundation={() => setFoundationOpen(true)}
          foundationActive={!!(foundation || foundationNarrative)}
          foundationFlash={poll.flash}
          theme={themeCtl.theme}
          onToggleTheme={themeCtl.toggle}
        />

        <main className={`main-axis${isEmpty ? ' is-empty' : ''}`}>
          {isEmpty && (
            <div className="empty-prompt">
              <div className="empty-headline">Prompt as crystallized thinking</div>
              <div className="empty-sub">Prompt 不是输入技巧，而是共识后的思考结晶</div>
            </div>
          )}
          {(() => {
            // Find the index of the latest user message — only that one
            // gets the edit affordance (per design 1(a): edit-most-recent
            // only, no version branches).
            let latestUserIdx = -1
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'user') {
                latestUserIdx = i
                break
              }
            }
            return messages.map((msg, i) => (
              <MessageView
                key={msg.id}
                msg={msg}
                canEdit={i === latestUserIdx}
                onEdit={handleEdit}
              />
            ))
          })()}
          {showThinkingPulse && (
            <div className="thinking-pulse" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
          <div ref={mainEndRef} />
        </main>

        <Composer
          ref={composerRef}
          value={composerValue}
          onChange={setComposerValue}
          onSend={handleSend}
          streaming={streaming}
          seed={judge.seed}
        />

        <BriefModal
          open={brief.open}
          content={brief.content}
          streaming={brief.streaming}
          error={brief.error}
          copyStatus={brief.copyStatus}
          onClose={() => brief.setOpen(false)}
          onCopy={brief.copy}
          onRegenerate={brief.generate}
        />

        <FoundationModal
          open={foundationOpen}
          text={foundation}
          narrative={foundationNarrative}
          plan={plan}
          drift={judge.drift}
          onClose={() => setFoundationOpen(false)}
        />
      </div>
    </div>
  )
}
