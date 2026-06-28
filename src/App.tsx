import { useState, useEffect, useRef } from 'react'
import { 排盘, 指纹 } from './engine'
import { streamPost } from './stream'
import type { BirthInput, 命盘 } from './engine/types'
import { 术语 } from './engine/knowledge'
import BirthForm from './components/BirthForm'
import BaziBoard from './components/BaziBoard'
import ZiweiBoard from './components/ZiweiBoard'
import Reading from './components/Reading'
import PersonaHero from './components/PersonaHero'
import Chat from './components/Chat'
import Fortune from './components/Fortune'
import Dream from './components/Dream'
import LiuYao from './components/LiuYao'
import DeepAnalysis from './components/DeepAnalysis'
import DailyGlimpse from './components/DailyGlimpse'
import { useCopied } from './useCopied'
import { ConsentGate, AboutTerms, 已同意 } from './components/Compliance'
import { 取我, 退出, dev登录, 同步命盘, 删云端盘, 注销账号, 微信登录地址, 登录账号, 注册账号, 充值点数, type 账号, type 同步盘 } from './account'
type View = '聊聊' | '流年' | '八字' | '紫微' | '解梦' | '六爻'
const 导航: View[] = ['聊聊', '流年', '八字', '紫微', '解梦', '六爻']

type ChartEntry = { id: string; label: string; chart: 命盘; reading: string; ts: number }

const K_CHARTS = 'guanwo:charts:v2'
const K_ACTIVE = 'guanwo:active'
const K_PROFILE = 'guanwo:profile'

// 命盘指纹（engine.指纹）：同一生辰再起盘视为同一张，避免重复
const fp = 指纹
const 默认称呼 = (c: 命盘) => `${c.元信息.输入.年}.${c.元信息.输入.月}.${c.元信息.输入.日}`
const 简历 = (c: 命盘) => `${c.元信息.输入.年}.${c.元信息.输入.月}.${c.元信息.输入.日} · ${c.元信息.时辰} · ${c.元信息.输入.性别}`

// 起盘揭示仪式时长（ms）——盖过排盘到解读流式之间的空档，给「照见自己」一点仪式感
const REVEAL_MS = 2200

// 揭示仪式：排盘瞬间完成，但第一次看见「自己」值得一点郑重。分阶段的话从星盘里浮出来。
const 揭示语 = ['排布四柱八字', '安立十二宫垣', '定位你的命主', '照见 ——']
function Reveal() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setI((x) => (x < 揭示语.length - 1 ? x + 1 : x)), 540)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="ritual">
      <div className="ritual-emblem">
        <span className="ritual-ring" />
        <span className="ritual-star"><Spike /></span>
      </div>
      <div className="ritual-line" key={i}>{揭示语[i]}</div>
    </div>
  )
}

function Spike() {
  return (
    <span className="spike" aria-hidden>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1.5 L13.5 9 L19.6 4.4 L15 10.5 L22.5 12 L15 13.5 L19.6 19.6 L13.5 15 L12 22.5 L10.5 15 L4.4 19.6 L9 13.5 L1.5 12 L9 10.5 L4.4 4.4 L10.5 9 Z" />
      </svg>
    </span>
  )
}

// 四个核心功能的图标（线性、随文字色）
function NavIcon({ name }: { name: View }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'ic' }
  if (name === '聊聊') return <svg {...p}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 20.5l1.6-4.8A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" /><path d="M8.5 10.5h7M8.5 13.5h4" /></svg>
  if (name === '流年') return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" /></svg>
  if (name === '八字') return <svg {...p}><path d="M6 4.5v15M10 4.5v15M14 4.5v15M18 4.5v15" /></svg>
  if (name === '紫微') return <svg {...p}><path d="M12 3.4l2.3 5.5 5.9.5-4.5 3.9 1.4 5.8L12 16l-5.5 3.1 1.4-5.8-4.5-3.9 5.9-.5z" /></svg>
  if (name === '六爻') return <svg {...p}><path d="M4 6.5h16M4 12h6M14 12h6M4 17.5h16" /></svg>
  return <svg {...p}><path d="M20.5 13.2A8 8 0 1 1 10.8 3.5 6.3 6.3 0 0 0 20.5 13.2z" /></svg>
}

