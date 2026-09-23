import { makeClaimReference, makeOpenReference } from '../domain/reference'
import { describe, expect, it } from 'vitest'
import { resolveReference } from '../domain/reference'
import { contentForServer, fingerprint, openItems, parseAssistant, parseClaims, readSse, toMessages } from './httpTransport'

describe('服务端格式 → 领域', () => {
  it('多段浮现拆成正文，把握取平均，中断标记不留在正文里', () => {
    const stored =
      '[VOICE][CONF]0.60[/CONF]\n先说第一段。[/VOICE]\n\n[VOICE][CONF]0.80[/CONF]\n[INTERRUPTED]\n第二段说到一半[/VOICE]'
    const parsed = parseAssistant(stored)
    expect(parsed.text).toBe('先说第一段。\n\n第二段说到一半')
    expect(parsed.confidence).toBeCloseTo(0.7)
    expect(parsed.interrupted).toBe(true)
  })

  it('没有标记的旧内容原样保留', () => {
    expect(parseAssistant('直接一句话')).toEqual({ text: '直接一句话', interrupted: false })
  })

  it('地基清单：被取代的条目指向取代它的那条，编号按位置', () => {
    const list = [
      '1. 我们要做的是 Python 学习网站。',
      '2. ~~用 AI 边写边学，工具用 Cursor。~~ → 被 #4 取代（明确了顺序）',
      '3. 第一个最小页面：原理-代码对照卡。',
      '4. 先做前端原型再补后端，工具用 Cursor。',
    ].join('\n')
    const claims = parseClaims(list)
    expect(claims.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3'])
    expect(claims[1]).toMatchObject({ status: 'superseded', supersededBy: 'c3', text: '用 AI 边写边学，工具用 Cursor。', note: '明确了顺序' })
    expect(claims[3].note).toBeUndefined()
    expect(claims[3]).toMatchObject({ status: 'confirmed', text: '先做前端原型再补后端，工具用 Cursor。' })
  })

  it('待定的条目按分号分开，末尾的「还没定」「还没选」不再重复', () => {
    expect(openItems(['读者是谁，还没定', '用 Flask 还是 FastAPI，还没选；每页嵌一个沙盒，还没定。', null])).toEqual([
      '读者是谁',
      '用 Flask 还是 FastAPI',
      '每页嵌一个沙盒',
    ])
  })

  it('指纹：同文同号，改一字就变', () => {
    expect(fingerprint('构图仍然在引导观看')).toBe(fingerprint('构图仍然在引导观看'))
    expect(fingerprint('构图仍然在引导观看')).not.toBe(fingerprint('构图仍然在引导观看。'))
  })

  it('事件流按空行切帧，半截帧等下一段再拼', async () => {
    const encoder = new TextEncoder()
    const frames = ['data: {"type":"voice_start","index":0}\n\ndata: {"type":"voice_de', 'lta","content":"你好"}\n\n']
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        frames.forEach((f) => controller.enqueue(encoder.encode(f)))
        controller.close()
      },
    })
    const seen: unknown[] = []
    for await (const ev of readSse(new Response(stream))) seen.push(ev)
    expect(seen).toEqual([
      { type: 'voice_start', index: 0 },
      { type: 'voice_delta', content: '你好' },
    ])
  })
})

describe('引用走进正文', () => {
  const sid = 's1'
  const raw = [
    { role: 'user', content: '我想做一个整理想法的工具。' },
    { role: 'assistant', content: '[VOICE][CONF]0.60[/CONF]\n先分清给谁用：**自己**还是别人？[/VOICE]' },
  ]
  const quoted = '引用材料（模型那一边 第 2 句，引用不代表认同）：\n> 自己还是别人？\n\n先给自己用。'

  it('发送时把引用拼进正文，来源标签指向被引那句', () => {
    const messages = toMessages(sid, raw, [])
    const ref = { sessionId: sid, sourceId: 's1:1', sourceVersion: messages[1].version, quote: '自己还是别人？' }
    expect(contentForServer('先给自己用。', ref, messages)).toBe(quoted)
    expect(contentForServer('先给自己用。', undefined, messages)).toBe('先给自己用。')
  })

  it('刷新后从正文拆回引用，指回原句并定位到那一段', () => {
    const messages = toMessages(sid, [...raw, { role: 'user', content: quoted }], [])
    const last = messages[2]
    expect(last.text).toBe('先给自己用。')
    expect(last.version).toBe(fingerprint('先给自己用。'))
    expect(last.reference).toMatchObject({ sourceId: 's1:1', sourceVersion: messages[1].version, quote: '自己还是别人？' })
    expect(resolveReference(last.reference, messages, sid).status).toBe('resolved')
  })

  it('引地基里的一条：来源写清单编号，刷新后拆回来仍指向那一条', () => {
    const messages = toMessages(sid, raw, [])
    const content = contentForServer('这条要改。', makeClaimReference(sid, 2, '给自己用。'), messages)
    expect(content).toBe('引用材料（地基 第 2 条，引用不代表认同）：\n> 给自己用。\n\n这条要改。')
    const back = toMessages(sid, [...raw, { role: 'user', content }], [])
    expect(back[2].text).toBe('这条要改。')
    expect(back[2].reference).toMatchObject({ sourceId: 'claim:2', quote: '给自己用。' })
    expect(contentForServer('先定这个。', makeOpenReference(sid, '给谁用'), messages)).toContain('（地基 待定，引用不代表认同）')
  })

  it('原句变了就标依据已改变，不去别的消息里找', () => {
    const stored = [raw[0], { role: 'assistant', content: '[VOICE]改过的话[/VOICE]' }, { role: 'user', content: quoted }]
    const messages = toMessages(sid, stored, [])
    expect(resolveReference(messages[2].reference, messages, sid).status).toBe('changed')
  })
})
