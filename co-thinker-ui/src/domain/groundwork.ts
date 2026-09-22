// 两版地基之间的变化。编号是条目在新版清单里的位置（从 1 起），与思考页上的序号一致。

import type { Groundwork } from './types'

export interface GroundworkDelta {
  /** 这一版定下的条目：新增即定，或由「还没定」转为定下。 */
  confirmed: number[]
  /** 新增但还没定的条目。 */
  tentative: number[]
  /** 被取代的条目：[旧, 新]。新的找不到时为 0。 */
  superseded: [number, number][]
  opened: number
  closed: number
}

export function groundworkDelta(prev: Groundwork | null, next: Groundwork): GroundworkDelta {
  const before = new Map((prev?.claims ?? []).map((c) => [c.id, c]))
  const position = new Map(next.claims.map((c, i) => [c.id, i + 1]))
  const delta: GroundworkDelta = { confirmed: [], tentative: [], superseded: [], opened: 0, closed: 0 }

  next.claims.forEach((claim, i) => {
    const n = i + 1
    const old = before.get(claim.id)
    if (claim.status === 'superseded') {
      if (old && old.status !== 'superseded') {
        delta.superseded.push([n, claim.supersededBy ? (position.get(claim.supersededBy) ?? 0) : 0])
      }
      return
    }
    if (claim.status === 'confirmed' && old?.status !== 'confirmed') delta.confirmed.push(n)
    else if (claim.status === 'tentative' && !old) delta.tentative.push(n)
  })

  const wasOpen = new Set(prev?.open ?? [])
  const isOpen = new Set(next.open)
  delta.opened = next.open.filter((q) => !wasOpen.has(q)).length
  delta.closed = (prev?.open ?? []).filter((q) => !isOpen.has(q)).length
  return delta
}

export const isEmptyDelta = (d: GroundworkDelta): boolean =>
  !d.confirmed.length && !d.tentative.length && !d.superseded.length && !d.opened && !d.closed
