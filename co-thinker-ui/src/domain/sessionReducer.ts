// 会话状态，以及后台/前台事件的写入资格判定。

import type {
  Groundwork,
  MemoryStatus,
  Message,
  SessionSnapshot,
} from './types'
import type { BackgroundEvent, ReplyEvent } from '../transport/types'

export type Phase = 'idle' | 'submitting' | 'streaming' | 'cancelling' | 'complete'

export interface SessionState {
  id: string
  title: string
  topic?: string
  messages: Message[]
  historyRevision: number
  groundwork: Groundwork | null
  groundworkHistory: Groundwork[]
  memory: MemoryStatus
  phase: Phase
  activeRequestId: string | null
  streamingMessageId: string | null
  /** 请求级失败，与消息级 error 分开。 */
  error: string | null
  script?: { remaining: number; nextLine: string | null }
}

export const emptySession = (id = ''): SessionState => ({
  id,
  title: '',
  messages: [],
  historyRevision: 0,
  groundwork: null,
  groundworkHistory: [],
  memory: { state: 'idle' },
  phase: 'idle',
  activeRequestId: null,
  streamingMessageId: null,
  error: null,
})

export type Action =
  | { type: 'session/loaded'; snapshot: SessionSnapshot }
  | { type: 'session/cleared' }
  | { type: 'turn/started'; requestId: string; optimistic: Message | null }
  | { type: 'turn/cancelRequested' }
  | { type: 'turn/settled' }
  | { type: 'reply'; event: ReplyEvent }
  | { type: 'background'; event: BackgroundEvent }
  | { type: 'memory/retrying' }
  | { type: 'error/cleared' }

function fromSnapshot(state: SessionState, snapshot: SessionSnapshot): SessionState {
  return {
    ...state,
    id: snapshot.id,
    title: snapshot.title,
    topic: snapshot.topic,
    messages: snapshot.messages,
    historyRevision: snapshot.historyRevision,
    groundwork: snapshot.groundwork,
    groundworkHistory: snapshot.groundworkHistory,
    script: snapshot.script,
  }
}

/** 会话一致、修订号一致、版本与覆盖范围不倒退，三条都要满足。 */
export function acceptsBackground(state: SessionState, event: BackgroundEvent): boolean {
  if (event.sessionId !== state.id) return false
  if (event.historyRevision !== state.historyRevision) return false
  if (event.type !== 'memory_updated') return true
  const current = state.groundwork
  if (!current) return true
  if (event.groundwork.version <= current.version) return false
  if (event.groundwork.coveredThrough < current.coveredThrough) return false
  return true
}

function acceptsReply(state: SessionState, event: ReplyEvent): boolean {
  if (event.sessionId !== state.id) return false
  return event.requestId === state.activeRequestId
}

export function sessionReducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'session/loaded': {
      const next = fromSnapshot(emptySession(action.snapshot.id), action.snapshot)
      const covered = action.snapshot.groundwork?.coveredThrough ?? -1
      const last = action.snapshot.messages.at(-1)?.sequence ?? -1
      return {
        ...next,
        memory: {
          state: action.snapshot.groundwork
            ? covered >= last
              ? 'ready'
              : 'idle'
            : 'idle',
        },
      }
    }

    case 'session/cleared':
      return emptySession()

    case 'turn/started':
      return {
        ...state,
        phase: 'submitting',
        activeRequestId: action.requestId,
        streamingMessageId: null,
        error: null,
        messages: action.optimistic ? [...state.messages, action.optimistic] : state.messages,
      }

    case 'turn/cancelRequested':
      return state.phase === 'submitting' || state.phase === 'streaming'
        ? { ...state, phase: 'cancelling' }
        : state

    case 'turn/settled':
      return { ...state, phase: 'complete', activeRequestId: null, streamingMessageId: null }

    case 'memory/retrying':
      return { ...state, memory: { state: 'updating' } }

    case 'error/cleared':
      return { ...state, error: null }

    case 'reply': {
      const event = action.event
      if (!acceptsReply(state, event)) return state
      switch (event.type) {
        case 'accepted':
          // 整段替换，乐观插入的那条不会留下重影。
          return fromSnapshot(state, event.snapshot)
        case 'reply_started':
          return {
            ...state,
            phase: 'streaming',
            streamingMessageId: event.messageId,
            messages: [
              ...state.messages,
              {
                id: event.messageId,
                sequence: (state.messages.at(-1)?.sequence ?? -1) + 1,
                version: 1,
                role: 'assistant',
                text: '',
                status: 'streaming',
                createdAt: Date.now(),
              },
            ],
          }
        case 'reply_delta':
          return {
            ...state,
            messages: state.messages.map((m) =>
              m.id === event.messageId ? { ...m, text: m.text + event.chunk } : m,
            ),
          }
        // 不在这里置「更新中」：后台是否开工由 memory_started 说。
        case 'reply_complete':
          return fromSnapshot(state, event.snapshot)
        case 'reply_failed':
          return { ...fromSnapshot(state, event.snapshot), error: event.reason }
      }
      return state
    }

    case 'background': {
      const event = action.event
      if (!acceptsBackground(state, event)) return state
      switch (event.type) {
        case 'memory_started':
          return { ...state, memory: { state: 'updating' } }
        case 'memory_updated': {
          const g = event.groundwork
          // 同一覆盖位置重来一次（重试）就替换，不留两份。
          const kept = state.groundworkHistory.filter((h) => h.coveredThrough < g.coveredThrough)
          return { ...state, groundwork: g, groundworkHistory: [...kept, g], memory: { state: 'ready' } }
        }
        case 'memory_failed':
          return { ...state, memory: { state: 'failed', detail: event.reason } }
      }
      return state
    }
  }
}

export const isBusy = (phase: Phase): boolean =>
  phase === 'submitting' || phase === 'streaming' || phase === 'cancelling'

/** 尚未被地基覆盖的表达。 */
export function uncoveredMessages(state: SessionState): Message[] {
  const covered = state.groundwork?.coveredThrough ?? -1
  return state.messages.filter((m) => m.sequence > covered && m.role === 'user')
}

/** 只允许回改最近一次用户输入。 */
export function revisableMessage(state: SessionState): Message | null {
  if (isBusy(state.phase)) return null
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i].role === 'user') return state.messages[i]
  }
  return null
}
