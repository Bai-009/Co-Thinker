import { useEffect, useRef, type ReactNode } from 'react'
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
}

export function Dialog({ open, onClose, title, subtitle, children, className = '' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // jsdom 没有实现 showModal，退回普通打开，状态仍然对得上。
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.open = true
    }
    if (!open && el.open) {
      if (typeof el.close === 'function') el.close()
      else el.open = false
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`ct-dialog ${className}`}
      aria-label={title}
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
      <div className="ct-dialog-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="ct-dialog-sub">{subtitle}</p>}
        </div>
        <IconButton name="close" label="关闭" onClick={onClose} />
      </div>
      {children}
    </dialog>
  )
}
