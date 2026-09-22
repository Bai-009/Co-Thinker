// 会话控制器。领域状态在 sessionReducer，视图状态按会话保存，请求状态随一次请求生灭。

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  emptySession,
  isBusy,
  revisableMessage,
  sessionReducer,
  uncoveredMessages,
  type SessionState,
} from '../domain/sessionReducer'
import type {
  BriefRelation,
  BriefSnapshot,
  Message,
  Reference,
  SessionSummary,
} from '../domain/types'
import { normalize } from '../domain/markdown'
import { repository } from '../storage/storage'
import type { NextOutcome } from '../transport/exampleTransport'
import { ExampleTransport, TOPIC_LIST } from '../transport/exampleTransport'
import type { Transport } from '../transport/types'

export type Pane = 'thread' | 'groundwork' | 'brief' | 'records'

export interface DraftState {
  text: string
  reference: Reference | null
}

type Drafts = Record<string, DraftState>

const isDrafts = (v: unknown): v is Drafts =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const emptyDraft: DraftState = { text: '', reference: null }

export interface BriefState {
  snapshot: BriefSnapshot | null
  loading: boolean
  error: string | null
}

export function useSession(transportFactory: () => Transport = () => new ExampleTransport()) {
  const transportRef = useRef<Transport | null>(null)
  if (!transportRef.current) transportRef.current = transportFactory()
  const transport = transportRef.current

  const [state, dispatch] = useReducer(sessionReducer, undefined, () => emptySession())
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [pane, setPane] = useState<Pane>('thread')
  const [drafts, setDrafts] = useState<Drafts>(
    () => repository.read<Drafts>('drafts', isDrafts) ?? {},
  )
  const [editing, setEditing] = useState<string | null>(null)
  const [brief, setBrief] = useState<BriefState>({
    snapshot: null,
    loading: false,
    error: null,
  })
  const [notice, setNotice] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  const stash = useRef<DraftState | null>(null)
  const lastSubmit = useRef<{
    clientMessageId: string
    text: string
    reference: Reference | null
  } | null>(null)
  const briefAbort = useRef<AbortController | null>(null)
  const sessionKey = state.id || '__new__'
  const draft = drafts[sessionKey] ?? emptyDraft

  const setDraft = useCallback(
    (patch: Partial<DraftState>) => {
      setDrafts((prev) => {
        const next = { ...prev, [sessionKey]: { ...(prev[sessionKey] ?? emptyDraft), ...patch } }
        repository.write('drafts', next)
        return next
      })
    },
    [sessionKey],
  )

  const refreshSessions = useCallback(async () => {
    setSessions(await transport.listSessions())
  }, [transport])

  useEffect(() => transport.subscribe((event) => dispatch({ type: 'background', event })), [
    transport,
  ])

  useEffect(() => {
    let alive = true
    void (async () => {
      await refreshSessions()
      const last = repository.read<string>('current', (v): v is string => typeof v === 'string')
      if (!last || !alive) return
      const snapshot = await transport.loadSession(last)
      if (snapshot && alive) dispatch({ type: 'session/loaded', snapshot })
    })()
    return () => {
      alive = false
      abortRef.current?.abort()
      briefAbort.current?.abort()
    }
  }, [refreshSessions, transport])

  const cancel = useCallback(async () => {
    if (!abortRef.current) return
    dispatch({ type: 'turn/cancelRequested' })
    abortRef.current.abort()
    try {
      await inflight.current
    } catch {
      /* 取消的结果在流里处理过 */
    }
  }, [])

  const selectSession = useCallback(
    async (id: string) => {
      await cancel()
      briefAbort.current?.abort()
      setBrief({ snapshot: null, loading: false, error: null })
      setEditing(null)
      setPane('thread')
      stash.current = null
      if (!id) {
        dispatch({ type: 'session/cleared' })
        repository.remove('current')
        return
      }
      const snapshot = await transport.loadSession(id)
      if (snapshot) {
        dispatch({ type: 'session/loaded', snapshot })
        repository.write('current', id)
      }
    },
    [cancel, transport],
  )

  const runSubmit = useCallback(
    async (
      sessionId: string,
      body: {
        text: string
        reference: Reference | null
        clientMessageId: string
        mode: 'send' | 'revise' | 'retry'
        reviseTargetId?: string
        historyRevision: number
        optimistic: Message | null
      },
    ) => {
      const requestId = uid()
      const controller = new AbortController()
      abortRef.current = controller
      dispatch({ type: 'turn/started', requestId, optimistic: body.optimistic })
      const run = (async () => {
        try {
          for await (const event of transport.submit(
            {
              sessionId,
              requestId,
              clientMessageId: body.clientMessageId,
              historyRevision: body.historyRevision,
              text: body.text,
              reference: body.reference ?? undefined,
              mode: body.mode,
              reviseTargetId: body.reviseTargetId,
            },
            controller.signal,
          )) {
            dispatch({ type: 'reply', event })
          }
        } catch (error) {
          if ((error as DOMException)?.name !== 'AbortError') {
            setNotice('这一轮没有完成。你的输入已经保存，可以重试。')
          }
          const snapshot = await transport.loadSession(sessionId)
          if (snapshot) dispatch({ type: 'session/loaded', snapshot })
        } finally {
          if (abortRef.current === controller) abortRef.current = null
          dispatch({ type: 'turn/settled' })
          void refreshSessions()
        }
      })()
      inflight.current = run
      await run
    },
    [refreshSessions, transport],
  )

  const send = useCallback(async () => {
    const text = draft.text.trim()
    if (!text) return
    await cancel()

    let sessionId = state.id
    let historyRevision = state.historyRevision
    if (!sessionId) {
      const topic =
        TOPIC_LIST.find((t) => t.firstLine.replace(/\s/g, '') === text.replace(/\s/g, ''))?.key ??
        TOPIC_LIST[0].key
      const snapshot = await transport.createSession(topic)
      dispatch({ type: 'session/loaded', snapshot })
      repository.write('current', snapshot.id)
      sessionId = snapshot.id
      historyRevision = snapshot.historyRevision
    }

    const clientMessageId = uid()
    lastSubmit.current = { clientMessageId, text, reference: draft.reference }
    const reviseTargetId = editing ?? undefined
    setDraft({ text: '', reference: null })
    setEditing(null)
    stash.current = null
    setPane('thread')

    await runSubmit(sessionId, {
      text,
      reference: draft.reference,
      clientMessageId,
      mode: reviseTargetId ? 'revise' : 'send',
      reviseTargetId,
      historyRevision,
      optimistic: reviseTargetId
        ? null
        : {
            id: `local-${clientMessageId}`,
            sequence: (state.messages.at(-1)?.sequence ?? -1) + 1,
            version: 1,
            role: 'user',
            text,
            status: 'complete',
            reference: draft.reference ?? undefined,
            clientMessageId,
            createdAt: Date.now(),
          },
    })
  }, [cancel, draft, editing, runSubmit, setDraft, state.historyRevision, state.id, state.messages, transport])

  /** 重试沿用同一个幂等键。 */
  const retryTurn = useCallback(async () => {
    const last = lastSubmit.current
    if (!last || !state.id) return
    await cancel()
    await runSubmit(state.id, {
      text: last.text,
      reference: last.reference,
      clientMessageId: last.clientMessageId,
      mode: 'retry',
      historyRevision: state.historyRevision,
      optimistic: null,
    })
  }, [cancel, runSubmit, state.historyRevision, state.id])

  const beginEdit = useCallback(
    (message: Message) => {
      stash.current = draft
      setDraft({ text: normalize(message.text), reference: message.reference ?? null })
      setEditing(message.id)
      setPane('thread')
    },
    [draft, setDraft],
  )

  const cancelEdit = useCallback(() => {
    const saved = stash.current ?? emptyDraft
    setDraft({ text: saved.text, reference: saved.reference })
    stash.current = null
    setEditing(null)
  }, [setDraft])

  const quote = useCallback(
    (reference: Reference) => {
      setDraft({ reference })
      setPane('thread')
    },
    [setDraft],
  )

  const generateBrief = useCallback(async () => {
    if (!state.id) return
    briefAbort.current?.abort()
    const controller = new AbortController()
    briefAbort.current = controller
    setPane('brief')
    setBrief({ snapshot: null, loading: true, error: null })
    try {
      const snapshot = await transport.requestBrief(
        { sessionId: state.id, requestId: uid(), historyRevision: state.historyRevision },
        controller.signal,
      )
      if (briefAbort.current === controller) {
        setBrief({ snapshot, loading: false, error: null })
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError' && briefAbort.current === controller) {
        setBrief({ snapshot: null, loading: false, error: '这份文档没有生成出来，可以重试。' })
      }
    }
  }, [state.historyRevision, state.id, transport])

  const briefRelation: BriefRelation = useMemo(() => {
    const snapshot = brief.snapshot
    if (!snapshot) return { added: false, quoteChanged: false }
    const added = state.messages.some((m) => m.sequence > snapshot.cutoffSequence)
    const quoteChanged = snapshot.quotedSources.some((q) => {
      const current = state.messages.find((m) => m.id === q.id)
      return !current || current.version !== q.version
    })
    return { added, quoteChanged }
  }, [brief.snapshot, state.messages])

  const newSession = useCallback(async () => {
    await selectSession('')
  }, [selectSession])

  const deleteSession = useCallback(
    async (id: string) => {
      await transport.deleteSession(id)
      if (id === state.id) await selectSession('')
      await refreshSessions()
    },
    [refreshSessions, selectSession, state.id, transport],
  )

  const retryMemory = useCallback(() => {
    if (!state.id) return
    dispatch({ type: 'memory/retrying' })
    transport.retryMemory(state.id)
  }, [state.id, transport])

  const setNextOutcome = useCallback(
    (outcome: NextOutcome) => {
      ;(transport as ExampleTransport).setNextOutcome?.(outcome)
    },
    [transport],
  )

  const busy = isBusy(state.phase)

  return {
    transport,
    state,
    sessions,
    pane,
    setPane,
    draft,
    setDraft,
    editing,
    brief,
    briefRelation,
    notice,
    dismissNotice: () => setNotice(null),
    dismissError: () => dispatch({ type: 'error/cleared' }),
    busy,
    uncovered: uncoveredMessages(state),
    revisable: revisableMessage(state),
    actions: {
      send,
      cancel,
      retryTurn,
      beginEdit,
      cancelEdit,
      quote,
      selectSession,
      newSession,
      deleteSession,
      generateBrief,
      closeBrief: () => {
        briefAbort.current?.abort()
        setBrief({ snapshot: null, loading: false, error: null })
        setPane('thread')
      },
      retryMemory,
      setNextOutcome,
    },
  }
}

export type SessionController = ReturnType<typeof useSession>
export type { SessionState }
