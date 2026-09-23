// 真实适配器：对接 backend/（FastAPI + DeepSeek）。
// 服务端只有消息正文、地基正文和记忆状态；id / sequence / version / 地基历史在这里补出来，
// 让界面对示例与真实两条传输层一视同仁。

import { normalize } from '../domain/markdown'
import { dropRepeats } from '../domain/similar'
import {
  composeReference,
  parseSourceLabel,
  sourceLabel,
  splitReference,
  type ReferenceText,
} from '../domain/referenceText'
import type {
  BriefSnapshot,
  Groundwork,
  GroundworkClaim,
  Message,
  Reference,
  SessionSnapshot,
  SessionSummary,
} from '../domain/types'
import { Repository, repository as sharedRepository } from '../storage/storage'
import type { BackgroundEvent, BriefRequest, ReplyEvent, SubmitInput, Transport } from './types'

const API = '/api/chat'
const SESSION_HEADER = 'X-Session-Id'

interface RawMessage {
  role: string
  content: string
}
interface MemoryPayload {
  state: string
  covered_messages: number
  total_messages: number
  detail: string
}
interface FoundationPayload {
  foundation: string
  foundation_narrative: string
  plan: string
  memory: MemoryPayload
  revision_count: number
  focus: string
  open_questions: string[]
}
interface SessionRow {
  id: string
  title: string
  updated_at: number
  message_count: number
}
interface SensePayload {
  certainty: number
  resonance: number
}
interface ClarityPayload {
  clarity: number
  drift: string
  seed: string
}

/** 一段会话在客户端这边的活状态。 */
interface Live {
  id: string
  title: string
  revision: number
  messages: Message[]
  groundwork: Groundwork | null
  history: Groundwork[]
}

const clamp01 = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5
}

/** 内容的稳定指纹当 version 用：回改后同一位置的话变了，旧引用就会看到「依据已改变」。 */
export function fingerprint(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h || 1
}

const VOICE_RE = /\[VOICE\]([\s\S]*?)(?:\[\/VOICE\]|$)/g
const CONF_RE = /\[CONF\]\s*([\d.]+)\s*\[\/CONF\]\s*/
const INTERRUPTED_RE = /\[INTERRUPTED\]/

/** 把服务端存的 [VOICE][CONF]…[/CONF]…[/VOICE] 拆成正文、把握和是否中断。多段浮现用空行隔开。 */
export function parseAssistant(content: string): {
  text: string
  confidence?: number
  interrupted: boolean
} {
  const voices: string[] = []
  const confs: number[] = []
  let interrupted = false
  for (const m of content.matchAll(VOICE_RE)) {
    let body = m[1]
    const c = body.match(CONF_RE)
    if (c) {
      const v = parseFloat(c[1])
      if (Number.isFinite(v)) confs.push(clamp01(v))
      body = body.replace(CONF_RE, '')
    }
    if (INTERRUPTED_RE.test(body)) {
      interrupted = true
      body = body.replace(/\s*\[INTERRUPTED\]\s*/g, '')
    }
    body = body.trim()
    if (body) voices.push(body)
  }
  if (voices.length === 0) {
    return {
      text: content.replace(/\[\/?[A-Z_]+\]/g, '').trim(),
      interrupted: INTERRUPTED_RE.test(content),
    }
  }
  return {
    text: voices.join('\n\n'),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : undefined,
    interrupted,
  }
}

/**
 * 地基清单：`1. 共识。` 是定下的；`2. ~~旧条目~~ → 被 #4 取代（理由）` 是被取代的。
 * 按位置编号成 c0、c1…，和示例传输层一致，回改之后同一条仍是同一条。
 */
export function parseClaims(list: string): GroundworkClaim[] {
  const items: string[] = []
  for (const raw of list.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(\d+)[.、．)]\s*(.*)$/)
    if (m) items.push(m[2])
    else if (items.length) items[items.length - 1] += ' ' + line
  }
  return items.map((body, i) => {
    const struck = body.match(/^~~([\s\S]*?)~~\s*(.*)$/)
    if (struck) {
      const by = struck[2].match(/#\s*(\d+)/)
      const why = struck[2].match(/[（(]([^（）()]+)[）)]\s*$/)
      return {
        id: `c${i}`,
        text: struck[1].trim(),
        status: 'superseded' as const,
        sourceIds: [],
        supersededBy: by ? `c${Number(by[1]) - 1}` : undefined,
        ...(why ? { note: why[1].trim() } : {}),
      }
    }
    return { id: `c${i}`, text: body.trim(), status: 'confirmed' as const, sourceIds: [] }
  })
}

