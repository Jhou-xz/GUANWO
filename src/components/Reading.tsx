import { renderRich } from './richText'
import { useCopied } from '../useCopied'

export default function Reading({
  text, busy, onGenerate,
}: { text: string; busy: boolean; onGenerate: () => void }) {
  const { copied, copy } = useCopied()

  if (!text && !busy) {
    return (
      <div className="reading-cta">
        <p>把这份命盘交给 AI，像朋友一样跟你聊聊它说了什么。</p>
        <button className="btn-primary" onClick={() => onGenerate()}>生成解读</button>
      </div>
    )
  }

  return (
    <div>
      {busy && !text && (
        <div className="reading-thinking"><span className="dots">正在落笔</span></div>
      )}
      {text && (
        <div className="reading-text">
          {renderRich(text)}
          {busy && <span className="caret" />}
        </div>
      )}
      {!busy && text && (
        <div className="reading-foot">
          <span className="disclaimer">观我 · DeepSeek 生成 · 传统文化视角，仅供自我探索</span>
          <div className="foot-actions">
            <button className="btn-ghost" onClick={() => copy(text)}>{copied ? '已复制 ✓' : '复制'}</button>
            <button className="btn-ghost" onClick={() => onGenerate()}>换一段解读</button>
          </div>
        </div>
      )}
    </div>
  )
}
