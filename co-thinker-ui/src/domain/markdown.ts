// markdown 子集。规范化文本与渲染树必须由同一次解析产出，否则引用偏移会对不上。

export type Inline =
  | { kind: 'text'; value: string; start: number }
  | { kind: 'code'; value: string; start: number }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }

export type Block =
  | { kind: 'p'; children: Inline[] }
  | { kind: 'h'; level: 2 | 3; children: Inline[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'pre'; value: string; start: number; lang?: string }
  | { kind: 'hr' }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }

/** 其余协议降级为纯文本。 */
const SAFE_PROTOCOL = /^(https?:|mailto:|#|\/)/i

export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  return SAFE_PROTOCOL.test(trimmed) ? trimmed : null
}

// --- 行内 -----------------------------------------------------------------

function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  let i = 0
  const flush = () => {
    if (buf) {
      out.push({ kind: 'text', value: buf, start: -1 })
      buf = ''
    }
  }
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ kind: 'code', value: src.slice(i + 1, end), start: -1 })
        i = end + 1
        continue
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 1) {
        flush()
        out.push({ kind: 'strong', children: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (ch === '*') {
      const end = src.indexOf('*', i + 1)
      if (end > i) {
        flush()
        out.push({ kind: 'em', children: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      const close = src.indexOf(']', i + 1)
      if (close > i && src[close + 1] === '(') {
        const paren = src.indexOf(')', close + 2)
        if (paren > close) {
          const href = safeHref(src.slice(close + 2, paren))
          const label = src.slice(i + 1, close)
          flush()
          if (href) out.push({ kind: 'link', href, children: parseInline(label) })
          else out.push(...parseInline(label))
          i = paren + 1
          continue
        }
      }
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

// --- 块 -------------------------------------------------------------------

const H_RE = /^(#{2,4})\s+(.*)$/
const UL_RE = /^\s*[-*]\s+(.*)$/
const OL_RE = /^\s*\d+[.)]\s+(.*)$/
const HR_RE = /^\s*(-{3,}|\*{3,})\s*$/
const DIVIDER_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      out.push({ kind: 'pre', value: body.join('\n'), start: -1, lang: lang || undefined })
      continue
    }
    if (HR_RE.test(line)) {
      out.push({ kind: 'hr' })
      i += 1
      continue
    }
    const h = H_RE.exec(line)
    if (h) {
      out.push({ kind: 'h', level: h[1].length === 2 ? 2 : 3, children: parseInline(h[2]) })
      i += 1
      continue
    }
    if (line.trimStart().startsWith('>')) {
      const body: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        body.push(lines[i].trimStart().replace(/^>\s?/, ''))
        i += 1
      }
      out.push({ kind: 'quote', blocks: parseBlocks(body) })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && DIVIDER_RE.test(lines[i + 1])) {
      const head = splitRow(line).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map(parseInline))
        i += 1
      }
      out.push({ kind: 'table', head, rows })
      continue
    }
    const ordered = OL_RE.test(line)
    if (ordered || UL_RE.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length) {
        const m = ordered ? OL_RE.exec(lines[i]) : UL_RE.exec(lines[i])
        if (!m) break
        items.push(parseInline(m[1]))
        i += 1
      }
      out.push({ kind: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) {
      para.push(lines[i].trim())
      i += 1
    }
    if (!para.length) {
      para.push(lines[i].trim())
      i += 1
    }
    out.push({ kind: 'p', children: parseInline(para.join('\n')) })
  }
  return out
}

function isBlockStart(line: string, next: string | undefined): boolean {
  if (HR_RE.test(line)) return true
  if (H_RE.test(line)) return true
  if (UL_RE.test(line) || OL_RE.test(line)) return true
  if (line.trimStart().startsWith('>')) return true
  if (line.trimStart().startsWith('```')) return true
  if (line.includes('|') && next !== undefined && DIVIDER_RE.test(next)) return true
  return false
}

// --- 规范化文本与偏移 ------------------------------------------------------

/** 按文档顺序标注每个文本 run 的起点，同时产出规范化文本。 */
function assign(blocks: Block[], state: { out: string }): void {
  const sep = () => {
    if (state.out) state.out += '\n'
  }
  const walkInline = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.kind === 'text' || n.kind === 'code') {
        n.start = state.out.length
        state.out += n.value
      } else {
        walkInline(n.children)
      }
    }
  }
  for (const b of blocks) {
    switch (b.kind) {
      case 'p':
      case 'h':
        sep()
        walkInline(b.children)
        break
      case 'quote':
        sep()
        assign(b.blocks, state)
        break
      case 'list':
        for (const item of b.items) {
          sep()
          walkInline(item)
        }
        break
      case 'pre':
        sep()
        b.start = state.out.length
        state.out += b.value
        break
      case 'table':
        for (const row of [b.head, ...b.rows]) {
          sep()
          row.forEach((cell, idx) => {
            if (idx > 0) state.out += '\t'
            walkInline(cell)
          })
        }
        break
      case 'hr':
        break
    }
  }
}

export interface Parsed {
  blocks: Block[]
  /** 引用区间落在这串字上。 */
  text: string
}

const cache = new Map<string, Parsed>()

export function parse(markdown: string): Parsed {
  const hit = cache.get(markdown)
  if (hit) return hit
  const blocks = parseBlocks((markdown ?? '').replace(/\r\n?/g, '\n').split('\n'))
  const state = { out: '' }
  assign(blocks, state)
  const parsed: Parsed = { blocks, text: state.out }
  if (cache.size > 400) cache.clear()
  cache.set(markdown, parsed)
  return parsed
}

export function normalize(markdown: string): string {
  return parse(markdown).text
}
