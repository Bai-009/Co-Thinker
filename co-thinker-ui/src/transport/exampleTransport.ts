// 示例适配器：跑在浏览器里的模拟服务端，产生流式、取消、后台延迟与版本冲突。
// 输入对不上脚本时不给脚本回应，也不推进地基——那条表达会留在「尚未沉淀」里。

import { Repository, repository as sharedRepository } from '../storage/storage'
import type {
  BriefSnapshot,
  Groundwork,
  Message,
  SessionSnapshot,
  SessionSummary,
} from '../domain/types'
import { normalize } from '../domain/markdown'
import type {
  BackgroundEvent,
  BriefRequest,
  ReplyEvent,
  SubmitInput,
  Transport,
} from './types'
import { observation } from './fixtures/observation'
import { checklist } from './fixtures/checklist'
import type { Topic } from './fixtures/types'

const TOPICS: Record<string, Topic> = {
  [observation.key]: observation,
  [checklist.key]: checklist,
}

export const TOPIC_LIST = [observation, checklist].map((t) => ({
  key: t.key,
  title: t.title,
  firstLine: t.steps[0].input,
}))

const OFF_SCRIPT =
  '示例模式没有连接模型，这条表达已经记录下来，但不会生成真实回答。可以用「示例接话」继续这段示例。'

interface StoredSession {
  id: string
  title: string
  topic: string
  historyRevision: number
  stage: number
  messages: Message[]
  groundwork: Groundwork | null
  groundworkHistory: Groundwork[]
  versionCounter: number
  seenClientIds: string[]
  updatedAt: number
}

type Db = Record<string, StoredSession>