/** 人这一边的正文与 version 只看新表达，不算「引用材料」块；发送时的乐观记录和刷新后的才一致。 */
function userText(content: string): string {
  return splitReference(content).text
}

/**
 * 服务端的消息没有 id：按位置编号，version 是正文指纹。引用与幂等键从上一份本地记录里接过来；
 * 本地没有时，从正文里的「引用材料」块拆回来，按来源标签指回原句。
 */
export function toMessages(sid: string, raw: RawMessage[], previous: Message[]): Message[] {
  const out: Message[] = []
  raw.forEach((m, i) => {
    if (m.role !== 'user' && m.role !== 'assistant') return
    let text: string
    let confidence: number | undefined
    let interrupted = false
    let embedded: ReferenceText | undefined
    if (m.role === 'assistant') {
      const parsed = parseAssistant(m.content)
      text = parsed.text
      confidence = parsed.confidence
      interrupted = parsed.interrupted
    } else {
      const split = splitReference(m.content)
      text = split.text
      embedded = split.reference
    }
    const prev = previous[i]
    const carry = prev && prev.role === m.role && prev.text === text ? prev : undefined
    out.push({
      id: `${sid}:${i}`,
      sequence: i,
      version: fingerprint(m.role === 'user' ? text : m.content),
      role: m.role,
      text,
      status: interrupted ? 'interrupted' : 'complete',
      confidence,
      reference: carry?.reference ?? (embedded ? rebuildReference(sid, embedded, raw, i) : undefined),
      clientMessageId: carry?.clientMessageId,
      createdAt: carry?.createdAt ?? Date.now(),
    })
  })
  return out
}

/** 从来源标签指回原句，只在被点名的那句里找引文的位置，不跨消息找。找不到就是依据已改变。 */
function rebuildReference(sid: string, ref: ReferenceText, raw: RawMessage[], before: number): Reference {
  const label = parseSourceLabel(ref.source)
  const src = label && label.sequence < before ? raw[label.sequence] : undefined
  if (!label || !src || src.role !== label.role) {
    return { sessionId: sid, sourceId: '', sourceVersion: 0, quote: ref.quote }
  }
  const srcText = src.role === 'assistant' ? parseAssistant(src.content).text : userText(src.content)
  const start = normalize(srcText).indexOf(ref.quote)
  return {
    sessionId: sid,
    sourceId: `${sid}:${label.sequence}`,
    sourceVersion: fingerprint(src.role === 'user' ? srcText : src.content),
    range: start >= 0 ? { start, end: start + ref.quote.length } : { start: 0, end: 0 },
    quote: ref.quote,
  }
}

/** 发给服务端的正文：带引用时按「引用材料」格式拼进去，来源标签指向被引的那句。 */
export function contentForServer(text: string, reference: Reference | undefined, messages: Message[]): string {
  if (!reference?.quote) return text
  const src = messages.find((m) => m.id === reference.sourceId)
  const source = src ? sourceLabel(src.role, src.sequence) : '来源不在这次对话里'
  return composeReference(text, { source, quote: reference.quote })
}

/** 读 `data: {...}\n\n` 的事件流。 */
export async function* readSse(res: Response): AsyncGenerator<Record<string, unknown>> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          try {
            yield JSON.parse(line.slice(5).trim()) as Record<string, unknown>
          } catch {
            /* 半截帧，忽略 */
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** 第一句话的前一截当标题：到第一个句读为止，最多 40 字。 */
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const cut = t.search(/[。！？；，,!?;]/)
  const head = cut > 0 ? t.slice(0, cut) : t
  return head.length > 40 ? head.slice(0, 40) : head
}

const hexId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

export class HttpTransport implements Transport {
  readonly kind = 'live' as const
  readonly persistence = { ok: true }
  private live = new Map<string, Live>()
  private listeners = new Set<(e: BackgroundEvent) => void>()
  private watching = new Set<string>()

