import { describe, expect, it } from 'vitest'
import { dropRepeats, similarity } from './similar'

const focus = '第一页从哪个例子进，直接看改了一个名字另一个也跟着变的现象，还是先从整数讲起'
const q1 = '第一页从「改了 a，b 也跟着变」这种可变对象的现象进，还是先从整数讲起，还没选'
const q2 = '例子要用可变对象，名字绑定和盒子两种说法才会分开，还没定'
const q3 = '先做前端原型和第一页选哪个例子可能是同一步，选例子躲不掉，还没定'

describe('similarity', () => {
  it('scores the same question written twice well above different questions', () => {
    const same = similarity(focus, q1)
    console.log('same', same.toFixed(2), 'different', similarity(q2, q3).toFixed(2), similarity(focus, q3).toFixed(2), similarity(q1, q2).toFixed(2))
    expect(same).toBeGreaterThan(similarity(q2, q3))
    expect(same).toBeGreaterThan(similarity(focus, q3))
  })
})

describe('dropRepeats', () => {
  it('keeps the later, fuller wording and every distinct question', () => {
    expect(dropRepeats([focus, q1, q2, q3])).toEqual([q1, q2, q3])
  })
  it('leaves distinct items alone', () => {
    expect(dropRepeats(['读者是谁，还没定', '用不用后端，还没定'])).toEqual(['读者是谁，还没定', '用不用后端，还没定'])
  })
})
