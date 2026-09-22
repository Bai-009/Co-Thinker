import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from './Icon'

export function IconButton({
  name,
  label,
  onClick,
  ...props
}: { name: string; label: string; onClick?: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="ct-icon" aria-label={label} title={label} onClick={onClick} {...props}>
      <Icon name={name} />
    </button>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  /** 只留标题和内容，不要顶栏和关闭按钮——给一句话的确认用。 */
  plain?: boolean
}

/** 能不能做过渡：有 Web Animations、且没有要求减少动态。 */
export const canAnimate = () =>
  typeof Element !== 'undefined' &&
  typeof Element.prototype.animate === 'function' &&
  !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

export function Dialog({ open, onClose, title, subtitle, children, className = '', plain = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [closing, setClosing] = useState(false)
  // 淡出的那两百毫秒里，内容还得在——父组件这时往往已经把它清空了。
  const kept = useRef<ReactNode>(children)
  if (open) kept.current = children

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const shut = () => {
      if (typeof el.close === 'function') el.close()
      else el.open = false
    }
    // jsdom 没有实现 showModal，退回普通打开，状态仍然对得上。
    if (open) {
      setClosing(false)
      if (!el.open) {
        if (typeof el.showModal === 'function') el.showModal()
        else el.open = true
        // 焦点落在框上，而不是第一个按钮——打开时不该有一圈焦点环。
        el.focus({ preventScroll: true })
      }
      return
    }
    if (!el.open) return
    // 关的时候先淡出，再真正关掉；没有动画能力（测试环境、减少动态）就直接关。
    if (!canAnimate()) {
      shut()
      return
    }
    setClosing(true)
    const t = window.setTimeout(() => {
      shut()
      setClosing(false)
    }, 230)
    return () => window.clearTimeout(t)
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`ct-dialog ${className}${closing ? ' is-closing' : ''}`}
      aria-label={title}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return
        const r = ref.current.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
          onClose()
        }
      }}
    >
      {plain ? (
        <h2 className="ct-dialog-title">{title}</h2>
      ) : (
        <div className="ct-dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="ct-dialog-sub">{subtitle}</p>}
          </div>
          <IconButton name="close" label="关闭" onClick={onClose} />
        </div>
      )}
      {closing ? kept.current : children}
    </dialog>
  )
}
