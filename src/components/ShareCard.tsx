import type { 命盘 } from '../engine/types'
import { 命主摘要, 五行色深 as 五行色 } from './persona'

// 分享卡：一张纯净的竖屏命主卡，给用户长按/截图发出去。确定性内容、零依赖（不上 html2canvas）。
// 放最像「这说的就是我」的身份标签——命主原型 + 五行 + 命宫主星 + 观我水印。
export default function ShareCard({ chart, onClose }: { chart: 命盘; onClose: () => void }) {
  const { 人格, 日主, 五行, 原型, 主星 } = 命主摘要(chart)
  const 系色 = 五行色[人格.元素]

  return (
    <div className="share-mask" onClick={onClose}>
      <div className="share-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="share-card">
          <div className="share-eyebrow">我是</div>
          {/* 头条：观我人格「型」 */}
          <div className="share-xi" style={{ color: 系色 }}>{人格.元素}系</div>
          <div className="share-dm" style={{ color: 系色 }}>{人格.名号}</div>
          <div className="share-code">{人格.代号}</div>
          <p className="share-line">{人格.一句话}</p>
          <div className="share-tags">
            {人格.标签.map((t) => <span key={t} style={{ borderColor: 系色 + '55', color: 系色 }}>{t}</span>)}
          </div>
          <div className="share-facts">
            <span>命主　<i style={{ color: 五行色[五行] }}>{日主}{五行}</i> · {原型?.意象}</span>
            <span>命宫主星　{主星}</span>
          </div>
          <div className="share-mark">观我 GUĀN WǑ</div>
          <div className="share-slogan">以八字与紫微为镜，照见你自己</div>
        </div>
        <div className="share-hint">长按或截图，把这张发出去</div>
        <button className="btn-ghost" onClick={onClose}>关闭</button>
      </div>
    </div>
  )
}
