import { useState } from 'react'
import type { 命盘 } from '../engine/types'
import { 命主摘要, 五行色深 as 五行色 } from './persona'
import ShareCard from './ShareCard'

// 解读首页的「命主」横幅：深墨面，零等待即呈现「这说的就是你」的第一击。
// 数据全来自引擎确定性计算，AI 还没开口，屏幕已经认得你。
export default function PersonaHero({ chart }: { chart: 命盘 }) {
  const { 人格, 日主, 五行, 原型, wx, 主星 } = 命主摘要(chart)
  const [share, setShare] = useState(false)
  const 系色 = 五行色[人格.元素]

  return (
    <div className="persona">
      <button className="persona-share" onClick={() => setShare(true)} title="生成分享卡">分享 ↗</button>
      <div className="persona-eyebrow">你是</div>

      {/* 主角：观我人格「型」——五行系 · 原型名号 + 4 字代号 */}
      <div className="persona-type">
        <span className="pt-name" style={{ color: 系色 }}>
          <span className="pt-xi">{人格.元素}系</span>{人格.名号}
        </span>
        <span className="pt-code">{人格.代号}</span>
      </div>
      <p className="persona-line">{人格.一句话}</p>
      <div className="persona-tags">
        {人格.标签.map((t) => <span key={t} className="pt-tag">{t}</span>)}
      </div>

      {/* 底料：命主原型 / 五行旺弱 / 命宫主星（型的依据，次要） */}
      <div className="persona-facts">
        <div className="pf">
          <span className="pf-k">命主</span>
          <span className="pf-v"><i style={{ color: 五行色[五行] }}>{日主}{五行}</i> · {原型?.意象}</span>
        </div>
        <div className="pf">
          <span className="pf-k">五行</span>
          <span className="pf-v">
            <i style={{ color: 五行色[wx.最旺] }}>{wx.最旺}</i> 最旺
            <span className="pf-dot">·</span>
            <i style={{ color: 五行色[wx.最弱] }}>{wx.最弱}</i> 最弱
          </span>
        </div>
        <div className="pf">
          <span className="pf-k">命宫主星</span>
          <span className="pf-v">{主星}</span>
        </div>
      </div>
      {share && <ShareCard chart={chart} onClose={() => setShare(false)} />}
    </div>
  )
}
