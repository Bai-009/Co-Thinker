import { describe, expect, it } from 'vitest'
import { morphSegments, morphTokens } from './morph'

const side = (segs: ReturnType<typeof morphSegments>, keep: Array<'keep' | 'old' | 'new'>) =>
  segs.filter(([, s]) => keep.includes(s)).map(([t]) => t).join('')

describe('morph', () => {
  it('中文一字一格，英文单词整块', () => {
    expect(morphTokens('学会 Python。')).toEqual(['学', '会', ' ', 'Python', '。'])
  })

  it('两边都能原样拼回来', () => {
    const from = '做一个 Python 网站，给刚学编程的人看，讲底层原理，不讲语法。'
    const to = '做一个 Python 网站，给会照着写、但不知道代码跑起来时发生了什么的人看，讲底层原理，不讲语法。'
    const segs = morphSegments(from, to)
    expect(side(segs, ['keep', 'old'])).toBe(from)
    expect(side(segs, ['keep', 'new'])).toBe(to)
  })

  it('留下的是两句共有的骨架', () => {
    const segs = morphSegments('想做一个和 Python 学习、网站有关的东西。', '内容是学会 Python。')
    expect(side(segs, ['keep'])).toBe(' Python。')
  })
})
