// 引用按 { 会话, 消息 id, 版本, 规范化文本上的半开区间 } 定位，不做文本查找。

import { normalize } from './markdown'
import type { GroundworkClaim, Message, Reference } from './types'

/** 文本 run 在规范化文本里的起点。 */
export const OFFSET_ATTR = 'data-o'

function runStart(el: Element | null): number | null {
  const holder = el?.closest(`[${OFFSET_ATTR}]`)
  if (!holder) return null
  const raw = holder.getAttribute(OFFSET_ATTR)
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : null
}

function textLength(el: Element): number {
  return el.textContent?.length ?? 0
}

/** DOM 位置 → 规范化偏移。不能用 textContent 反推：控件文字会被算进去。 */
export function offsetFromDom(node: Node, offset: number, root: Element): number | null {
  if (!root.contains(node)) return null
  if (node.nodeType === Node.TEXT_NODE) {
    const start = runStart(node.parentElement)
    return start == null ? null : start + offset
  }
  const el = node as Element
  const children = Array.from(el.childNodes)
  const after = children[offset]
  if (after) {
    const target =
      after.nodeType === Node.TEXT_NODE
        ? runStart((after as Text).parentElement)
        : runStart((after as Element).querySelector(`[${OFFSET_ATTR}]`) ?? (after as Element))
    if (target != null) return target
  }
  const runs = el.querySelectorAll(`[${OFFSET_ATTR}]`)
  const last = runs[runs.length - 1]
  if (last) {
    const start = runStart(last)
    if (start != null) return start + textLength(last)
  }
  return runStart(el)
}

export interface SelectionRange {
  start: number
  end: number
  quote: string
}

/** 选区必须完整落在同一条消息里。 */
export function rangeFromSelection(
  selection: Selection | null,
  root: Element,
  sourceText: string,
): SelectionRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (!anchorNode || !focusNode) return null
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return null
  const a = offsetFromDom(anchorNode, anchorOffset, root)
  const b = offsetFromDom(focusNode, focusOffset, root)
  if (a == null || b == null) return null
  let start = Math.min(a, b)
  let end = Math.max(a, b)
  const normalized = sourceText
  while (start < end && /\s/.test(normalized[start] ?? '')) start += 1
  while (end > start && /\s/.test(normalized[end - 1] ?? '')) end -= 1
  if (end <= start) return null
  return { start, end, quote: normalized.slice(start, end) }
}

export function makeReference(
  sessionId: string,
  message: Message,
  range?: SelectionRange,
): Reference {
  const text = normalize(message.text)
  if (!range) {
    return { sessionId, sourceId: message.id, sourceVersion: message.version, quote: text }
  }
  return {
    sessionId,
    sourceId: message.id,
    sourceVersion: message.version,
    range: { start: range.start, end: range.end },
    quote: range.quote,
  }
}

/** 引地基里的一条：sourceId 记清单编号，不记版本。条目原文照抄不变，字一样就是同一条。 */
export const CLAIM_SOURCE = 'claim:'
/** 引待定里的一条：待定没有编号，按原文找。 */
export const OPEN_SOURCE = 'open'

export function makeClaimReference(sessionId: string, n: number, text: string): Reference {
  return { sessionId, sourceId: `${CLAIM_SOURCE}${n}`, sourceVersion: 0, quote: text }
}

export function makeOpenReference(sessionId: string, text: string): Reference {
  return { sessionId, sourceId: OPEN_SOURCE, sourceVersion: 0, quote: text }
}

export function claimNumber(ref: Reference): number | null {
  if (!ref.sourceId.startsWith(CLAIM_SOURCE)) return null
  const n = Number(ref.sourceId.slice(CLAIM_SOURCE.length))
  return Number.isInteger(n) && n > 0 ? n : null
}

export type ReferenceState =
  | { status: 'resolved'; message: Message; start: number; end: number }
  | { status: 'changed'; message: Message }
  | { status: 'missing' }
  /** 引的是地基第 n 条；changed 表示那一条已经改写或被取代。 */
  | { status: 'claim'; n: number; changed: boolean }
  /** 引的是待定里的一条；changed 表示它已不在待定里。 */
  | { status: 'open'; changed: boolean }

export function resolveReference(
  ref: Reference | undefined | null,
  messages: Message[],
  sessionId: string,
  groundwork?: { claims: GroundworkClaim[]; open: string[] } | null,
): ReferenceState {
  if (!ref || ref.sessionId !== sessionId) return { status: 'missing' }
  const n = claimNumber(ref)
  if (n !== null) {
    const claim = groundwork?.claims[n - 1]
    return { status: 'claim', n, changed: !claim || claim.status === 'superseded' || claim.text !== ref.quote }
  }
  if (ref.sourceId === OPEN_SOURCE) return { status: 'open', changed: !groundwork?.open.includes(ref.quote) }
  const message = messages.find((m) => m.id === ref.sourceId)
  if (!message) return { status: 'missing' }
  if (message.version !== ref.sourceVersion) return { status: 'changed', message }
  const text = normalize(message.text)
  const start = ref.range?.start ?? 0
  const end = ref.range?.end ?? text.length
  if (text.slice(start, end) !== ref.quote) return { status: 'changed', message }
  return { status: 'resolved', message, start, end }
}

/** 引用块上的一行小字：引的是哪儿，还在不在。 */
export function referenceCaption(state: ReferenceState): string {
  switch (state.status) {
    case 'changed':
      return '引用 · 原文已修改'
    case 'missing':
      return '引用 · 原文已删除'
    case 'claim':
      return state.changed ? `引用 · 地基第 ${state.n} 条已改写` : `引用 · 地基第 ${state.n} 条`
    case 'open':
      return state.changed ? '引用 · 已不在待定里' : '引用 · 待定'
    default:
      return '引用'
  }
}