  constructor(private readonly repository: Repository = sharedRepository) {}

  subscribe(listener: (event: BackgroundEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: BackgroundEvent) {
    this.listeners.forEach((l) => l(event))
  }

  // ---- HTTP ---------------------------------------------------------------

  private async request(
    method: string,
    path: string,
    sid?: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' }
    if (sid) headers[SESSION_HEADER] = sid
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`后端返回 ${res.status}`)
    return res
  }

  private async json<T>(method: string, path: string, sid?: string, body?: unknown): Promise<T> {
    return (await this.request(method, path, sid, body)).json() as Promise<T>
  }

  // ---- 本地状态与地基历史 ---------------------------------------------------

  private historyKey(sid: string) {
    return `live-groundwork:${sid}`
  }

  private titleKey(sid: string) {
    return `live-title:${sid}`
  }

  /** 标题钉死：只认这段对话的第一句话。后端每轮把地基叙述的第一句当标题，会一直变，也太长；
   *  拿到历史时用第一句话钉住，之后不再变。列表里没打开过的对话先照后端给的显示，不钉。 */
  private pinTitle(sid: string, fromServer: string, firstUser?: string): string {
    const pinned = this.repository.read<string>(this.titleKey(sid), (v): v is string => typeof v === 'string' && v.length > 0)
    if (pinned) return pinned
    const own = titleFrom(firstUser ?? '')
    if (own) {
      this.repository.write(this.titleKey(sid), own)
      return own
    }
    return fromServer
  }

  private state(sid: string): Live {
    let s = this.live.get(sid)
    if (!s) {
      s = {
        id: sid,
        title: '',
        revision: 1,
        messages: [],
        groundwork: null,
        history:
          this.repository.read<Groundwork[]>(this.historyKey(sid), (v): v is Groundwork[] =>
            Array.isArray(v),
          ) ?? [],
      }
      this.live.set(sid, s)
    }
    return s
  }

  private snapshot(s: Live): SessionSnapshot {
    return {
      id: s.id,
      title: s.title,
      historyRevision: s.revision,
      messages: s.messages.map((m) => ({ ...m })),
      groundwork: s.groundwork ? { ...s.groundwork } : null,
      groundworkHistory: s.history.map((g) => ({ ...g })),
    }
  }

  /** 历史只留与有效历史相符、且不晚于当前这一版的几版；当前版补进去。 */
  private reconcileHistory(s: Live) {
    const lastSeq = s.messages.at(-1)?.sequence ?? -1
    let history = s.history.filter((h) => h.coveredThrough <= lastSeq)
    const g = s.groundwork
    if (g) history = [...history.filter((h) => h.coveredThrough < g.coveredThrough), g]
    history.forEach((h) => {
      h.historyRevision = s.revision
    })
    s.history = history
    this.repository.write(this.historyKey(s.id), history)
  }

  private async groundworkFrom(s: Live, f: FoundationPayload): Promise<Groundwork | null> {
    if (!f.foundation.trim() && !f.foundation_narrative.trim()) return null
    const [sense, clarity] = await Promise.all([
      this.json<SensePayload>('GET', '/sense', s.id),
      this.json<ClarityPayload>('GET', '/clarity', s.id),
    ])
    // 判官没跑过时 clarity 是 0，不是「一片模糊」；按中性处理。
    const judged = clarity.clarity > 0 || !!clarity.drift || !!clarity.seed
    return {
      version: f.revision_count,
      historyRevision: s.revision,
      coveredThrough: (f.memory?.covered_messages ?? 0) - 1,
      prose: f.foundation_narrative.trim(),
      claims: parseClaims(f.foundation),
      // 松动的每条一件事：后端把几件事写在一行里用分号隔开，这里按分号分开。
      open: dropRepeats(
        [f.focus, ...(f.open_questions ?? [])]
        .flatMap((x) => String(x ?? '').split(/[；;]\s*/))
        .map((x) => x.trim())
        .filter(Boolean),
      ),
      sense: {
        certainty: clamp01(sense.certainty),
        resonance: clamp01(sense.resonance),
        clarity: judged ? clamp01(clarity.clarity) : 0.5,
      },
      updatedAt: Date.now(),
    }
  }

