import { useCallback, useState } from 'react'

import { API, postStream } from '../lib/api'
import { readSSE } from '../lib/sse'

// Drives the execution-brief modal: triggers generation, accumulates
// streamed markdown, and exposes copy/error state.

export default function useBrief() {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  const generate = useCallback(async () => {
    setOpen(true)
    setContent('')
    setError('')
    setCopyStatus('')
    setStreaming(true)

    let accum = ''
    try {
      const response = await postStream(API.brief, null)
      await readSSE(response, (evt) => {
        if (evt.type === 'brief_delta') {
          accum += evt.content
          setContent(accum)
        } else if (evt.type === 'brief_done') {
          setContent(evt.brief || accum)
        } else if (evt.type === 'error') {
          setError(evt.detail || '生成失败')
        }
      })
    } catch (err) {
      setError(`网络错误：${err.message}`)
    } finally {
      setStreaming(false)
    }
  }, [])

  const copy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopyStatus('已复制')
    } catch {
      setCopyStatus('复制失败')
    }
    setTimeout(() => setCopyStatus(''), 2000)
  }, [content])

  const reset = useCallback(() => {
    setOpen(false)
    setContent('')
    setError('')
    setCopyStatus('')
  }, [])

  return {
    open,
    content,
    streaming,
    error,
    copyStatus,
    generate,
    copy,
    setOpen,
    reset,
  }
}
