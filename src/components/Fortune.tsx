import { useRef, useState } from 'react'
import type { 命盘 } from '../engine/types'
import { 排流年, 指纹 } from '../engine'
import { streamPost } from '../stream'
import { renderRich } from './richText'

const 本年 = new Date().getFullYear()
const 可选年 = [本年, 本年 + 1]

const 缓存键 = (c: 命盘, y: number) => `guanwo:fortune:${指纹(c)}|${y}`

// 流年：选一年 → 引擎算出该年干支/十神/大运 → AI 解读「这一年对你意味着什么」。
// 天然的回访理由，不靠制造焦虑。结果按盘+年缓存。
export default function Fortune({ chart }: { chart: 命盘 }) {
  const [year, setYear] = useState(本年)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const 看流年 = async (y: number) => {
    setYear(y)
    abortRef.current?.abort()
    // 命中缓存直接显示，不再请求
    const cached = localStorage.getItem(缓存键(chart, y))
    if (cached) { setText(cached); setBusy(false); return }

    const ac = new AbortController()
    abortRef.current = ac
    setText(''); setBusy(true)
    let acc = ''
    try {
      const 流年 = 排流年(chart.八字, y)
      const { ok, status } = await streamPost('/api/fortune', { 命盘: chart, 流年 }, ac.signal, (s) => { acc += s; setText(acc) })
      if (!ok) { setText(`流年服务暂时不可用（${status}）。`); return }
      try { localStorage.setItem(缓存键(chart, y), acc) } catch { /* 配额满等，忽略 */ }
    } catch {
      if (ac.signal.aborted) return
      setText('流年解读生成失败，请重试。')
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  const ly = 排流年(chart.八字, year)

  return (
    <div className="fortune">
      <div className="fortune-bar">
        <div className="seg fortune-years">
          {可选年.map((y) => (
            <button key={y} className={year === y ? 'on' : ''} onClick={() => 看流年(y)}>
              {y === 本年 ? `今年 ${y}` : `${y}`}
            </button>
          ))}
        </div>
        <div className="fortune-fact">
          {year} 流年 <b>{ly.干支}</b>
          {ly.天干十神 && <> · <span className="term" >{ly.天干十神}</span>主旋律</>}
          {ly.当前大运 && <> · {ly.当前大运.干支}大运</>}
        </div>
      </div>

      {!text && !busy && (
        <div className="reading-cta">
          <p>{year === 本年 ? `今年这股 ${ly.干支} 气，落到你盘上是顺是扭？` : `${year} 这年的 ${ly.干支}，对你这张盘是什么光景？`}</p>
          <button className="btn-primary" onClick={() => 看流年(year)}>看看 {year} 年</button>
        </div>
      )}

      {(busy || text) && (
        <div style={{ marginTop: 8 }}>
          {busy && !text && <div className="reading-thinking"><span className="dots">正在看年景</span></div>}
          {text && (
            <div className="reading-text">
              {renderRich(text)}
              {busy && <span className="caret" />}
            </div>
          )}
          {!busy && text && (
            <div className="reading-foot">
              <span className="disclaimer">观我 · DeepSeek 生成 · 流年是天气预报不是判决书</span>
              <button className="btn-ghost" onClick={() => { localStorage.removeItem(缓存键(chart, year)); 看流年(year) }}>换一段</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
