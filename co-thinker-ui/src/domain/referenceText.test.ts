import { composeReference, parseSourceLabel, sourceLabel, splitReference } from './referenceText'

describe('引用写进正文', () => {
  it('拼出来能拆回去，多行引文也行', () => {
    const content = composeReference('我不同意第二个前提。', { source: sourceLabel('assistant', 3), quote: '第一行\n第二行' })
    expect(content).toBe('引用材料（模型那一边 第 4 句，引用不代表认同）：\n> 第一行\n> 第二行\n\n我不同意第二个前提。')
    expect(splitReference(content)).toEqual({
      text: '我不同意第二个前提。',
      reference: { source: '模型那一边 第 4 句', quote: '第一行\n第二行' },
    })
  })

  it('普通正文原样返回', () => {
    expect(splitReference('普通输入')).toEqual({ text: '普通输入' })
    expect(splitReference('引用材料（x）：\n没有引文块')).toEqual({ text: '引用材料（x）：\n没有引文块' })
  })

  it('来源标签能解析，别的标签返回 null', () => {
    expect(parseSourceLabel(sourceLabel('user', 0))).toEqual({ role: 'user', sequence: 0 })
    expect(parseSourceLabel('模型那一边 第 12 句')).toEqual({ role: 'assistant', sequence: 11 })
    expect(parseSourceLabel('Co-Thinker')).toBeNull()
  })
})