  /** 以服务端为准刷新消息、标题和地基。 */
  private async refresh(sid: string): Promise<Live> {
    const s = this.state(sid)
    const [history, foundation, rows] = await Promise.all([
      this.json<{ messages: RawMessage[] }>('GET', '/history', sid),
      this.json<FoundationPayload>('GET', '/foundation', sid),
      this.json<{ sessions: SessionRow[] }>('GET', '/sessions'),
    ])
    s.messages = toMessages(sid, history.messages ?? [], s.messages)
    s.title = this.pinTitle(
      sid,
      rows.sessions.find((r) => r.id === sid)?.title ?? '',
      s.messages.find((m) => m.role === 'user')?.text,
    )
    s.groundwork = await this.groundworkFrom(s, foundation)
    this.reconcileHistory(s)
    return s
  }

  // ---- Transport ----------------------------------------------------------

  async listSessions(): Promise<SessionSummary[]> {
    const { sessions } = await this.json<{ sessions: SessionRow[] }>('GET', '/sessions')
    return sessions
      .filter((r) => r.message_count > 0)
      .map((r) => ({
        id: r.id,
        title: this.pinTitle(r.id, r.title),
        updatedAt: Math.round(r.updated_at * 1000),
        messageCount: r.message_count,
      }))
  }

  async loadSession(id: string): Promise<SessionSnapshot | null> {
    // 服务端见到陌生 id 会顺手建一段；先查清单，别把过期的本地 id 变成空会话。
    const { sessions } = await this.json<{ sessions: SessionRow[] }>('GET', '/sessions')
    if (!sessions.some((r) => r.id === id)) return null
    return this.snapshot(await this.refresh(id))
  }

  async createSession(): Promise<SessionSnapshot> {
    // 服务端在第一次带这个 id 的请求时才建会话；空会话不会出现在清单里。
    const s = this.state(hexId())
    return this.snapshot(s)
  }

  async deleteSession(id: string) {
    await this.request('DELETE', `/sessions/${id}`)
    this.live.delete(id)
    this.watching.delete(id)
    this.repository.remove(this.historyKey(id))
    this.repository.remove(this.titleKey(id))
  }

  async *submit(input: SubmitInput, signal: AbortSignal): AsyncIterable<ReplyEvent> {
    const s = this.state(input.sessionId)
    let base = s.messages

    if (input.mode === 'revise') {
      const idx = base.findIndex((m) => m.id === input.reviseTargetId)
      if (idx >= 0) {
        base = base.slice(0, idx)
        s.revision += 1
      }
    } else if (input.mode === 'retry') {
      const idx = base.map((m) => m.role).lastIndexOf('user')
      base = idx >= 0 ? base.slice(0, idx + 1) : base
    }

    if (input.mode !== 'retry') {
      base = [
        ...base,
        {
          id: `${s.id}:${base.length}`,
          sequence: base.length,
          version: fingerprint(input.text),
          role: 'user',
          text: input.text,
          status: 'complete',
          reference: input.reference,
          clientMessageId: input.clientMessageId,
          createdAt: Date.now(),
        },
      ]
    }
    s.messages = base
    if (!s.title) s.title = input.text.slice(0, 24)
    this.reconcileHistory(s)

    const path = input.mode === 'send' ? '/workshop' : input.mode === 'revise' ? '/edit' : '/retry'
    const res = await this.request(
      'POST',
      path,
      s.id,
      input.mode === 'retry' ? undefined : { content: contentForServer(input.text, input.reference, base) },
      signal,
    )

    yield { type: 'accepted', requestId: input.requestId, sessionId: s.id, snapshot: this.snapshot(s) }

    const replyId = `${s.id}:${base.length}`
    let started = false
    let lastVoice = -1
    let text = ''
    let failed: string | null = null

    const start = (): ReplyEvent => {
      started = true
      return { type: 'reply_started', requestId: input.requestId, sessionId: s.id, messageId: replyId }
    }
    const delta = (chunk: string): ReplyEvent => {
      text += chunk
      return { type: 'reply_delta', requestId: input.requestId, sessionId: s.id, messageId: replyId, chunk }
    }

    for await (const ev of readSse(res)) {
      const type = String(ev.type ?? '')
      if (type === 'voice_start' || type === 'voice_delta') {
        const index = Number(ev.index ?? 0)
        if (!started) yield start()
        if (lastVoice >= 0 && index !== lastVoice && text) yield delta('\n\n')
        lastVoice = index
        if (type === 'voice_delta' && ev.content) yield delta(String(ev.content))
      } else if (type === 'error') {
        failed = String(ev.detail ?? '这一轮没有生成出来。你的输入已经保存，可以重试。')
      }
    }

    const fresh = await this.refresh(s.id)
    if (failed) {
      yield {
        type: 'reply_failed',
        requestId: input.requestId,
        sessionId: s.id,
        reason: failed,
        snapshot: this.snapshot(fresh),
      }
      return
    }
    yield {
      type: 'reply_complete',
      requestId: input.requestId,
      sessionId: s.id,
      messageId: replyId,
      snapshot: this.snapshot(fresh),
    }
    // 回应一落定，服务端就把回看与沉淀排进了后台；这边轻轮询等它。
    this.watchMemory(s.id, fresh.revision)
  }

