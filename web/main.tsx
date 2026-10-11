import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrapBackend } from '@/lib/bootstrap'
import './index.css'

// 必须在渲染之前：静态演示站靠它把后端挂进浏览器（本机运行时是空实现）。
// 它是同步返回的——数据还没加载完也没关系，先到的请求会在内部排队。
bootstrapBackend()

const container = document.getElementById('root')
if (!container) {
  throw new Error('未找到 #root 挂载点，页面无法启动')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
