import { useRef, useState, useEffect } from 'react'
import type { 命盘 } from '../engine/types'
import { 指纹 } from '../engine'
import { streamPost } from '../stream'
import { renderRich } from './richText'

type Msg = { role: 'user' | 'assistant'; content: string }

const 建议问题 = [
  '我是个什么性格的人？',
  '我适合做什么工作？',
  '我的感情里容易卡在哪？',
  '最近我该多留意什么？',
]

// 这盘的对话存哪个键：用公历+时辰+性别做指纹，换盘即换对话。
const 对话键 = (c: 命盘) => `guanwo:chat:${指纹(c)}`

type Props = {
  chart: 命盘; reading: string
  pending?: string | null; onConsume?: () => void
  focus?: boolean; onFocused?: () => void
}

// 追问：命盘常驻上下文，多轮、流式、本地持久化。
// 每个「问题→回答」是一张独立可折叠的卡片——把问题分开，页面不臃肿。
export default function Chat({ chart, reading, pending, onConsume, focus, onFocused }: Props) {
  const key = 对话键(chart)
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Set<number>>(() => {
    const n = Math.floor((() => { try { return JSON.parse(localStorage.getItem(key) || '[]').length } catch { return 0 } })() / 2)
    return n > 0 ? new Set([n - 1]) : new Set()
  })
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const msgsRef = useRef<Msg[]>(msgs)
  const busyRef = useRef(false)
  msgsRef.current = msgs
  busyRef.current = busy

  // 换盘载入历史（初次挂载已由 useState 初始化，跳过——否则会冲掉待问消息）
  const 上次key = useRef(key)
  useEffect(() => {
    if (上次key.current === key) return
    上次key.current = key
    let m: Msg[] = []
    try { m = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* */ }
    setMsgs(m)
    const n = Math.floor(m.length / 2)
    setOpen(n > 0 ? new Set([n - 1]) : new Set())
  }, [key])

  // 落盘（流式中的空助手占位不存）
  useEffect(() => {
    const 可存 = msgs.filter((m, i) => !(i === msgs.length - 1 && m.role === 'assistant' && !m.content))
    try { localStorage.setItem(key, JSON.stringify(可存)) } catch { /* */ }
  }, [msgs, key])

  // 外部要求聚焦输入框（深度分析「继续追问」等）
  useEffect(() => {
    if (focus) {
      inputRef.current?.focus()
      setTimeout(() => document.querySelector('.chat')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
      onFocused?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const 改最后一条 = (fn: (c: string) => string) =>
    setMsgs((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, content: fn(msg.content) } : msg)))

  const send = async (q: string) => {
    const text = q.trim()
    if (!text || busyRef.current) return
    setInput('')
    const newIdx = Math.floor(msgsRef.current.length / 2) // 新问答卡的序号
    setOpen(new Set([newIdx])) // 只展开最新一问，旧的自动收起——保持清爽
    const history: Msg[] = [...msgsRef.current, { role: 'user', content: text }]
    setMsgs([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const { ok, status } = await streamPost('/api/chat', { 命盘: chart, 解读: reading, messages: history }, ac.signal,
        (s) => 改最后一条((c) => c + s))
      if (!ok) {
        if (status === 401) {
          改最后一条(() => `⚠️ 请先登录以开启追问。请点击右上角「账号」按钮进行登录。`)
        } else if (status === 402) {
          改最后一条(() => `⚠️ 追问点数已用完。请点击右上角「账号」按钮进行充值。`)
        } else {
          改最后一条(() => `（追问服务暂时不可用 ${status}）`)
        }
      }
    } catch {
      if (ac.signal.aborted) return
      改最后一条((c) => c || '（追问失败，请重试）')
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  // 外部待问问题（点八字柱/紫微宫/术语「就盘问AI」）：Chat 自己挂载后消费
  const consumedRef = useRef<string | null>(null)
  useEffect(() => {
    if (pending && pending.trim() && pending !== consumedRef.current) {
      consumedRef.current = pending
      send(pending)
      onConsume?.()
      setTimeout(() => document.querySelector('.chat')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  // 组装问答对（新→旧渲染）
  const pairs: { q: string; a: string | null; idx: number }[] = []
  for (let i = 0; i < msgs.length; i += 2) pairs.push({ q: msgs[i]?.content ?? '', a: msgs[i + 1]?.content ?? null, idx: i / 2 })

  return (
    <div className="chat">
      <div className="chat-head">随便问 <span className="en">ASK ANYTHING</span></div>

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="就你的命盘，问点具体的……"
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="chat-send" disabled={!input.trim() || busy} onClick={() => send(input)}>
          {busy ? '…' : '问'}
        </button>
      </div>

      {pairs.length === 0 && (
        <div className="chat-starters">
          {建议问题.map((q) => (
            <button key={q} className="chat-starter" onClick={() => send(q)} disabled={busy}>{q}</button>
          ))}
        </div>
      )}

      {pairs.length > 0 && (
        <div className="qa-list">
          <div className="qa-disclaimer">观我 · DeepSeek 生成 · 传统文化视角，仅供自我探索，不构成专业决策依据</div>
          {pairs.slice().reverse().map((pr) => {
            const opened = open.has(pr.idx)
            const streaming = busy && pr.idx === pairs.length - 1
            return (
              <div key={pr.idx} className={`qa-card${opened ? ' open' : ''}`}>
                <button className="qa-q" onClick={() => toggle(pr.idx)}>
                  <span className="qa-qtext">{pr.q}</span>
                  <span className="qa-toggle" aria-hidden>{opened ? '−' : '+'}</span>
                </button>
                {opened && (
                  <div className="qa-a">
                    {pr.a || streaming
                      ? <div className="reading-text">{renderRich(pr.a ?? '')}{streaming && <span className="caret" />}</div>
                      : <div className="reading-thinking"><span className="dots">正在想</span></div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