  private watchMemory(sid: string, revision: number) {
    if (this.watching.has(sid)) return
    this.watching.add(sid)
    this.emit({ type: 'memory_started', sessionId: sid, historyRevision: revision })
    const startedAt = Date.now()
    let pendingSeen = 0

    const fail = (reason: string) => {
      this.watching.delete(sid)
      this.emit({ type: 'memory_failed', sessionId: sid, historyRevision: revision, reason })
    }
    const again = () => {
      if (Date.now() - startedAt > 180_000) {
        fail('共同记录这一轮等太久了，可以重试。')
        return
      }
      setTimeout(() => void tick(), 1500)
    }
    const tick = async () => {
      const s = this.live.get(sid)
      if (!s || s.revision !== revision) {
        this.watching.delete(sid)
        return
      }
      let f: FoundationPayload
      try {
        f = await this.json<FoundationPayload>('GET', '/foundation', sid)
      } catch {
        again()
        return
      }
      const state = f.memory?.state ?? 'error'
      if (state === 'updating' || (state === 'pending' && pendingSeen++ < 3)) {
        again()
        return
      }
      if (state !== 'ready') {
        fail(f.memory?.detail || '共同记录暂未更新，对话已保存。')
        return
      }
      let g: Groundwork | null
      try {
        g = await this.groundworkFrom(s, f)
      } catch {
        again()
        return
      }
      this.watching.delete(sid)
      if (!g) {
        fail('还没有可以沉淀的内容。')
        return
      }
      s.groundwork = g
      this.reconcileHistory(s)
      this.emit({ type: 'memory_updated', sessionId: sid, historyRevision: revision, groundwork: g })
    }
    setTimeout(() => void tick(), 800)
  }

  retryMemory(sessionId: string) {
    const s = this.state(sessionId)
    void this.request('POST', '/memory/retry', sessionId)
      .then(() => this.watchMemory(sessionId, s.revision))
      .catch(() =>
        this.emit({
          type: 'memory_failed',
          sessionId,
          historyRevision: s.revision,
          reason: '没有连上后端。',
        }),
      )
  }

  async requestBrief(
    req: BriefRequest,
    signal: AbortSignal,
    onDelta?: (markdown: string) => void,
  ): Promise<BriefSnapshot> {
    const s = this.state(req.sessionId)
    const res = await this.request('POST', '/brief', req.sessionId, undefined, signal)
    let markdown = ''
    let error: string | null = null
    for await (const ev of readSse(res)) {
      const type = String(ev.type ?? '')
      if (type === 'brief_delta') {
        markdown += String(ev.content ?? '')
        onDelta?.(markdown)
      }
      else if (type === 'brief_done') markdown = String(ev.brief ?? markdown)
      else if (type === 'error') error = String(ev.detail ?? '简报没有生成出来。')
    }
    if (error) throw new Error(error)
    const covered = s.groundwork?.coveredThrough ?? -1
    return {
      id: req.requestId,
      historyRevision: req.historyRevision,
      cutoffSequence: s.messages.at(-1)?.sequence ?? -1,
      groundworkVersion: s.groundwork?.version ?? 0,
      markdown: markdown.trim(),
      uncovered: s.messages.filter((m) => m.role === 'user' && m.sequence > covered).map((m) => m.text),
      quotedSources: [],
      createdAt: Date.now(),
    }
  }
}
