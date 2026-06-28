import { useRef, useState, useEffect } from 'react'
import type { 命盘 } from '../engine/types'
import { 指纹 } from '../engine'
import { streamPost } from '../stream'
import { renderRich } from './richText'

type Msg = { role: 'user' | 'assistant'; content: string }
type 视角 = '传统' | '心理'
// 一档梦：梦境 + 两套视角各自的对话线（每条线首句都是这个梦）。
type Session = { 梦境: string; 传统: Msg[]; 心理: Msg[] }

// 这盘的解梦对话存哪个键：换盘即换梦；没盘也能解，单独存一档。
const 梦键 = (c: 命盘 | null) => c ? `guanwo:dream:${指纹(c)}` : 'guanwo:dream:anon'

const 追问示例 = ['这梦是好是坏？', '为什么会梦到这个？', '它在提醒我什么？']
const 视角说明: Record<视角, string> = {
  传统: '周公解梦 ·《梦林玄解》· 中医五行脏腑',
  心理: '荣格原型 · 弗洛伊德潜意识 · 格式塔',
}

function 载入(key: string): Session | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (s && typeof s.梦境 === 'string') return { 梦境: s.梦境, 传统: s.传统 || [], 心理: s.心理 || [] }
  } catch { /* */ }
  return null
}

