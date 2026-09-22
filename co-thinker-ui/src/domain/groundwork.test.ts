import { describe, expect, it } from 'vitest'
import { groundworkDelta, isEmptyDelta } from './groundwork'
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
