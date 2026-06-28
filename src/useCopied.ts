import { useState } from 'react'

// 复制到剪贴板 + 短暂「已复制」反馈。解读/深度分析/数据导出三处共用，统一时长与行为。
export function useCopied(ms = 1600) {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), ms)
    }).catch(() => { /* 剪贴板不可用，忽略 */ })
  }
  return { copied, copy }
}