// 解梦：说个梦 → 选视角解读（传统/心理分开做、逐意象拆解）→ 就这个梦接着聊。
// 一整档对话留在解梦页，不混进「聊聊」。按命盘存一档，刷新不重生成（省 token）。
export default function Dream({ chart }: { chart: 命盘 | null }) {
  const key = 梦键(chart)
  const [session, setSession] = useState<Session | null>(() => 载入(key))
  const [lens, setLens] = useState<视角>('传统')
  const [draft, setDraft] = useState('') // 新梦输入
  const [ask, setAsk] = useState('')     // 追问输入
  const [busyLens, setBusyLens] = useState<视角 | null>(null) // 哪条线在流式
  const [open, setOpen] = useState<Set<number>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<Session | null>(session)
  const busyRef = useRef(false)
  sessionRef.current = session
  busyRef.current = busyLens !== null

  // 换盘载入对应那档梦（初次挂载已由 useState 初始化，跳过）
  const 上次key = useRef(key)
  useEffect(() => {
    if (上次key.current === key) return
    上次key.current = key
    abortRef.current?.abort()
    setSession(载入(key)); setBusyLens(null); setLens('传统'); setOpen(new Set()); setAsk(''); setDraft('')
  }, [key])

  // 落盘（流式中的空助手占位不存）
  useEffect(() => {
    if (!session) { try { localStorage.removeItem(key) } catch { /* */ }; return }
    const 清 = (m: Msg[]) => m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content))
    try { localStorage.setItem(key, JSON.stringify({ 梦境: session.梦境, 传统: 清(session.传统), 心理: 清(session.心理) })) } catch { /* */ }
  }, [session, key])

  // 更新某条视角线的末条消息
  const 改末条 = (which: 视角, fn: (c: string) => string) =>
    setSession((s) => s ? { ...s, [which]: s[which].map((m, i) => i === s[which].length - 1 ? { ...m, content: fn(m.content) } : m) } : s)

  // 把某条线发去 /api/dream，流式填充其末尾空 assistant
  const stream = async (which: 视角, history: Msg[]) => {
    setBusyLens(which)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const { ok, status } = await streamPost('/api/dream', { 命盘: chart ?? undefined, 视角: which, messages: history }, ac.signal,
        (s) => 改末条(which, (c) => c + s))
      if (!ok) { 改末条(which, () => `（解梦服务暂时不可用 ${status}）`) }
    } catch {
      if (ac.signal.aborted) return
      改末条(which, (c) => c || '（解梦失败，请重试）')
    } finally {
      if (!ac.signal.aborted) setBusyLens(null)
    }
  }

  // 说个新梦：这条梦在当前视角下开第一句
  const 解梦 = () => {
    const d = draft.trim()
    if (!d || busyRef.current) return
    setDraft(''); setOpen(new Set())
    const history: Msg[] = [{ role: 'user', content: d }]
    setSession({ 梦境: d, 传统: lens === '传统' ? [...history, { role: 'assistant', content: '' }] : [], 心理: lens === '心理' ? [...history, { role: 'assistant', content: '' }] : [] })
    stream(lens, history)
  }

  // 切视角：若这条线还没解过，就用同一个梦在新视角下解一遍
  const 切视角 = (target: 视角) => {
    if (target === lens) return
    setLens(target); setOpen(new Set()); setAsk('')
    const s = sessionRef.current
    if (!s || s[target].length > 0 || busyRef.current) return
    const history: Msg[] = [{ role: 'user', content: s.梦境 }]
    setSession({ ...s, [target]: [...history, { role: 'assistant', content: '' }] })
    stream(target, history)
  }

  // 就这个梦、这个视角接着聊
  const 追问 = (q: string) => {
    const t = q.trim()
    const s = sessionRef.current
    if (!t || !s || busyRef.current) return
    setAsk('')
    const thread = s[lens]
    const pairIdx = Math.floor((thread.length - 2) / 2)
    setOpen(new Set([pairIdx]))
    const history: Msg[] = [...thread, { role: 'user', content: t }]
    setSession({ ...s, [lens]: [...history, { role: 'assistant', content: '' }] })
    stream(lens, history)
  }

  const 说个新梦 = () => {
    abortRef.current?.abort()
    setSession(null); setBusyLens(null); setLens('传统'); setOpen(new Set()); setAsk(''); setDraft('')
  }

  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  // 视角切换条（输入态也显示，让用户先选怎么解）
  const 视角条 = (
    <div className="lens-tabs">
      {(['传统', '心理'] as 视角[]).map((v) => (
        <button key={v} className={`lens-tab${lens === v ? ' on' : ''}`} disabled={busyRef.current} onClick={() => session ? 切视角(v) : setLens(v)}>
          <span className="lens-name">{v === '传统' ? '传统解梦' : '心理解梦'}</span>
          <span className="lens-sub">{视角说明[v]}</span>
        </button>
      ))}
    </div>
  )

  // 还没说梦 → 输入态
  if (!session) {
    return (
      <div className="dream">
        {视角条}
        <div className="dream-form">
          <label className="dream-label">说说你的梦</label>
          <textarea
            className="dream-input"
            placeholder="梦见了什么？尽量写下场景、人物、情绪，以及让你在意的细节……"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
          />
          <div className="dream-hint">
            {chart
              ? '已读到你的命盘，解梦会轻轻结合八字 / 紫微一起看。解完可切换视角、就这个梦接着聊。'
              : '可先到「起盘」生成命盘，解梦会更贴你；不排盘也能解。解完可切换视角、就这个梦接着聊。'}
          </div>
          <div className="actions">
            <button className="btn-primary" disabled={!draft.trim()} onClick={解梦}>解 梦</button>
          </div>
        </div>
      </div>
    )
  }

  const thread = session[lens]
  const 解读 = thread[1]?.content ?? ''
  const 流式中 = busyLens === lens
  const 解读中 = 流式中 && thread.length === 2 && !解读
  // 追问对（梦+解读之后，新→旧）
  const pairs: { q: string; a: string | null; idx: number }[] = []
  for (let i = 2; i < thread.length; i += 2) pairs.push({ q: thread[i]?.content ?? '', a: thread[i + 1]?.content ?? null, idx: (i - 2) / 2 })

  return (
    <div className="dream">
      <div className="dream-quote">
        <span className="dream-quote-label">你的梦</span>
        <p className="dream-quote-text">{session.梦境}</p>
        <button className="btn-ghost dream-new" onClick={说个新梦}>说个新梦</button>
      </div>

      {视角条}

      <div className="reading" style={{ marginTop: 22 }}>
        {解读中
          ? <div className="reading-thinking"><span className="dots">{lens === '心理' ? '正在读你的潜意识' : '正在入梦'}</span></div>
          : <div className="reading-text">{renderRich(解读)}{流式中 && thread.length === 2 && <span className="caret" />}</div>}
        {!流式中 && thread.length >= 2 && (
          <div className="reading-foot">
            <span className="disclaimer">观我 · {lens === '心理' ? '深度心理学视角' : '传统解梦视角'} · DeepSeek 生成 · 仅供自我探索</span>
          </div>
        )}
      </div>

      {thread.length >= 2 && !解读中 && (
        <div className="chat" style={{ marginTop: 28 }}>
          <div className="chat-head">就这个梦接着聊 <span className="en">KEEP TALKING</span></div>
          <div className="chat-input-row">
            <textarea
              className="chat-input"
              placeholder="还想问点什么？接着聊……"
              value={ask}
              rows={1}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); 追问(ask) } }}
            />
            <button className="chat-send" disabled={!ask.trim() || busyRef.current} onClick={() => 追问(ask)}>
              {流式中 ? '…' : '问'}
            </button>
          </div>

          {pairs.length === 0 && (
            <div className="chat-starters">
              {追问示例.map((q) => (
                <button key={q} className="chat-starter" onClick={() => 追问(q)} disabled={busyRef.current}>{q}</button>
              ))}
            </div>
          )}

          {pairs.length > 0 && (
            <div className="qa-list">
              {pairs.slice().reverse().map((pr) => {
                const opened = open.has(pr.idx)
                const streaming = 流式中 && pr.idx === pairs.length - 1
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
      )}
    </div>
  )
}
