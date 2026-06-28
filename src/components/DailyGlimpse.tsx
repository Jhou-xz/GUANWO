import type { 命盘 } from '../engine/types'
import { 今日运柱, 支关系 } from '../engine'
import { 今日十神语, 今日冲合语 } from '../engine/knowledge'
import SsTag from './SsTag'

const 周 = ['日', '一', '二', '三', '四', '五', '六']
// 「每日一瞥」：今日日柱对你这张盘的确定性日签——每天一个属于你的小信号，纯引擎、零 token。
// 是镜子不是黄历：只观察「今天的气偏向什么」，不下宜忌指令。
export default function DailyGlimpse({ chart, onTerm, onAsk }:
  { chart: 命盘; onTerm?: (k: string) => void; onAsk?: (q: string) => void }) {
  const d = new Date()
  const t = 今日运柱(chart.八字, d) // 同一个 d，显示与计算不跨午夜错位
  const base = 今日十神语[t.干十神]
  if (!base) return null
  // 个体化：今日地支与「你的日支」相冲/相合——同一十神日也会因日支不同而分叉（标签 + 正文都体现）
  const rel = 支关系(t.地支, chart.八字.四柱.日.地支)
  const 关系语 = rel === '冲' ? '冲你日支' : rel === '合' ? '合你日支' : ''
  const 语 = base + (rel ? ' ' + 今日冲合语[rel] : '')
  const 问今天 = () => onAsk?.(
    `今天对我是「${t.干十神}」日（${t.干支}日${关系语 ? '，' + 关系语 : ''}${t.神煞.length ? '，带' + t.神煞.join('·') : ''}）。结合我的盘，今天我具体该留意什么、适合做什么？`)
  return (
    <div className="daily">
      <div className="daily-top">
        <span className="daily-date">今天 {d.getMonth() + 1}.{d.getDate()} 周{周[d.getDay()]} · {t.干支}日</span>
        <span className="daily-shen">对你是「{t.干十神}」日{关系语 && <em className="daily-rel"> · {关系语}</em>}</span>
      </div>
      <p className="daily-line">{语}</p>
      <div className="daily-foot">
        {t.神煞.length > 0 && (
          <div className="daily-ss">
            {t.神煞.map((s) => <SsTag key={s} label={s} onClick={() => onTerm?.(s)} />)}
          </div>
        )}
        {onAsk && <button className="btn-ghost daily-ask" onClick={问今天}>就今天问问 AI →</button>}
      </div>
    </div>
  )
}
