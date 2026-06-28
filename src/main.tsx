import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LegalPage } from './components/LegalPages'
import './styles.css'

// 极简路由（不引路由库，保持轻量）：/terms、/privacy 渲染独立法律长页（备案/商店要求可独立访问），
// 其余一律进主应用。生产 node.ts 与 dev Vite 都把非 /api 路径兜底回 index.html，故这两条 URL 可直达。
const path = window.location.pathname
const 法律页 = path === '/terms' ? 'terms' : path === '/privacy' ? 'privacy' : null

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {法律页 ? <LegalPage kind={法律页} /> : <App />}
  </React.StrictMode>,
)
