import { useEffect, useRef, useState } from 'react'
import type { BriefRelation } from '../domain/types'
import type { BriefState } from '../controller/useSession'
import { Markdown } from './Markdown'
import Icon from './Icon'
import { SheetHead, when, type SheetView } from './Sheet'

interface Props {
  brief: BriefState
  relation: BriefRelation
  /** 这份 Prompt 依据人说的前几句。 */
  coveredTurns: number
  views: SheetView[]
  onSwitch: (view: SheetView) => void
  onClose?: () => void
  onRegenerate: () => void
}

/** 先试异步剪贴板，不行再退回选中复制；两条路都不通才算没复制上。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 落到下面 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function PromptSheet({ brief, relation, coveredTurns, views, onSwitch, onClose, onRegenerate }: Props) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  // 一份新稿到了：边写边看过的，就不再演一遍；一下子整份到的，各段依次显出来。
  const [fresh, setFresh] = useState(false)
  const lastId = useRef<string | null>(null)
  const sawDraft = useRef(false)
  const snapshot = brief.snapshot
  if (brief.loading && brief.draft) sawDraft.current = true

  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!snapshot || snapshot.id === lastId.current) return
    lastId.current = snapshot.id
    setFresh(!sawDraft.current)
    sawDraft.current = false
    setCopied('idle')
  }, [snapshot])

  const copy = async () => {
    if (!snapshot) return
    const ok = await copyText(snapshot.markdown)
    setCopied(ok ? 'done' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('idle'), 2400)
  }

  const stale = relation.added || relation.quoteChanged
  const meta = brief.loading
    ? '正在凝成'
    : snapshot
      ? `依据前 ${coveredTurns} 轮对话和地基 · ${when(snapshot.createdAt)}`
      : brief.error
        ? '没有生成出来'
        : ''

  const actions = snapshot ? (
    <>
      <button type="button" className="ct-quiet" onClick={onRegenerate}>
        重新生成
      </button>
      <button
        type="button"
        className={`ct-pill is-small${copied === 'done' ? ' is-done' : ''}`}
        onClick={() => void copy()}
        aria-live="polite"
      >
        <Icon name={copied === 'done' ? 'check' : 'copy'} />
        {copied === 'done' ? '已复制' : copied === 'failed' ? '没复制上' : '复制'}
      </button>
    </>
  ) : null

  return (
    <div className="ct-sheet ct-prompt-content">
      <SheetHead views={views} current="prompt" onSwitch={onSwitch} meta={meta} busy={brief.loading} actions={actions} onClose={onClose} />

      <div className="ct-sheet-scroll">
        {snapshot && stale && (
          <p className="ct-sheet-status" role="status">
            {relation.quoteChanged ? '这份 Prompt 采用的原话后来改过。' : '这份 Prompt 之后，对话又往前走了。'}
            <button type="button" onClick={onRegenerate}>
              重新生成
            </button>
          </p>
        )}

        {brief.error && (
          <div className="ct-turn-error" role="alert">
            {brief.error}
            <button type="button" onClick={onRegenerate}>
              重新生成
            </button>
          </div>
        )}

        {brief.loading && !brief.draft && (
          <div className="ct-crystallizing" role="status">
            <span className="ct-thinking" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            正在把这场对话凝成 Prompt
          </div>
        )}

        {brief.loading && brief.draft && (
          <article className="ct-prompt-doc is-streaming" aria-busy="true">
            <div className="ct-markdown">
              <Markdown source={brief.draft} />
            </div>
            <span className="ct-stream-cursor" aria-hidden="true" />
          </article>
        )}

        {snapshot && !brief.loading && (
          <>
            <article className={`ct-prompt-doc${fresh ? ' is-fresh' : ''}`}>
              <div className="ct-markdown">
                <Markdown source={snapshot.markdown} />
              </div>
            </article>
            <p className="ct-prompt-foot">复制下来，可以直接交给 Cursor、Claude Code 这类执行 agent。</p>
          </>
        )}
      </div>
    </div>
  )
}
