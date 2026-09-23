// 引用怎么送给模型：写进正文，不开新字段。
//
// 这是这套架构自己的答案（frontend/src/workbench/references.js 与 principles.md 第 5 节）：
// thinker、rewriter、简报、判官都从消息正文读，引用写在正文里就一次全看到；
// 「引用不代表认同」写在字面上，rewriter 才不会把引文当成人的主张。
// 来源标签里带上那句的序号，刷新之后还能指回原句；不做跨消息的文字查找。
// 引地基里的一条时，来源写清单编号「地基 第 N 条」；引待定的一条写「地基 待定」。

export interface ReferenceText {
  /** 来源标签，如「模型那一边 第 4 句」。 */
  source: string
  quote: string
}

const HEAD = '引用材料（'
const TAIL = '，引用不代表认同）：'
const SPLIT_RE = /^引用材料（([^\n]*)，引用不代表认同）：\n((?:>[^\n]*(?:\n|$))+)\n([\s\S]*)$/
const LABEL_RE = /^(模型那一边|人这一边) 第 (\d+) 句$/
const CLAIM_LABEL_RE = /^地基 第 (\d+) 条$/
export const OPEN_LABEL = '地基 待定'

export function composeReference(text: string, ref: ReferenceText): string {
  const quoted = ref.quote.replace(/\r\n?/g, '\n').split('\n').map((line) => `> ${line}`).join('\n')
  return `${HEAD}${ref.source}${TAIL}\n${quoted}\n\n${text.trim()}`
}

export function splitReference(content: string): { text: string; reference?: ReferenceText } {
  const m = content.match(SPLIT_RE)
  if (!m) return { text: content }
  const quote = m[2]
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')
  return { text: m[3], reference: { source: m[1], quote } }
}

/** 来源标签 ⇄ （角色，序号）。序号从 1 数，给人看的；程序里用 sequence 从 0 数。 */
export function sourceLabel(role: 'user' | 'assistant', sequence: number): string {
  return `${role === 'assistant' ? '模型那一边' : '人这一边'} 第 ${sequence + 1} 句`
}

/** 引地基里的一条：编号从 1 数，和屏幕上一致。 */
export function claimLabel(n: number): string {
  return `地基 第 ${n} 条`
}

export type SourceLabel = { role: 'user' | 'assistant'; sequence: number } | { claim: number } | { open: true }

export function parseSourceLabel(label: string): SourceLabel | null {
  const m = label.match(LABEL_RE)
  if (m) return { role: m[1] === '模型那一边' ? 'assistant' : 'user', sequence: Number(m[2]) - 1 }
  const c = label.match(CLAIM_LABEL_RE)
  if (c) return { claim: Number(c[1]) }
  if (label === OPEN_LABEL) return { open: true }
  return null
}
