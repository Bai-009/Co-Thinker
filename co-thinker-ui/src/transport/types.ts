// 组件 ← 会话控制器 ← transport adapter 的契约。示例与真实适配器实现同一组方法。

import type {
  BriefSnapshot,
  Groundwork,
  Reference,
  SessionSnapshot,
  SessionSummary,
} from '../domain/types'

export interface SubmitInput {
  sessionId: string
  /** 用来丢弃晚到事件。 */
  requestId: string
  clientMessageId: string
  /** 提交所依据的有效历史修订号。 */
  historyRevision: number
  text: string
  reference?: Reference
  mode: 'send' | 'revise' | 'retry'
  reviseTargetId?: string
}

export type ReplyEvent =
  | { type: 'accepted'; requestId: string; sessionId: string; snapshot: SessionSnapshot }
  | { type: 'reply_started'; requestId: string; sessionId: string; messageId: string }
  | { type: 'reply_delta'; requestId: string; sessionId: string; messageId: string; chunk: string }
  | {
      type: 'reply_complete'
      requestId: string
      sessionId: string
      messageId: string
      snapshot: SessionSnapshot
    }
  | {
      type: 'reply_failed'
      requestId: string
      sessionId: string
      reason: string
      snapshot: SessionSnapshot
    }

/** 后台事件活得比一次请求久，走独立订阅。 */
export type BackgroundEvent =
  | { type: 'memory_started'; sessionId: string; historyRevision: number }
  | {
      type: 'memory_updated'
      sessionId: string
      historyRevision: number
      groundwork: Groundwork
    }
  | { type: 'memory_failed'; sessionId: string; historyRevision: number; reason: string }

export interface BriefRequest {
  sessionId: string
  requestId: string
  historyRevision: number
}

export interface Transport {
  readonly kind: 'example' | 'live'
  listSessions(): Promise<SessionSummary[]>
  loadSession(id: string): Promise<SessionSnapshot | null>
  createSession(topic?: string): Promise<SessionSnapshot>
  deleteSession(id: string): Promise<void>
  submit(input: SubmitInput, signal: AbortSignal): AsyncIterable<ReplyEvent>
  requestBrief(req: BriefRequest, signal: AbortSignal): Promise<BriefSnapshot>
  retryMemory(sessionId: string): void
  subscribe(listener: (event: BackgroundEvent) => void): () => void
  readonly persistence: { ok: boolean; detail?: string }
}