const isDb = (value: unknown): value is Db =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every(
    (s) =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as StoredSession).id === 'string' &&
      Array.isArray((s as StoredSession).messages),
  )

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const abortError = () => new DOMException('Aborted', 'AbortError')

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 忽略空白与标点差异，不做语义匹配。 */
const flatten = (s: string) =>
  s.replace(/[\s，。！？、；：“”‘’"'「」『』（）(),.!?;:]/g, '').toLowerCase()

function chunk(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; ) {
    const size = 2 + Math.floor(Math.random() * 4)
    out.push(text.slice(i, i + size))
    i += size
  }
  return out
}

export type NextOutcome = 'ok' | 'reply_failed' | 'memory_failed'

export class ExampleTransport implements Transport {
  readonly kind = 'example' as const
  private db: Db
  private listeners = new Set<(e: BackgroundEvent) => void>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private outcome: NextOutcome = 'ok'

  constructor(private readonly repository: Repository = sharedRepository) {
    this.db = repository.read<Db>('sessions', isDb) ?? {}
  }

  get persistence() {
    return this.repository.state
  }

  /** 示例控制层用，产品交互不经过这里。 */
  setNextOutcome(outcome: NextOutcome) {
    this.outcome = outcome
  }

  private save() {
    this.repository.write('sessions', this.db)
  }

  private emit(event: BackgroundEvent) {
    this.listeners.forEach((l) => l(event))
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  dispose() {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.listeners.clear()
  }

  subscribe(listener: (event: BackgroundEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private snapshot(s: StoredSession): SessionSnapshot {
    const topic = TOPICS[s.topic]
    const next = topic?.steps[s.stage]
    return {
      id: s.id,
      title: s.title,
      topic: s.topic,
      historyRevision: s.historyRevision,
      messages: s.messages.map((m) => ({ ...m })),
      groundwork: s.groundwork ? { ...s.groundwork } : null,
      groundworkHistory: (s.groundworkHistory ?? []).map((g) => ({ ...g })),
      script: topic
        ? { remaining: topic.steps.length - s.stage, nextLine: next ? next.input : null }
        : undefined,
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    return Object.values(this.db)
      .filter((s) => s.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        topic: s.topic,
      }))
  }

  async loadSession(id: string): Promise<SessionSnapshot | null> {
    const s = this.db[id]
    if (!s) return null
    // 没写完的那条标成中断，不留在 streaming。
    let touched = false
    s.messages = s.messages.map((m) => {
      if (m.status !== 'streaming') return m
      touched = true
      return { ...m, status: m.text.trim() ? 'interrupted' : 'failed', error: m.text.trim() ? undefined : '这一轮没有生成出内容。' }
    })
    if (touched) this.save()
    return this.snapshot(s)
  }

  async createSession(topic = observation.key): Promise<SessionSnapshot> {
    const id = uid()
    const s: StoredSession = {
      id,
      title: TOPICS[topic]?.title ?? '新的一段',
      topic,
      historyRevision: 1,
      stage: 0,
      messages: [],
      groundwork: null,
      groundworkHistory: [],
      versionCounter: 0,
      seenClientIds: [],
      updatedAt: Date.now(),
    }
    this.db[id] = s
    this.save()
    return this.snapshot(s)
  }

  async deleteSession(id: string) {
    delete this.db[id]
    this.save()
  }

  retryMemory(sessionId: string) {
    const s = this.db[sessionId]
    if (!s) return
    const revision = s.historyRevision
    this.emit({ type: 'memory_started', sessionId, historyRevision: revision })
    this.later(900, () => {
      const live = this.db[sessionId]
      if (!live || live.historyRevision !== revision) return
      if (live.groundwork) {
        this.emit({
          type: 'memory_updated',
          sessionId,
          historyRevision: revision,
          groundwork: { ...live.groundwork, version: (live.versionCounter += 1) },
        })
      } else {
        this.emit({
          type: 'memory_failed',
          sessionId,
          historyRevision: revision,
          reason: '还没有可以沉淀的内容。',
        })
      }
    })
  }

  async *submit(input: SubmitInput, signal: AbortSignal): AsyncIterable<ReplyEvent> {
    const s = this.db[input.sessionId]
    if (!s) throw new Error('会话不存在')

    const revised = input.mode === 'revise' ? this.applyRevision(s, input) : null
    const userMessage = this.appendUser(s, input, revised)
    s.updatedAt = Date.now()
    this.save()

    yield {
      type: 'accepted',
      requestId: input.requestId,
      sessionId: s.id,
      snapshot: this.snapshot(s),
    }

    const topic = TOPICS[s.topic]
    const step = topic?.steps[s.stage]
    const onScript = !!step && flatten(userMessage.plain) === flatten(step.input)

    if (this.outcome === 'reply_failed') {
      this.outcome = 'ok'
      await wait(420, signal)
      yield {
        type: 'reply_failed',
        requestId: input.requestId,
        sessionId: s.id,
        reason: '这一轮没有生成出来。你的输入已经保存，可以重试。',
        snapshot: this.snapshot(s),
      }
      return
    }

    const body = onScript ? step!.voice : OFF_SCRIPT
    const replyId = uid()
    const reply: Message = {
      id: replyId,
      sequence: s.messages.length,
      version: 1,
      role: 'assistant',
      text: '',
      status: 'streaming',
      confidence: onScript ? step!.confidence : undefined,
      createdAt: Date.now(),
    }
    s.messages.push(reply)
    this.save()

    yield {
      type: 'reply_started',
      requestId: input.requestId,
      sessionId: s.id,
      messageId: replyId,
    }

    try {
      await wait(260, signal)
      for (const piece of chunk(body)) {
        await wait(20, signal)
        reply.text += piece
        yield {
          type: 'reply_delta',
          requestId: input.requestId,
          sessionId: s.id,
          messageId: replyId,
          chunk: piece,
        }
      }
    } catch (error) {
      reply.status = reply.text.trim() ? 'interrupted' : 'failed'
      if (!reply.text.trim()) {
        s.messages = s.messages.filter((m) => m.id !== replyId)
      }
      this.save()
      throw error
    }

    reply.status = 'complete'
    if (onScript && step) {
      s.stage += 1
      s.title = topic!.title
    }
    s.updatedAt = Date.now()
    this.save()

    yield {
      type: 'reply_complete',
      requestId: input.requestId,
      sessionId: s.id,
      messageId: replyId,
      snapshot: this.snapshot(s),
    }

    if (onScript && step) this.scheduleMemory(s, step.groundwork, reply.sequence)
  }

  private appendUser(s: StoredSession, input: SubmitInput, revised: Message | null) {
    const existing = s.messages.find((m) => m.clientMessageId === input.clientMessageId)
    if (existing) return { message: existing, plain: existing.text }
    const message: Message = revised
      ? {
          ...revised,
          // id 不变，旧引用因此得到「依据已改变」而不是「找不到来源」。
          version: revised.version + 1,
          text: input.text,
          reference: input.reference,
          clientMessageId: input.clientMessageId,
          status: 'complete',
        }
      : {
          id: uid(),
          sequence: s.messages.length,
          version: 1,
          role: 'user',
          text: input.text,
          status: 'complete',
          reference: input.reference,
          clientMessageId: input.clientMessageId,
          createdAt: Date.now(),
        }
    s.messages.push(message)
    s.seenClientIds.push(input.clientMessageId)
    if (!s.messages.some((m) => m.role === 'assistant')) {
      s.title = input.text.slice(0, 24)
    }
    return { message, plain: input.text }
  }

  /** 回改：其后内容退出有效历史，地基回到与前缀相符的那一版。 */
  private applyRevision(s: StoredSession, input: SubmitInput): Message | null {
    const index = s.messages.findIndex((m) => m.id === input.reviseTargetId)
    if (index < 0) return null
    const target = s.messages[index]
    s.messages = s.messages.slice(0, index)
    s.historyRevision += 1
    const boundary = target.sequence
    s.groundworkHistory = s.groundworkHistory.filter((g) => g.coveredThrough < boundary)
    s.groundwork = s.groundworkHistory.at(-1) ?? null
    const topic = TOPICS[s.topic]
    if (topic) {
      const userTurns = s.messages.filter((m) => m.role === 'user').length
      s.stage = Math.max(0, Math.min(topic.steps.length, userTurns))
    }
    return target
  }

  private scheduleMemory(
    s: StoredSession,
    script: Topic['steps'][number]['groundwork'],
    coveredThrough: number,
  ) {
    const sessionId = s.id
    const revision = s.historyRevision
    this.emit({ type: 'memory_started', sessionId, historyRevision: revision })
    this.later(1500, () => {
      const live = this.db[sessionId]
      if (!live) return
      if (live.historyRevision !== revision) return
      if (this.outcome === 'memory_failed') {
        this.outcome = 'ok'
        this.emit({
          type: 'memory_failed',
          sessionId,
          historyRevision: revision,
          reason: '共同记录这一轮没有更新成功。讨论都在，可以重试。',
        })
        return
      }
      const byIndex = (seq: number) => live.messages.find((m) => m.sequence === seq)?.id
      const groundwork: Groundwork = {
        version: (live.versionCounter += 1),
        historyRevision: revision,
        coveredThrough,
        prose: script.prose,
        claims: script.claims.map((c, i) => ({
          // 按位置编号，与页面序号一致；回改之后同一条仍是同一条。
          id: `c${i}`,
          text: c.text,
          status: c.status,
          sourceIds: c.from.map(byIndex).filter((x): x is string => !!x),
        })),
        open: script.open,
        sense: script.sense,
        updatedAt: Date.now(),
      }
      live.groundwork = groundwork
      live.groundworkHistory = [
        ...live.groundworkHistory.filter((g) => g.coveredThrough < coveredThrough),
        groundwork,
      ]
      this.save()
      this.emit({ type: 'memory_updated', sessionId, historyRevision: revision, groundwork })
    })
  }

  async requestBrief(
    req: BriefRequest,
    signal: AbortSignal,
    onDelta?: (markdown: string) => void,
  ): Promise<BriefSnapshot> {
    const s = this.db[req.sessionId]
    if (!s) throw new Error('会话不存在')
    // 冻结在请求这一刻。
    const messages = s.messages.map((m) => ({ ...m }))
    const groundwork = s.groundwork ? { ...s.groundwork } : null
    const cutoffSequence = messages.at(-1)?.sequence ?? -1
    const covered = groundwork?.coveredThrough ?? -1
    const uncovered = messages
      .filter((m) => m.role === 'user' && m.sequence > covered)
      .map((m) => normalize(m.text))

    await wait(700, signal)

    const quoted = (groundwork?.claims ?? [])
      .filter((c) => c.status === 'confirmed')
      .flatMap((c) => c.sourceIds)
      .map((id) => messages.find((m) => m.id === id))
      .filter((m): m is Message => !!m && m.role === 'user')
    const quotedUnique = [...new Map(quoted.map((m) => [m.id, m])).values()].slice(0, 2)

    const lines: string[] = []
    lines.push(`## 我想做什么`)
    lines.push(groundwork?.prose ?? '这段讨论还没有沉淀出可以交接的判断。')
    const confirmed = (groundwork?.claims ?? []).filter((c) => c.status === 'confirmed')
    const tentative = (groundwork?.claims ?? []).filter((c) => c.status === 'tentative')
    if (confirmed.length) {
      lines.push(`## 已经定下来的`)
      confirmed.forEach((c) => lines.push(`- ${c.text}`))
    }
    if (tentative.length) {
      lines.push(`## 暂时的倾向，还没有定`)
      tentative.forEach((c) => lines.push(`- ${c.text}`))
    }
    if (groundwork?.open.length) {
      lines.push(`## 还没有答案的`)
      groundwork.open.forEach((q) => lines.push(`- ${q}`))
    }
    if (quotedUnique.length) {
      lines.push(`## 这些判断来自哪几句话`)
      quotedUnique.forEach((m) => lines.push(`> ${normalize(m.text).replace(/\n/g, ' ')}`))
    }
    if (uncovered.length) {
      lines.push(`## 新增表达，尚待核对`)
      uncovered.forEach((t) => lines.push(`- ${t}`))
    }
    lines.push(`---`)
    lines.push(`示例模式：以上内容由示例脚本与前端拼出，没有经过模型综合。`)

    // 像真实服务那样一段一段地到。
    if (onDelta) {
      for (let i = 1; i <= lines.length; i++) {
        onDelta(lines.slice(0, i).join('\n\n'))
        await wait(90, signal)
      }
    }

    return {
      id: req.requestId,
      historyRevision: req.historyRevision,
      cutoffSequence,
      groundworkVersion: groundwork?.version ?? 0,
      markdown: lines.join('\n\n'),
      uncovered,
      quotedSources: quotedUnique.map((m) => ({ id: m.id, version: m.version })),
      createdAt: Date.now(),
    }
  }
}
