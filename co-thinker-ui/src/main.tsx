import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { HttpTransport } from './transport/httpTransport'

// 默认走示例传输层；`?live` 或 VITE_TRANSPORT=live 时对接 backend/（经 Vite 代理到 8000）。
const live =
  new URLSearchParams(window.location.search).has('live') ||
  import.meta.env.VITE_TRANSPORT === 'live'

// 地基、Prompt 和对话列表的滚动条只在滚动时浮出来：滚动时挂上 is-scrolling，停下 900ms 后摘掉，样式在 workbench.css。
const idle = new WeakMap<Element, ReturnType<typeof setTimeout>>()
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target
    if (!(el instanceof Element) || !el.matches('.ct-sheet-scroll, .ct-conversations')) return
    el.classList.add('is-scrolling')
    clearTimeout(idle.get(el))
    idle.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900))
  },
  { capture: true, passive: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App transport={live ? new HttpTransport() : undefined} />
  </StrictMode>,
)