// 同步从 localStorage 读入命盘列表（含旧版单盘迁移）——在首帧就有真实数据，
// 避免「挂载时 charts=[] → 持久化用空数组覆盖」的竞态。
function 载入命盘(): ChartEntry[] {
  try {
    const l = JSON.parse(localStorage.getItem(K_CHARTS) || '[]')
    if (Array.isArray(l) && l.length) return l
  } catch { /* */ }
  try {
    const old = JSON.parse(localStorage.getItem('guanwo:last') || 'null')
    if (old?.chart) return [{ id: fp(old.chart), label: 默认称呼(old.chart), chart: old.chart, reading: old.reading || '', ts: Date.now() }]
  } catch { /* */ }
  return []
}

export default function App() {
  const [charts, setCharts] = useState<ChartEntry[]>(载入命盘)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [view, setView] = useState<View>('聊聊')
  const [focusChat, setFocusChat] = useState(false)
  const [autoAnalyze, setAutoAnalyze] = useState<'八字' | '紫微' | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [term, setTerm] = useState<string | null>(null)
  const [reading, setReading] = useState('')
  const [readingBusy, setReadingBusy] = useState(false)
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [name, setName] = useState('')
  const [acct, setAcct] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const { copied, copy } = useCopied()

  // 账号 / 云端同步（本地优先：未登录一切照常；同步是登录后独立 opt-in）
  const [account, setAccount] = useState<账号 | null>(null)
  const [wechatOn, setWechatOn] = useState(false)
  const [syncOn, setSyncOn] = useState(() => { try { return localStorage.getItem('guanwo:sync') === '1' } catch { return false } })
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced' | 'err'>('idle')
  const chartsRef = useRef(charts)
  chartsRef.current = charts

  // 复制整盘结构化数据（JSON）——证明数据可直接调用，非截图
  const copyData = () => { if (active) copy(JSON.stringify(active.chart, null, 2)) }

  const abortRef = useRef<AbortController | null>(null)

  const active = charts.find((c) => c.id === activeId) ?? null

  // ── 账号 / 同步 ──
  const 同步盘转entry = (c: 同步盘): ChartEntry => ({ id: c.id, label: c.label, chart: c.chart, reading: c.reading || '', ts: c.ts })
  const 拉取合并 = () => {
    setSyncState('syncing')
    同步命盘(chartsRef.current.map((e) => ({ id: e.id, label: e.label, chart: e.chart, reading: e.reading || null, ts: e.ts })))
      .then((r) => { setCharts(r.charts.map(同步盘转entry)); setSyncState('synced') })
      .catch(() => setSyncState('err'))
  }
  const 开启同步 = () => { setSyncOn(true); try { localStorage.setItem('guanwo:sync', '1') } catch { /* */ } ; 拉取合并() }
  const 关闭同步 = () => { setSyncOn(false); try { localStorage.removeItem('guanwo:sync') } catch { /* */ } ; setSyncState('idle') }
  const dev登入 = () => dev登录('测试用户').then((r) => setAccount(r.user)).catch(() => {})
  const 退出登录 = async () => { await 退出().catch(() => {}); setAccount(null); setSyncState('idle') }
  const 注销 = async () => { await 注销账号().catch(() => {}); setAccount(null); 关闭同步() }

  const [acctError, setAcctError] = useState<string | null>(null)
  const 处理登录 = async (u: string, p: string) => {
    try {
      setAcctError(null)
      const res = await 登录账号(u, p)
      setAccount(res.user)
      if (syncOn) 拉取合并()
    } catch (e) {
      setAcctError((e as Error).message || '登录失败')
      throw e
    }
  }
  const 处理注册 = async (u: string, p: string) => {
    try {
      setAcctError(null)
      const res = await 注册账号(u, p)
      setAccount(res.user)
      if (syncOn) 拉取合并()
    } catch (e) {
      setAcctError((e as Error).message || '注册失败')
      throw e
    }
  }
  const 处理充值 = async (amount: number) => {
    try {
      setAcctError(null)
      const res = await 充值点数(amount)
      if (res.ok && account) {
        setAccount({ ...account, credits: res.credits })
      }
    } catch (e) {
      setAcctError((e as Error).message || '充值失败')
      throw e
    }
  }

  // 启动查会话；登录且开了同步 → 拉取合并
  useEffect(() => {
    取我().then((r) => { setAccount(r.user); setWechatOn(r.wechat); if (r.user && syncOn) 拉取合并() }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 同步开启时，命盘变化防抖推送云端（只推不回写，避免环）
  const 推送Ref = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!account || !syncOn) return
    clearTimeout(推送Ref.current)
    推送Ref.current = setTimeout(() => {
      setSyncState('syncing')
      同步命盘(chartsRef.current.map((e) => ({ id: e.id, label: e.label, chart: e.chart, reading: e.reading || null, ts: e.ts })))
        .then(() => setSyncState('synced')).catch(() => setSyncState('err'))
    }, 800)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts, account, syncOn])

  // ── 启动：选中盘 / 账号；空则进入新建；?demo 演示。命盘列表已由 useState 同步载入 ──
  useEffect(() => {
    try { setName(JSON.parse(localStorage.getItem(K_PROFILE) || 'null')?.name || '') } catch { /* */ }
    const q = new URLSearchParams(location.search)
    if (q.has('demo')) {
      const c = 排盘({ 历法: '公历', 年: 1996, 月: 8, 日: 12, 时: 14, 分: 30, 性别: '男', 出生地: { 名称: '上海', 经度: 121.47 }, 真太阳时校正: true })
      const id = fp(c)
      const existing = charts.find((x) => x.id === id) // 复用已缓存的解读，别白烧 token
      const e: ChartEntry = { id, label: existing?.label || '我自己', chart: c, reading: existing?.reading || '', ts: Date.now() }
      setCharts((prev) => [e, ...prev.filter((x) => x.id !== id)])
      setActiveId(id); setReading(e.reading)
      return
    }
    const savedActive = localStorage.getItem(K_ACTIVE)
    const pick = charts.find((x) => x.id === savedActive) ?? charts[0]
    if (pick) { setActiveId(pick.id); setReading(pick.reading || '') }
    else setComposing(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 持久化
  useEffect(() => { try { localStorage.setItem(K_CHARTS, JSON.stringify(charts)) } catch { /* */ } }, [charts])
  useEffect(() => { if (activeId) try { localStorage.setItem(K_ACTIVE, activeId) } catch { /* */ } }, [activeId])

  // 切分区回顶
  useEffect(() => { document.querySelector('.content')?.scrollTo({ top: 0 }) }, [view, activeId])

  // 解读是首页，必有内容：进「聊聊」而空则自动流式生成（每盘只自动生成一次，防 StrictMode/重复触发烧 token）
  const 已自动生成 = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (active && !composing && view === '聊聊' && !reading && !readingBusy && !已自动生成.current.has(active.id)) {
      已自动生成.current.add(active.id)
      生成解读(active.chart, active.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, view, composing])

  // 点命盘某柱/某宫 → 跳「解读」，Chat 挂载后自行消费 pendingAsk（见 Chat 的 pending 属性）
  const askAI = (q: string) => { setView('聊聊'); setPendingAsk(q) }
  const 去追问 = () => { setView('聊聊'); setFocusChat(true) }

  const saveReading = (id: string, text: string) =>
    setCharts((prev) => prev.map((e) => (e.id === id ? { ...e, reading: text } : e)))

  const 生成中 = useRef<string | null>(null)
  const 生成解读 = async (c: 命盘, id: string, manual = false) => {
    if (!manual && 生成中.current === id) return // 同一盘已在生成，别重复打（防 StrictMode/重触发）
    生成中.current = id
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setReading(''); setReadingBusy(true)
    let acc = ''
    try {
      const { ok, status } = await streamPost('/api/reading', c, ac.signal, (s) => { acc += s; setReading(acc) })
      if (!ok) { setReading(`解读服务暂时不可用（${status}）。`); return }
    } catch {
      if (ac.signal.aborted) return
      setReading('解读生成失败，请重试。'); acc = ''
    } finally {
      // 非中止退出才复位（中止交给接替调用）。成功则存盘；失败（无内容）则移出「已自动」名单，
      // 让用户切走再回来时能自动重试，而不是卡在「生成失败」文案上。
      if (!ac.signal.aborted) {
        setReadingBusy(false)
        if (acc) saveReading(id, acc)
        else 已自动生成.current.delete(id)
        生成中.current = null
      }
    }
  }

  const compute = (input: BirthInput, 称呼?: string) => {
    try {
      setErr(null)
      const c = 排盘(input)
      setLoading(true); setComposing(false)
      window.setTimeout(() => {
        const id = fp(c)
        setCharts((prev) => {
          const label = 称呼 || prev.find((e) => e.id === id)?.label || 默认称呼(c)
          const entry: ChartEntry = { id, label, chart: c, reading: '', ts: Date.now() }
          return [entry, ...prev.filter((e) => e.id !== id)]
        })
        setActiveId(id); setView('聊聊'); setReading(''); setLoading(false)
        生成解读(c, id)
      }, REVEAL_MS)
    } catch (e) {
      setErr('排盘失败，请检查输入的日期是否有效。'); setLoading(false); console.error(e)
    }
  }

  // 中止在途解读：若被中途打断（解读没存成），把该盘移出「已自动」名单，下次回访能重新自动生成
  const 中止生成 = () => {
    abortRef.current?.abort()
    if (生成中.current) { 已自动生成.current.delete(生成中.current); 生成中.current = null }
  }

  const selectChart = (id: string) => {
    if (id === activeId && !composing) { setDrawer(false); return }
    中止生成()
    const e = charts.find((x) => x.id === id); if (!e) return
    setActiveId(id); setComposing(false); setView('聊聊')
    setReading(e.reading || ''); setReadingBusy(false); setDrawer(false)
  }

  const newChart = () => { 中止生成(); setComposing(true); setErr(null); setDrawer(false) }

  const renameChart = (id: string, label: string) => {
    const l = label.trim()
    if (l) setCharts((prev) => prev.map((e) => (e.id === id ? { ...e, label: l } : e)))
    setEditingId(null)
  }

  const deleteChart = (id: string) => {
    if (account && syncOn) 删云端盘(id).catch(() => {}) // 同步开启时，删本地也删云端
    setCharts((prev) => {
      const rest = prev.filter((e) => e.id !== id)
      if (id === activeId) {
        if (rest[0]) { setActiveId(rest[0].id); setReading(rest[0].reading || '') }
        else { setActiveId(null); setComposing(true); setReading('') }
      }
      return rest
    })
  }

  const saveName = (n: string) => {
    setName(n); setAcct(false)
    try { localStorage.setItem(K_PROFILE, JSON.stringify({ name: n })) } catch { /* */ }
  }

  const 过滤 = q.trim() ? charts.filter((c) => c.label.includes(q.trim())) : charts

  // 合规：首访先过「告知-同意」门（未成年人/AI生成/免责一处达成），同意后才进产品
  const [consented, setConsented] = useState(已同意)
  if (!consented) return <ConsentGate onAgree={() => setConsented(true)} />

  return (
    <div className="layout">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <aside className={`sidebar${drawer ? ' open' : ''}`}>
        <button className="sb-new" onClick={newChart}>＋ 新起一盘</button>

        <div className="sb-search">
          <span aria-hidden>🔍</span>
          <input placeholder="搜索命盘…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="sb-label">我的命盘</div>
        <div className="sb-list">
          {过滤.length === 0 && <div className="sb-empty">{q.trim() ? '没有匹配的盘' : '还没有命盘，点上方「新起一盘」开始。'}</div>}
          {过滤.map((c) => (
            <div key={c.id} className={`sb-item${c.id === activeId && !composing ? ' on' : ''}`} onClick={() => selectChart(c.id)}>
              {editingId === c.id ? (
                <input className="sb-rename" autoFocus defaultValue={c.label}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => renameChart(c.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameChart(c.id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setEditingId(null)
                  }} />
              ) : (
                <span className="nm" title="双击重命名" onDoubleClick={(e) => { e.stopPropagation(); setEditingId(c.id) }}>{c.label}</span>
              )}
              <span className="mt">{简历(c.chart)}</span>
              <button className="sb-del" title="删除" aria-label="删除命盘" onClick={(e) => { e.stopPropagation(); deleteChart(c.id) }}>×</button>
            </div>
          ))}
        </div>

        <div className="sb-foot">
          <button onClick={() => setAcct(true)}><span aria-hidden>⚙</span> 账号与设置</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="tb-brand">
            <button className="hamburger" onClick={() => setDrawer(true)} aria-label="菜单">☰</button>
            <span className="brand"><Spike /> 观我</span>
          </div>

          {active && (
            <nav className="topnav">
              {导航.map((v) => (
                <button key={v} className={view === v && !composing ? 'on' : ''}
                  onClick={() => { setComposing(false); setView(v) }}>
                  <NavIcon name={v} /> <span>{v}</span>
                </button>
              ))}
            </nav>
          )}

          <div className="tb-right">
            {active && !composing && <span className="tb-who" title={简历(active.chart)}>{active.label}</span>}
            {account || name
              ? <button className="account signed" title={account?.displayName || name || '账号'} onClick={() => setAcct(true)}>
                  {(account?.displayName || name || '我').slice(0, 1)}
                  {syncOn && account && <span className={`sync-dot${syncState === 'syncing' ? ' on' : ''}`} aria-hidden />}
                </button>
              : <button className="btn-login" onClick={() => setAcct(true)}>账号</button>}
          </div>
        </header>

        {loading ? (
          <Reveal />
        ) : composing || !active ? (
          <div className="compose">
            <header className="masthead">
              <div className="brandline"><Spike /> GUĀN WǑ</div>
              <h1>观我</h1>
              <div className="entry-tag">以八字与紫微为镜，照见你自己。</div>
            </header>
            <BirthForm onSubmit={compute} />
            {err && <div className="entry-err">{err}</div>}
          </div>
        ) : (
          <>
            <div className="content">
              {view === '聊聊' && (
                <div className="view-in">
                  <PersonaHero chart={active.chart} />
                  <DailyGlimpse chart={active.chart} onTerm={setTerm} onAsk={reading && !readingBusy ? askAI : undefined} />
                  <div className="reading-pane">
                    <Reading text={reading} busy={readingBusy} onGenerate={() => 生成解读(active.chart, active.id, true)} />
                    {reading && !readingBusy && (
                      <div className="more-nudge">
                        <span className="mn-text">这只是一瞥 —— 想看讲透的完整分析？</span>
                        <div className="mn-btns">
                          <button className="btn-ghost" onClick={() => { setAutoAnalyze('八字'); setView('八字') }}>完整八字分析</button>
                          <button className="btn-ghost" onClick={() => { setAutoAnalyze('紫微'); setView('紫微') }}>完整紫微分析</button>
                        </div>
                      </div>
                    )}
                    {reading && !readingBusy && <Chat chart={active.chart} reading={reading}
                      pending={pendingAsk} onConsume={() => setPendingAsk(null)}
                      focus={focusChat} onFocused={() => setFocusChat(false)} />}
                  </div>
                </div>
              )}

              {view === '流年' && (
                <div className="view-in">
                  <h2 className="view-title">流年 <span className="en">THE YEAR AHEAD</span></h2>
                  <p className="view-lead">这一年的能量适合做什么、容易在哪儿别扭——结合你的盘说说。流年是天气预报，不是判决书。</p>
                  <div className="reading"><Fortune chart={active.chart} /></div>
                </div>
              )}

              {view === '八字' && (
                <div className="view-in">
                  <div className="view-title-row">
                    <h2 className="view-title">八字 <span className="en">FOUR PILLARS</span></h2>
                    <button className="data-copy" onClick={copyData} title="复制整盘结构化数据（JSON）">
                      {copied ? '已复制 ✓' : '⎘ 数据'}
                    </button>
                  </div>
                  <div className="meta-bar">
                    <span className="item">公历<b>{active.chart.元信息.公历}</b></span>
                    <span className="item">农历<b>{active.chart.元信息.农历}</b></span>
                    <span className="item">时辰<b>{active.chart.元信息.时辰}</b></span>
                    <span className="item">性别<b>{active.chart.元信息.输入.性别}</b></span>
                  </div>
                  {active.chart.元信息.真太阳时?.启用 && (
                    <div className="solar-bar">
                      <span className="tag term" onClick={() => setTerm('真太阳时')}>真太阳时 <i>?</i></span>
                      <span>校正后<b>{active.chart.元信息.真太阳时.校正后时刻}</b></span>
                    </div>
                  )}
                  <div style={{ marginTop: 18 }}><DeepAnalysis chart={active.chart} 系统="八字" onContinue={去追问}
                    autoStart={autoAnalyze === '八字'} onAutoStarted={() => setAutoAnalyze(null)} /></div>
                  <div style={{ marginTop: 20 }}>
                    <BaziBoard chart={active.chart.八字} onTerm={setTerm} onAsk={reading && !readingBusy ? askAI : undefined} />
                  </div>
                  <div className="notes">{active.chart.元信息.说明.map((s, i) => <div key={i}>· {s}</div>)}</div>
                </div>
              )}

              {view === '紫微' && (
                <div className="view-in">
                  <div className="view-title-row">
                    <h2 className="view-title">紫微斗数 <span className="en">ZI WEI DOU SHU</span></h2>
                    <button className="data-copy" onClick={copyData} title="复制整盘结构化数据（JSON）">
                      {copied ? '已复制 ✓' : '⎘ 数据'}
                    </button>
                  </div>
                  <p className="view-lead">点任一宫，看它的三方四正与详情；切到「运限」看大限/流年飞星；想深入，再让 AI 展开。</p>
                  <div style={{ marginBottom: 20 }}><DeepAnalysis chart={active.chart} 系统="紫微" onContinue={去追问}
                    autoStart={autoAnalyze === '紫微'} onAutoStarted={() => setAutoAnalyze(null)} /></div>
                  <ZiweiBoard chart={active.chart.紫微}
                    运限源={active.chart.元信息.公历计算 ? { ...active.chart.元信息.公历计算, 性别: active.chart.元信息.输入.性别 } : undefined}
                    onTerm={setTerm} onAsk={reading && !readingBusy ? askAI : undefined} />
                </div>
              )}

              {view === '解梦' && (
                <div className="view-in">
                  <h2 className="view-title">解梦 <span className="en">DREAMS</span></h2>
                  <p className="view-lead">说说你的梦——传统解梦或心理解梦两种视角，把每个意象单独拆给你看。解完就在这儿接着聊。</p>
                  <Dream chart={active.chart} />
                </div>
              )}

              {view === '六爻' && (
                <div className="view-in">
                  <h2 className="view-title">六爻 <span className="en">THE CAST HEXAGRAM</span></h2>
                  <p className="view-lead">心里有件拿不准的事，借一卦换个角度想想。三枚铜钱掷六次，把卦象当面镜子帮你梳理思路——传统文化视角，仅供参考娱乐，不是预测吉凶，更不替你做决定。</p>
                  <LiuYao />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Sheet term={term} onClose={() => setTerm(null)}
        onAsk={active && !composing ? (t) => { setTerm(null); askAI(`「${t}」是什么意思？结合我的命盘，说说它对我的影响。`) } : undefined} />
      {acct && <AccountSheet
        name={name} onSave={saveName} onClose={() => setAcct(false)}
        account={account} wechatOn={wechatOn} syncOn={syncOn} syncState={syncState}
        onEnableSync={开启同步} onDisableSync={关闭同步} onLogout={退出登录} onDeleteAccount={注销} onDevLogin={dev登入}
        onLogin={处理登录} onRegister={处理注册} onRecharge={处理充值} error={acctError} setError={setAcctError} />}
    </div>
  )
}

function Sheet({ term, onClose, onAsk }: { term: string | null; onClose: () => void; onAsk?: (t: string) => void }) {
  if (!term) return null
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-term">{term}</span>
          <button className="sheet-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <p className="sheet-body">{术语[term] ?? '暂无解释。'}</p>
        {onAsk && (
          <div className="sheet-foot">
            <button className="btn-primary" onClick={() => onAsk(term)}>就我的盘问 AI →</button>
          </div>
        )}
      </div>
    </div>
  )
}

type AccountSheetProps = {
  name: string; onSave: (n: string) => void; onClose: () => void
  account: 账号 | null; wechatOn: boolean; syncOn: boolean; syncState: 'idle' | 'syncing' | 'synced' | 'err'
  onEnableSync: () => void; onDisableSync: () => void; onLogout: () => void; onDeleteAccount: () => void; onDevLogin: () => void
  onLogin: (u: string, p: string) => Promise<void>
  onRegister: (u: string, p: string) => Promise<void>
  onRecharge: (amount: number) => Promise<void>
  error: string | null; setError: (err: string | null) => void
}
const 同步文案 = { idle: '未开启', syncing: '同步中…', synced: '已同步', err: '同步出错，稍后重试' } as const

function AccountSheet({ name, onSave, onClose, account, wechatOn, syncOn, syncState, onEnableSync, onDisableSync, onLogout, onDeleteAccount, onDevLogin, onLogin, onRegister, onRecharge, error, setError }: AccountSheetProps) {
  const [v, setV] = useState(name)
  const [确认注销, set确认注销] = useState(false)
  const [tab, setTab] = useState<'username' | 'wechat'>('username')
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [recharging, setRecharging] = useState(false)
  const [rechargeAmt, setRechargeAmt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [rechargeSuccess, setRechargeSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (isRegister) {
        await onRegister(username, password)
      } else {
        await onLogin(username, password)
      }
    } catch {
      // Error is set in parent state and displayed below
    } finally {
      setLoading(false)
    }
  }

  const handleRechargeSelect = async (amount: number) => {
    setRechargeAmt(amount)
    setLoading(true)
    setRechargeSuccess(false)
    setError(null)
    try {
      // 模拟支付网络延迟，显得真实 premium
      await new Promise(resolve => setTimeout(resolve, 1000))
      await onRecharge(amount)
      setRechargeSuccess(true)
      setTimeout(() => {
        setRecharging(false)
        setRechargeSuccess(false)
        setRechargeAmt(null)
      }, 1200)
    } catch {
      // Error is handled by parent
    } finally {
      setLoading(false)
    }
  }

  // 切换面板时清空报错
  useEffect(() => {
    setError(null)
  }, [tab, isRegister, recharging, setError])

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-term">{recharging ? '充值点数' : '账号'}</span>
          <button className="sheet-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        {recharging ? (
          <div className="acct-sec">
            <p className="acct-hint" style={{ marginTop: 0 }}>选择充值额度。1 元即可获得 10 个追问点数：</p>
            <div className="recharge-presets">
              {[1, 5, 10].map((amt) => (
                <div key={amt}
                  className={`recharge-preset${rechargeAmt === amt ? ' active' : ''}`}
                  onClick={() => !loading && handleRechargeSelect(amt)}
                >
                  <span className="preset-credits">{amt * 10} 点</span>
                  <span className="preset-amt">¥ {amt}</span>
                </div>
              ))}
            </div>

            {loading && (
              <div className="reading-thinking" style={{ textAlign: 'center', marginTop: 14 }}>
                <span className="dots">正在发起模拟支付</span>
              </div>
            )}

            {rechargeSuccess && (
              <div className="recharge-success">
                <span>✓ 模拟支付成功，点数已到账！</span>
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" disabled={loading} onClick={() => setRecharging(false)}>返回</button>
            </div>
          </div>
        ) : (
          <>
            {/* 段1 · 身份 */}
            <div className="acct-sec">
              <div className="field" style={{ marginBottom: 14 }}>
                <label>你的称呼</label>
                <div className="acct-name-row">
                  <input value={v} onChange={(e) => setV(e.target.value)} placeholder="如「阿一」" />
                  <button className="btn-ghost" onClick={() => onSave(v.trim())}>保存</button>
                </div>
              </div>

              {account ? (
                <div>
                  <div className="acct-who" style={{ fontSize: '14.5px', color: 'var(--ink)' }}>
                    已登录 · <b>{account.displayName || '未命名'}</b>
                  </div>
                  <div className="acct-row" style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface-soft)', borderRadius: 'var(--r-md)' }}>
                    <span style={{ fontSize: '14px', color: 'var(--ink-2)' }}>
                      剩余追问点数：<strong style={{ color: 'var(--cinnabar)', fontFamily: 'var(--serif)', fontSize: '18px' }}>{account.credits ?? 0}</strong> 点
                    </span>
                    <button className="btn-primary" style={{ height: '30px', padding: '0 12px', fontSize: '12px' }} onClick={() => setRecharging(true)}>
                      充值
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="auth-tabs">
                    <button className={`auth-tab${tab === 'username' ? ' active' : ''}`} onClick={() => setTab('username')}>密码登录</button>
                    {wechatOn && <button className={`auth-tab${tab === 'wechat' ? ' active' : ''}`} onClick={() => setTab('wechat')}>微信登录</button>}
                  </div>

                  {tab === 'username' ? (
                    <form onSubmit={handleSubmit} className="auth-form">
                      <div className="auth-input-group">
                        <label>用户名</label>
                        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" required />
                      </div>
                      <div className="auth-input-group">
                        <label>密码</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码 (至少6位)" required />
                      </div>

                      {error && <div className="auth-error">{error}</div>}

                      <button type="submit" className="auth-submit-btn" disabled={loading}>
                        {loading ? '请稍候...' : isRegister ? '注册并登录' : '登录'}
                      </button>

                      <button type="button" className="auth-toggle-btn" onClick={() => setIsRegister(!isRegister)}>
                        {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
                      </button>
                    </form>
                  ) : (
                    <>
                      {wechatOn && <a className="btn-wechat" href={微信登录地址} style={{ width: '100%', justifyContent: 'center', boxSizing: 'border-box' }}><WechatIcon /> 微信登录</a>}
                    </>
                  )}

                  {!account && (
                    <>
                      {import.meta.env.DEV && <button className="btn-ghost acct-dev" style={{ width: '100%', marginTop: 10 }} onClick={onDevLogin}>（dev 测试登录）</button>}
                      <p className="acct-hint">登录后可查看剩余点数并开启命盘云端同步，不登录也能在本地免费起盘。</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 段2 · 同步（仅登录后） */}
            {account && (
              <div className="acct-sec">
                <div className="acct-row">
                  <span className="sync-status"><span className={`sync-dot${syncState === 'syncing' ? ' on' : ''}${syncOn ? ' active' : ''}`} />云端同步 · {syncOn ? 同步文案[syncState] : 同步文案.idle}</span>
                  <button className="btn-ghost" onClick={syncOn ? onDisableSync : onEnableSync}>{syncOn ? '关闭' : '开启'}</button>
                </div>
                <p className="acct-hint">开启后，命盘会加密存到服务器，仅用于在你换设备时找回；随时可关。关闭只停止上传，已存的云端数据仍在，注销可彻底删除。</p>
              </div>
            )}

            {/* 段3 · 关于与条款（合规：随时可看用户协议/隐私政策） */}
            <AboutTerms />

            {/* 段4 · 隐私 / 数据 */}
            <div className="acct-sec">
              <p className="acct-priv">观我本地优先——命盘默认只存在你这台设备。生成解读时会把命盘发送给 AI 服务用于本次生成，不另作留存。{account ? '' : '登录与同步都是可选的。'}</p>
              {account && (
                <div className="acct-actions">
                  <button className="btn-ghost" onClick={onLogout}>退出登录</button>
                  {确认注销
                    ? <button className="btn-ghost acct-danger" onClick={onDeleteAccount}>确认注销并删除全部云端数据</button>
                    : <button className="btn-ghost acct-danger" onClick={() => set确认注销(true)}>注销账号</button>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function WechatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#07c160" aria-hidden>
      <path d="M8.7 3C4.9 3 1.8 5.5 1.8 8.7c0 1.8 1 3.4 2.6 4.5l-.6 1.9 2.2-1.1c.8.2 1.5.3 2.3.3h.6a4.6 4.6 0 0 1-.2-1.4c0-2.9 2.8-5.2 6.2-5.2h.6C15.4 4.7 12.4 3 8.7 3zm-2.4 3.1a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7zm4.8 0a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7z"/>
      <path d="M22.2 13.2c0-2.6-2.6-4.7-5.8-4.7s-5.8 2.1-5.8 4.7 2.6 4.7 5.8 4.7c.7 0 1.3-.1 1.9-.3l1.8.9-.5-1.6c1.6-.9 2.6-2.2 2.6-3.7zm-7.6-1a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm3.7 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z"/>
    </svg>
  )
}
