import { useRef, useState, useEffect } from 'react'
import type { 命盘 } from '../engine/types'
import { 指纹 } from '../engine'
import { streamPost } from '../stream'
import { useCopied } from '../useCopied'
import { renderRich } from './richText'

const 缓存键 = (c: 命盘, 系统: string) => `guanwo:analysis:${系统}:${指纹(c)}`

const 文案: Record<string, { 标题: string; 副: string; 维度: string }> = {
  八字: { 标题: '八字深度分析', 副: '把这张盘的性格、五行用神、事业、财运、感情、大运，一次讲透', 维度: '性格 · 用神 · 事业 · 财运 · 感情 · 大运' },
  紫微: { 标题: '紫微深度分析', 副: '从命格、官禄、财帛、夫妻到六亲与大限走势，一次讲透', 维度: '命格 · 事业 · 财帛 · 感情 · 六亲 · 大限' },
}

// 一键全面分析：点一下，AI 据整盘数据生成一份能反复看的完整报告。结果按盘+系统缓存。
// autoStart：从「聊聊」钩子跳来时自动开始一次（仅此一次），承接 hook→想看更多 的势头。
export default function DeepAnalysis({ chart, 系统, onContinue, autoStart, onAutoStarted }:
  { chart: 命盘; 系统: '八字' | '紫微'; onContinue?: () => void; autoStart?: boolean; onAutoStarted?: () => void }) {
  const key = 缓存键(chart, 系统)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const 已自动 = useRef(false) // 防 StrictMode 双触发自动分析、白烧 token
  const { copied, copy } = useCopied()
  const t = 文案[系统]

  // 换盘/换系统时载入对应缓存
  useEffect(() => {
    try { setText(localStorage.getItem(key) || '') } catch { setText('') }
    setBusy(false)
  }, [key])

  // 钩子直达：自动开始（无缓存才真打），并滚到分析处
  useEffect(() => {
    if (!autoStart || 已自动.current) return
    已自动.current = true
    onAutoStarted?.()
    let cached = ''
    try { cached = localStorage.getItem(key) || '' } catch { /* */ }
    if (!cached && !busy) 分析()
    setTimeout(() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  const 分析 = async () => {
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setText(''); setBusy(true)
    let acc = ''
    try {
      const { ok, status } = await streamPost('/api/analyze', { 命盘: chart, 系统 }, ac.signal, (s) => { acc += s; setText(acc) })
      if (!ok) { setText(`分析服务暂时不可用（${status}）。`); return }
      try { localStorage.setItem(key, acc) } catch { /* 配额满，忽略 */ }
    } catch {
      if (ac.signal.aborted) return
      setText('分析生成失败，请重试。')
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  // 空态：邀请式 CTA
  if (!text && !busy) {
    return (
      <div className="analyze-cta" ref={rootRef}>
        <div className="ac-text">
          <div className="ac-title">{t.标题}</div>
          <div className="ac-sub">{t.副}</div>
          <div className="ac-dims">{t.维度}</div>
        </div>
        <button className="btn-primary" onClick={分析}>一键深度分析</button>
      </div>
    )
  }

  return (
    <div className="analyze-panel" ref={rootRef}>
      <div className="ap-head">
        <span className="ap-title">{t.标题}</span>
        {!busy && text && (
          <div className="ap-actions">
            <button className="btn-ghost" onClick={() => copy(text)}>{copied ? '已复制 ✓' : '复制'}</button>
            <button className="btn-ghost" onClick={分析}>重新分析</button>
          </div>
        )}
      </div>
      {busy && !text && <div className="reading-thinking"><span className="dots">正在通盘推演</span></div>}
      {text && (
        <div className="reading-text">
          {renderRich(text)}
          {busy && <span className="caret" />}
        </div>
      )}
      {!busy && text && (
        <div className="ap-foot">
          <span>观我 · DeepSeek 生成 · 传统文化视角，仅供自我探索</span>
          {onContinue && <button className="btn-primary ap-continue" onClick={onContinue}>就这份分析继续追问 →</button>}
        </div>
      )}
    </div>
  )
}
