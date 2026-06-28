import { useRef, useState, useEffect } from 'react'
import { 排六爻, 背数成爻, 爻值阳, 爻值变, type 六爻卦, type 单卦, type 爻值 } from '../engine'
import { streamPost } from '../stream'
import { renderRich } from './richText'

// 六爻（文王卦）：问一件事 → 三铜钱摇六次（动画随机）→ 引擎装卦 → AI 解卦 + 追问。
// 与命盘无关，是独立的「就这件事问一卦」。卦盘与最近一次会话存 localStorage，刷新不丢。

type Msg = { role: 'user' | 'assistant'; content: string }
const K = 'guanwo:liuyao:v1'

type Saved = { 问题: string; 爻值: 爻值[]; 起卦ms: number; msgs: Msg[] }

// 一次摇卦：3 枚铜钱，每枚背/字各半。背为阳记 1，背数 0~3 → 爻值 6/7/8/9。
function 摇一爻(): { 背: boolean[]; 值: 爻值 } {
  const 背 = [0, 0, 0].map(() => Math.random() < 0.5)
  return { 背, 值: 背数成爻(背.filter(Boolean).length) }
}

const 爻位名 = ['初', '二', '三', '四', '五', '上']

// 单卦盘：上爻在顶、初爻在底（传统画法）
function 卦盘({ 卦, 标神, 标题 }: { 卦: 单卦; 标神?: boolean; 标题: string }) {
  return (
    <div className="ly-gua">
      <div className="ly-gua-name">{标题}<b>{卦.卦名}</b><span className="ly-gong">{卦.宫}宫·{卦.宫五行}</span></div>
      <div className="ly-rows">
        {卦.爻.slice().reverse().map((y) => (
          <div key={y.位} className={`ly-row${y.世应 ? ' is-' + (y.世应 === '世' ? 'shi' : 'ying') : ''}`}>
            {标神 && <span className="ly-shen">{y.六神}</span>}
            <span className="ly-qin">{y.六亲}</span>
            <span className="ly-gz"><b className="gan">{y.干支[0]}</b><b className="zhi">{y.干支[1]}</b><i>{y.五行}</i></span>
            <span className={`ly-line ${y.阳 ? 'yang' : 'yin'}`}><i /><i /></span>
            <span className="ly-mark">
              {y.世应 && <em className={y.世应 === '世' ? 'shi' : 'ying'}>{y.世应}</em>}
              {y.空亡 && <em className="kong">空</em>}
              {y.变 && <em className="dong">{y.阳 ? '○' : '×'}</em>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 一枚古铜钱（外圆内方）。state：idle 待掷 / spin 翻飞 / bei 背面(光背=阳) / zi 字面(钱文=阴)。
// 钱文用品牌「观我通宝」，按古钱「对读」排布：上观·下我·右通·左宝。
function Coin({ state, uid }: { state: 'idle' | 'spin' | 'bei' | 'zi'; uid: number }) {
  const gid = `cu${uid}`
  return (
    <svg className={`coin coin-${state}`} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <radialGradient id={gid} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#dcbd7e" />
          <stop offset="55%" stopColor="#b78f4c" />
          <stop offset="100%" stopColor="#876731" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill={`url(#${gid})`} stroke="#6e5324" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="41.5" fill="none" stroke="#6e5324" strokeWidth="1" opacity="0.45" />
      <rect className="coin-hole" x="38" y="38" width="24" height="24" rx="2.5" stroke="#6e5324" strokeWidth="2" />
      {state === 'zi' && (
        <g className="coin-chars">
          <text x="50" y="25.5">观</text>
          <text x="50" y="75">我</text>
          <text x="74.5" y="50.5">通</text>
          <text x="25.5" y="50.5">宝</text>
        </g>
      )}
    </svg>
  )
}

export default function LiuYao() {
  const [问题, set问题] = useState('')
  const [爻值, set爻值] = useState<爻值[]>([])      // 已摇出的爻（初→上）
  const [起卦ms, set起卦ms] = useState<number | null>(null)
  const [coins, setCoins] = useState<boolean[] | null>(null) // 当前这次摇出的 3 枚铜钱背/字
  const [摇中, set摇中] = useState(false)
  const [成卦, set成卦] = useState(false)        // 六爻齐了、卦盘淡入前的短暂留白
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [followup, setFollowup] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // 载入上次未结束的卦
  useEffect(() => {
    try {
      const s: Saved = JSON.parse(localStorage.getItem(K) || 'null')
      if (s?.爻值?.length === 6) { set问题(s.问题); set爻值(s.爻值); set起卦ms(s.起卦ms); setMsgs(s.msgs || []) }
    } catch { /* */ }
  }, [])

  const 卦: 六爻卦 | null = 爻值.length === 6 && 起卦ms ? 排六爻(爻值, new Date(起卦ms), 问题.trim() || undefined) : null

  const persist = (p: Partial<Saved>) => {
    try {
      const cur: Saved = { 问题, 爻值, 起卦ms: 起卦ms ?? Date.now(), msgs, ...p }
      if (cur.爻值.length === 6) localStorage.setItem(K, JSON.stringify(cur))
    } catch { /* */ }
  }

  // 摇下一爻：铜钱翻滚 → 落定记爻（动爻震感更重）→ 卦象从下往上长一爻；满六爻先留白再淡入解卦
  const 摇卦 = () => {
    if (摇中 || 爻值.length >= 6) return
    set摇中(true)
    const { 背, 值 } = 摇一爻()
    setCoins(背)
    window.setTimeout(() => {
      const next = [...爻值, 值]
      set爻值(next)
      set摇中(false)
      // 触觉反馈：动爻（老阴/老阳）给一个「哒-哒」的双段震，普通爻轻点一下
      try { navigator.vibrate?.(爻值变(值) ? [10, 45, 22] : 14) } catch { /* 不支持就算了 */ }
      if (next.length === 6) {
        set成卦(true) // 六爻已成，先停一拍让用户看清整卦，再起卦解读
        window.setTimeout(() => {
          const ms = Date.now()
          set起卦ms(ms)
          persist({ 爻值: next, 起卦ms: ms, msgs: [] })
          解卦(next, ms)
        }, 760)
      }
    }, 640)
  }

  const 解卦 = async (vals: 爻值[], ms: number, history: Msg[] = []) => {
    const 卦盘 = 排六爻(vals, new Date(ms), 问题.trim() || undefined)
    const turn: Msg[] = history.length ? history : [{ role: 'user', content: 问题.trim() || '请就这一卦给我解读。' }]
    setMsgs([...turn, { role: 'assistant', content: '' }])
    setBusy(true)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    let acc = ''
    try {
      const { ok, status } = await streamPost('/api/liuyao', { 卦: 卦盘, messages: turn }, ac.signal, (s) => {
        acc += s; setMsgs([...turn, { role: 'assistant', content: acc }])
      })
      if (!ok) { setMsgs([...turn, { role: 'assistant', content: `（解卦服务暂时不可用 ${status}）` }]); return }
      persist({ 爻值: vals, 起卦ms: ms, msgs: [...turn, { role: 'assistant', content: acc }] })
    } catch {
      if (ac.signal.aborted) return
      setMsgs([...turn, { role: 'assistant', content: '（解卦失败，请重试）' }])
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  const 追问 = () => {
    const t = followup.trim()
    if (!t || busy || !卦 || !起卦ms) return
    setFollowup('')
    const history: Msg[] = [...msgs, { role: 'user', content: t }]
    解卦(爻值, 起卦ms, history)
  }

  const 重起 = () => {
    abortRef.current?.abort()
    set爻值([]); set起卦ms(null); setCoins(null); setMsgs([]); setBusy(false); set成卦(false)
    try { localStorage.removeItem(K) } catch { /* */ }
  }

  // ── 渲染 ──
  // 阶段一：还没摇满六爻 —— 问题 + 摇卦 + 卦象从下往上长出来
  if (!卦) {
    const 已摇 = 爻值.map((v) => ({ 阳: 爻值阳(v), 变: 爻值变(v) }))
    return (
      <div className="liuyao">
        {爻值.length === 0 ? (
          <div className="ly-ask">
            <label>想问的事 <span className="opt">（越具体越好，如「这份 offer 该不该接」「和 TA 还有没有戏」）</span></label>
            <textarea className="ly-q" rows={2} value={问题} placeholder="先在心里默念你要问的事，再写下来……"
              onChange={(e) => set问题(e.target.value)} />
          </div>
        ) : (
          问题.trim() && <div className="ly-question ly-question-cast">所问 · <b>{问题.trim()}</b></div>
        )}

        <div className="ly-cast">
          {/* 卦象自下而上生长：上爻在顶、初爻在底；已摇的爻落定、下一爻位微微呼吸、未摇的留白 */}
          <div className="ly-form" role="img" aria-label={`起卦进度 ${爻值.length}/6 爻`}>
            {[5, 4, 3, 2, 1, 0].map((idx) => {
              const y = 已摇[idx]
              const isNext = idx === 爻值.length && !摇中 && !成卦
              const cls = y ? `filled ${y.阳 ? 'yang' : 'yin'}${y.变 ? ' moving' : ''}` : 'empty'
              return (
                <div key={idx} className={`ly-form-row ${cls}${isNext ? ' next' : ''}`}>
                  <span className="ly-form-pos">{爻位名[idx]}</span>
                  <span className="ly-form-line"><i /><i /></span>
                  <span className="ly-form-dong">{y?.变 ? (y.阳 ? '○' : '×') : ''}</span>
                </div>
              )
            })}
          </div>

          {成卦 ? (
            <div className="ly-done"><span className="ly-done-star">✦</span> 六爻已成 · 正在起卦…</div>
          ) : (
            <>
              <div className={`ly-coins${摇中 ? ' rolling' : ''}`} aria-hidden>
                {[0, 1, 2].map((i) => {
                  const b = coins?.[i]
                  const state = 摇中 || !coins ? (coins ? 'spin' : 'idle') : b ? 'bei' : 'zi'
                  return <Coin key={i} uid={i} state={state} />
                })}
              </div>

              {/* 把这一掷的结果翻成爻，让用户看懂铜钱→爻的对应 */}
              {coins && !摇中 && (() => {
                const 背 = coins.filter(Boolean).length
                const 名 = ['老阴', '少阳', '少阴', '老阳'][背]
                const 动 = 背 === 0 ? '×动' : 背 === 3 ? '○动' : ''
                return <div className="ly-toss">{背} 背 {3 - 背} 字 · <b>{名}</b>{动 && <em> {动}</em>}</div>
              })()}

              <button className="btn-primary block lg" onClick={摇卦} disabled={摇中}>
                {摇中 ? '铜钱翻飞…' : 爻值.length === 0 ? '掷第一爻' : `掷第 ${爻位名[爻值.length]} 爻 · ${爻值.length}/6`}
              </button>
              <p className="ly-hint">默想所问之事，连掷六次。随机由此刻这一掷而定——心诚则灵，亦不必执着。</p>
              {爻值.length > 0 && <button className="btn-ghost ly-reset" onClick={重起}>重新开始</button>}
            </>
          )}
        </div>
      </div>
    )
  }

  // 阶段二：卦已成 —— 卦盘 + 解读 + 追问
  const last = msgs[msgs.length - 1]
  const streaming = busy && last?.role === 'assistant'
  return (
    <div className="liuyao">
      {问题.trim() && <div className="ly-question">所问 · <b>{问题.trim()}</b></div>}
      <div className="ly-meta">{卦.起卦时间}｜月建 {卦.月建}｜日辰 {卦.日辰}｜旬空 {卦.旬空}</div>

      <div className={`ly-boards${卦.变卦 ? ' two' : ''}`}>
        <卦盘 卦={卦.本卦} 标神 标题="本卦 " />
        {卦.变卦 && <卦盘 卦={卦.变卦} 标题="变卦 " />}
      </div>
      {卦.动爻位.length > 0
        ? <div className="ly-dongnote">动爻：{卦.动爻位.map((p) => 爻位名[p - 1] + '爻').join('、')} —— 事态正在变化，变卦是去向。</div>
        : <div className="ly-dongnote">六爻安静，无动爻 —— 事态偏稳，看本卦与世应。</div>}

      <div className="ly-reading">
        {msgs.map((m, i) => (
          m.role === 'user'
            ? (i === 0 ? null : <div key={i} className="ly-followq">{m.content}</div>)
            : (
              <div key={i} className="reading-text ly-answer">
                {m.content ? renderRich(m.content) : <span className="reading-thinking"><span className="dots">正在解卦</span></span>}
                {streaming && i === msgs.length - 1 && <span className="caret" />}
              </div>
            )
        ))}
      </div>

      {!busy && (
        <div className="ly-followup">
          <textarea rows={1} value={followup} placeholder="就这一卦再追问，如「应期大概什么时候」"
            onChange={(e) => setFollowup(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); 追问() } }} />
          <button className="chat-send" disabled={!followup.trim()} onClick={追问}>问</button>
        </div>
      )}

      <div className="ly-foot">
        <span className="disclaimer">观我 · DeepSeek 生成 · 卦是镜子，帮你看清处境，不是判决书</span>
        <button className="btn-ghost" onClick={重起}>另起一卦</button>
      </div>
    </div>
  )
}
