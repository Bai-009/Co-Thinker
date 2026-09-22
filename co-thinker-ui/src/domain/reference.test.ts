import { describe, expect, it } from 'vitest'
import { normalize, parse } from './markdown'
import { makeReference, resolveReference } from './reference'
import type { Message } from './types'

const message = (id: string, text: string, version = 1): Message => ({
  id,
  sequence: 0,
  version,
  role: 'assistant',
  text,
  status: 'complete',
  createdAt: 0,
})

describe('规范化源文本', () => {
  it('留下人读到的那串字，不留 markdown 语法', () => {
    expect(normalize('这是**重点**，还有 `code`。')).toBe('这是重点，还有 code。')
    expect(normalize('## 标题\n\n正文一\n\n正文二')).toBe('标题\n正文一\n正文二')
  })

  it('每个文本 run 的起点，就是它在规范化文本里的位置', () => {
    const { blocks, text } = parse('前面**中间**后面')
    const p = blocks[0]
    expect(p.kind).toBe('p')
    if (p.kind !== 'p') return
    const starts: number[] = []
    const walk = (nodes: typeof p.children) => {
      for (const n of nodes) {
        if (n.kind === 'text' || n.kind === 'code') starts.push(n.start)
        else walk(n.children)
      }
    }
    walk(p.children)
    expect(starts).toEqual([0, 2, 4])
    expect(text.slice(2, 4)).toBe('中间')
  })

  it('表格和列表也有确定的规范化形式', () => {
    expect(normalize('- 甲\n- 乙')).toBe('甲\n乙')
    expect(normalize('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('a\tb\n1\t2')
  })
})

describe('引用的所指', () => {
  const sentence = '重新留意每天经过的地方'
  const messages = [
    message('a', `我想让大家${sentence}，但不想再做一本城市指南。`),
    message('b', '照片也在教。'),
    message('c', `要让人${sentence}，总得有人先把镜头对准某处。`),
  ]

  it('同一句话出现两次时，回到被选中的那一条', () => {
    const text = normalize(messages[2].text)
    const start = text.indexOf(sentence)
    const reference = makeReference('s1', messages[2], {
      start,
      end: start + sentence.length,
      quote: sentence,
    })

    expect(reference.sourceId).toBe('c')
    const state = resolveReference(reference, messages, 's1')
    expect(state.status).toBe('resolved')
    if (state.status !== 'resolved') return
    expect(state.message.id).toBe('c')
    expect(normalize(state.message.text).slice(state.start, state.end)).toBe(sentence)
  })

  it('源被改写之后说「依据已改变」，不静默跳到另一句相似的话', () => {
    const reference = makeReference('s1', messages[2])
    const edited = messages.map((m) =>
      m.id === 'c' ? { ...m, version: 2, text: `要让人${sentence}，先得自己站住。` } : m,
    )
    expect(resolveReference(reference, edited, 's1').status).toBe('changed')
  })

  it('换了会话或源已不在有效历史里，就是找不到来源', () => {
    const reference = makeReference('s1', messages[2])
    expect(resolveReference(reference, messages, 's2').status).toBe('missing')
    expect(resolveReference(reference, messages.slice(0, 2), 's1').status).toBe('missing')
  })
})
