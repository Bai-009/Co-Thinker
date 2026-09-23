import { describe, expect, it } from 'vitest'
import { paragraphs } from './prose'

describe('paragraphs', () => {
  it('keeps the writer’s own line breaks', () => {
    expect(paragraphs('第一段。\n第二段。\n\n第三段。')).toEqual(['第一段。', '第二段。', '第三段。'])
  })

  it('leaves a short single paragraph alone', () => {
    expect(paragraphs('做一个 Python 网站，讲原理，不讲语法。')).toEqual(['做一个 Python 网站，讲原理，不讲语法。'])
  })

  it('starts a new paragraph where the undecided part begins, without changing a character', () => {
    const text =
      '做一个 Python 网站，给已经会照着写一点、但不知道代码跑起来时发生了什么的人看，讲底层原理，不讲语法。' +
      '第一个页面讲变量，一个名字绑到一个对象上，不是一个盒子里装着值。做法上也定了：先做前端原型，用 Cursor 边做边学。' +
      '还没定的有两件。一件是讲变量时画不画内存里的地址。另一件是读者能不能自己敲一行试试。'
    const out = paragraphs(text)
    expect(out.join('')).toBe(text)
    expect(out.length).toBeGreaterThan(1)
    expect(out.some((p) => p.startsWith('还没定的有两件。'))).toBe(true)
  })

  it('keeps a trailing fragment without end punctuation', () => {
    const text = '一'.repeat(120) + '。' + '最后半句没有句号'
    const out = paragraphs(text)
    expect(out.join('')).toBe(text)
    expect(out.at(-1)!.endsWith('最后半句没有句号')).toBe(true)
  })

  it('does not leave a single short sentence as its own paragraph', () => {
    const text =
      '做的是一个 Python 网站，讲底层原理，不讲语法。读者定下来了：已经会写一点，会照着写，但不知道代码跑起来的时候发生了什么。' +
      '还没定的是从哪讲起。有一路是从他们天天写却没停下来的那几行切进去，比如 x = 5 之后 x 住在哪，不走从硬件往下讲。还没认下。'
    const out = paragraphs(text)
    expect(out.join('')).toBe(text)
    expect(out.every((p) => p.length >= 20)).toBe(true)
    expect(out.at(-1)!.endsWith('还没认下。')).toBe(true)
    expect(out.some((p) => p.startsWith('还没定的是从哪讲起。'))).toBe(true)
  })
})
