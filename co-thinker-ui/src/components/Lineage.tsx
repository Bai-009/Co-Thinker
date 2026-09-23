import { useEffect, useRef, useState } from 'react'
import type { GroundworkClaim } from '../domain/types'
import { Morph } from './Morph'

/**
 * 一条有来路的共识。平时只读到现在的说法，句末一个上标的旧编号，说它由哪一条改来。
 * 指针停在上标或编号上，这句话原地变回原来的说法，编号滚回旧的，原因浮上来；指针离开这一条，再变回来。
 * 后台刚改写完、这一条第一次出现时，先摆出原来那句，再让它变成现在这句，放一遍。
 */

// 这一页里已经见过的接替，不重放。
const seen = new Set<string>()
// 地基更新多久以内算「刚改写完」。
const FRESH_MS = 6000

const num = (n: number) => String(n).padStart(2, '0')

interface Props {
  claim: GroundworkClaim
  n: number
  origin: { claim: GroundworkClaim; n: number }
  highlighted: boolean
  updatedAt: number
  onQuote: (text: string) => void
}

export function Lineage({ claim, n, origin, highlighted, updatedAt, onQuote }: Props) {
  const pair = `${origin.claim.text}\u0000${claim.text}`
  const fresh = useRef(!seen.has(pair) && Date.now() - updatedAt < FRESH_MS)
  const [past, setPast] = useState(fresh.current)
  const wait = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    seen.add(pair)
  }, [pair])
  useEffect(() => {
    if (!fresh.current) return
    // 先让人看见原来那句，再看它变成现在这句。
    const t = setTimeout(() => setPast(false), 900)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => () => clearTimeout(wait.current), [])

  const look = () => {
    clearTimeout(wait.current)
    wait.current = setTimeout(() => setPast(true), 110)
  }
  const back = () => {
    clearTimeout(wait.current)
    setPast(false)
  }

  return (
    <li
      className={`ct-ground-item ct-lineage${past ? ' is-past' : ''}${highlighted ? ' is-highlighted' : ''}`}
      data-claim={n}
      onPointerLeave={(e) => e.pointerType === 'mouse' && back()}
    >
      <span className="ct-ground-num ct-wheel" onPointerEnter={(e) => e.pointerType === 'mouse' && look()}>
        <span className="ct-wheel-now">{num(n)}</span>
        <span className="ct-wheel-past" aria-hidden="true">
          {num(origin.n)}
        </span>
      </span>
      <div className="ct-ground-body">
        <p className="ct-ground-text">
          <Morph from={origin.claim.text} to={claim.text} past={past}>
            <button
              type="button"
              className="ct-lineage-from"
              data-claim={origin.n}
              aria-label={`由第 ${origin.n} 条修改而来，查看修改前的内容`}
              aria-pressed={past}
              onPointerEnter={(e) => e.pointerType === 'mouse' && look()}
              onClick={(e) => {
                const type = (e.nativeEvent as PointerEvent).pointerType
                if (type !== 'mouse') setPast((p) => !p)
              }}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && setPast(true)}
              onBlur={back}
            >
              {num(origin.n)}
            </button>
          </Morph>
        </p>
        {origin.claim.note && (
          <div className="ct-lineage-why">
            <span className="ct-ground-why">{origin.claim.note}</span>
          </div>
        )}
      </div>
      <button type="button" className="ct-ground-quote" aria-label="引用这条" onClick={() => onQuote(claim.text)}>
        引用
      </button>
    </li>
  )
}
