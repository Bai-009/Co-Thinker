// 两版地基之间的变化。编号是条目在新版清单里的位置（从 1 起），与思考页上的序号一致。

import type { Groundwork, GroundworkClaim } from './types'

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

export interface ArrangedClaim {
  claim: GroundworkClaim
  /** 在清单里的位置，从 1 起，和思考页上的编号一致。 */
  n: number
  /** 这一条的来路：被它接替的旧条目，近的在上。 */
  origins: { claim: GroundworkClaim; n: number }[]
}

/**
 * 共识清单的排法。被取代的条目不划掉，挂在最终接替它的那条下面，当它的来路：
 * 02 是 01 想清楚之后的样子，先读到现在，再看它从哪来。
 * 顺着接替关系走不到一条现行条目的（指向缺失，或绕成了圈），留在原位。编号始终是清单里的位置。
 */
export function arrangeClaims(claims: GroundworkClaim[]): ArrangedClaim[] {
  const index = new Map(claims.map((c, i) => [c.id, i]))
  const rootOf = (i: number): number | null => {
    const seen = new Set<number>()
    let k = i
    while (claims[k].status === 'superseded') {
      if (seen.has(k)) return null
      seen.add(k)
      const by = claims[k].supersededBy
      const next = by === undefined ? undefined : index.get(by)
      if (next === undefined) return null
      k = next
    }
    return k
  }
  const origins = new Map<number, number[]>()
  const stays = new Set<number>()
  claims.forEach((c, i) => {
    if (c.status !== 'superseded') return
    const root = rootOf(i)
    if (root === null) stays.add(i)
    else origins.set(root, [...(origins.get(root) ?? []), i])
  })
  return claims.flatMap((claim, i) => {
    if (claim.status === 'superseded' && !stays.has(i)) return []
    const from = (origins.get(i) ?? []).sort((a, b) => b - a)
    return [{ claim, n: i + 1, origins: from.map((k) => ({ claim: claims[k], n: k + 1 })) }]
  })
}
