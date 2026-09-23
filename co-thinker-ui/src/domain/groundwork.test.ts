import { describe, expect, it } from 'vitest'
import { arrangeClaims, groundworkDelta, isEmptyDelta } from './groundwork'
import type { Groundwork, GroundworkClaim } from './types'

const claim = (
  id: string,
  status: GroundworkClaim['status'],
  text = id,
  supersededBy?: string,
): GroundworkClaim => ({ id, text, status, sourceIds: [], supersededBy })

const ground = (version: number, claims: GroundworkClaim[], open: string[] = []): Groundwork => ({
  version,
  historyRevision: 1,
  coveredThrough: version * 2 - 1,
  prose: '',
  claims,
  open,
  updatedAt: 0,
})

describe('两版地基之间的变化', () => {
  it('第一版：定下的算定下，还没定的另说', () => {
    const next = ground(1, [claim('c0', 'confirmed'), claim('c1', 'tentative')], ['问题一'])
    expect(groundworkDelta(null, next)).toEqual({
      confirmed: [1],
      tentative: [2],
      superseded: [],
      opened: 1,
      closed: 0,
    })
  })

  it('还没定的转为定下只算一次定下，改了说法也不算新增', () => {
    const prev = ground(1, [claim('c0', 'confirmed'), claim('c1', 'tentative')], ['问题一'])
    const next = ground(
      2,
      [claim('c0', 'confirmed'), claim('c1', 'confirmed', '改了说法'), claim('c2', 'tentative')],
      ['问题二'],
    )
    expect(groundworkDelta(prev, next)).toEqual({
      confirmed: [2],
      tentative: [3],
      superseded: [],
      opened: 1,
      closed: 1,
    })
  })

  it('被取代的条目指向取代它的那一条', () => {
    const prev = ground(1, [claim('c0', 'confirmed'), claim('c1', 'confirmed')])
    const next = ground(2, [
      claim('c0', 'confirmed'),
      claim('c1', 'superseded', 'c1', 'c2'),
      claim('c2', 'confirmed'),
    ])
    expect(groundworkDelta(prev, next)).toEqual({
      confirmed: [3],
      tentative: [],
      superseded: [[2, 3]],
      opened: 0,
      closed: 0,
    })
  })

  it('原样重来一次没有变化', () => {
    const g = ground(1, [claim('c0', 'confirmed')], ['问题一'])
    expect(isEmptyDelta(groundworkDelta(g, { ...g, version: 2 }))).toBe(true)
  })
})

describe('arrangeClaims', () => {
  const shape = (claims: GroundworkClaim[]) =>
    arrangeClaims(claims).map((a) => [a.n, a.origins.map((o) => o.n)] as const)

  it('被取代的条目挂在接替它的那条下面，编号不变', () => {
    const claims = [claim('c0', 'superseded', '旧', 'c1'), claim('c1', 'confirmed'), claim('c2', 'confirmed')]
    expect(shape(claims)).toEqual([[2, [1]], [3, []]])
  })

  it('接替了又被接替：一路挂到现在那条下面，近的在上', () => {
    const claims = [
      claim('c0', 'superseded', 'a', 'c1'),
      claim('c1', 'superseded', 'b', 'c3'),
      claim('c2', 'confirmed'),
      claim('c3', 'confirmed'),
    ]
    expect(shape(claims)).toEqual([[3, []], [4, [2, 1]]])
  })

  it('指向缺失或绕成圈的，留在原位', () => {
    const claims = [
      claim('c0', 'superseded', '没指向'),
      claim('c1', 'superseded', '指向不存在的', 'c9'),
      claim('c2', 'superseded', '圈', 'c3'),
      claim('c3', 'superseded', '圈', 'c2'),
      claim('c4', 'confirmed'),
    ]
    expect(shape(claims)).toEqual([[1, []], [2, []], [3, []], [4, []], [5, []]])
  })
})
