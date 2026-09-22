import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { HttpTransport } from './transport/httpTransport'

// 默认走示例传输层；`?live` 或 VITE_TRANSPORT=live 时对接 backend/（经 Vite 代理到 8000）。
const live =
  new URLSearchParams(window.location.search).has('live') ||
  import.meta.env.VITE_TRANSPORT === 'live'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App transport={live ? new HttpTransport() : undefined} />
  </StrictMode>,
)
