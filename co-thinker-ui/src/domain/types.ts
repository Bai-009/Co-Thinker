// 领域类型。不依赖 React，也不依赖传输实现。

export type Role = 'user' | 'assistant'

/** 失败与中断分开：恢复路径不同。 */
export type MessageStatus = 'complete' | 'streaming' | 'interrupted' | 'failed'

export interface Reference {
  sessionId: string
  sourceId: string
  sourceVersion: number
  /** 规范化源文本上的 UTF-16 半开区间。缺省表示整条。 */
  range?: { start: number; end: number }
  quote: string
}

export interface Message {
  id: string
  sequence: number
  /** 回改使它 +1，旧引用据此判断依据是否改变。 */
  version: number
  role: Role
  text: string
  status: MessageStatus
  reference?: Reference
  /** 回应对这一轮的把握，0–1；由传输层给出。 */
  confidence?: number
  /** 幂等键。 */
  clientMessageId?: string
  createdAt: number
  error?: string
}

/** 认识状态由传输层给出，前端不自行升级。 */
export type Epistemic = 'tentative' | 'confirmed' | 'superseded'

export interface GroundworkClaim {
  id: string
  text: string
  status: Epistemic
  sourceIds: string[]
  supersededBy?: string
}

export interface Groundwork {
  version: number
  historyRevision: number
  /** 已覆盖到的消息 sequence（含）。 */
  coveredThrough: number
  /** 第一人称正文。 */
  prose: string
  claims: GroundworkClaim[]
  open: string[]
  /** 这一轮的感觉：确定度、共振、清晰度，0–1。由传输层给出，界面只用来调纸的暖冷和纹理。 */
  sense?: { certainty: number; resonance: number; clarity: number }
  updatedAt: number
}

export type MemoryState = 'idle' | 'updating' | 'ready' | 'failed'

export interface MemoryStatus {
  state: MemoryState
  detail?: string
}

export interface BriefSnapshot {
  id: string
  /** 以下三项在请求时冻结。 */
  historyRevision: number
  cutoffSequence: number
  groundworkVersion: number
  markdown: string
  /** 请求时尚未被地基覆盖的表达。 */
  uncovered: string[]
  quotedSources: { id: string; version: number }[]
  createdAt: number
}

export interface BriefRelation {
  /** 之后有新增内容。 */
  added: boolean
  /** 采用过的原话被改过。 */
  quoteChanged: boolean
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  /** 仅示例模式。 */
  topic?: string
}

/** transport 交回的完整领域快照，前端不自行推导有效历史。 */
export interface SessionSnapshot {
  id: string
  title: string
  topic?: string
  historyRevision: number
  messages: Message[]
  groundwork: Groundwork | null
  /** 每一版地基，按 coveredThrough 递增；回改后只剩与有效历史相符的几版。 */
  groundworkHistory: Groundwork[]
  /** 仅示例模式。 */
  script?: { remaining: number; nextLine: string | null }
}
