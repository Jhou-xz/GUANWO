import { useState } from 'react'

// 合规：首次「告知-同意」门 + 用户协议 / 隐私政策（in-app 可读）。
// 国内上线硬要求：PIPL 告知-同意、AI 生成内容显著标识、传统文化娱乐定位、未成年人提示。
// 文案要点与 docs/09-合规文案 同源；正式上线前由法务终审、补齐主体与联系方式。

const K_CONSENT = 'guanwo:consent:v1'

export const 已同意 = () => {
  try { return localStorage.getItem(K_CONSENT) === '1' } catch { return true } // 读不到不挡用户
}
const 记同意 = () => { try { localStorage.setItem(K_CONSENT, '1') } catch { /* */ } }

// ── 政策正文（精简但真实；完整可托管版见 docs/09）──
const 隐私要点 = [
  ['我们收集什么', '为生成命盘，你填写的出生日期、时间、出生地、性别属个人信息。命盘默认只存在你本机（localStorage）；仅在你登录并主动开启「云端同步」后，才加密存到服务器用于换设备找回。'],
  ['会发给谁', '生成解读时，命盘内容会发送给 AI 服务商（DeepSeek，境内）用于本次生成，我们不另作留存、不用于训练。除此之外不向任何第三方出售或共享你的个人信息。'],
  ['微信登录', '若使用微信登录，仅获取 openid 与昵称用于建立账号，绝不存储微信密码或令牌。'],
  ['你的权利', '你可随时在「账号」里关闭同步、删除单盘，或「注销账号」彻底删除全部云端数据（真删、不可恢复）。本机数据可在浏览器清除。'],
  ['未成年人', '本服务面向成年人。请年满 18 周岁后使用；未成年人须在监护人陪同并同意下使用。'],
]

const 协议要点 = [
  ['服务性质', '观我是一款传统文化体验产品，以八字、紫微斗数、六爻、解梦等中华传统文化为载体，帮助你了解性格、梳理思路、探索自我，属文化娱乐与自我参考。'],
  ['AI 生成 · 仅供参考', '所有解读均由 AI 生成，仅供文化娱乐与自我参考，不构成任何医疗、健康、法律、投资、婚恋等专业意见或决策依据。请理性看待，重要决定请咨询相应专业人士。'],
  ['不预测 · 不改运', '本服务不预测生死、寿命、疾病、灾祸，不宣扬宿命论；不涉及、不提供任何「改运、转运、消灾、化解、开光、作法」等服务。'],
  ['传统文化视角', '八字、紫微、六爻、解梦等为传统文化与心理探索的象征系统，并非科学预测，其内容不代表平台观点，也不保证准确。'],
  ['行为规范', '请勿借助本服务从事违法或损害他人的行为；因依赖解读内容作出的决定及后果由你自行承担。'],
]

function 政策弹层({ 标题, 段落, onClose }: { 标题: string; 段落: string[][]; onClose: () => void }) {
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet cmpl-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-term">{标题}</span>
          <button className="sheet-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="cmpl-body">
          {段落.map(([h, b]) => (
            <div key={h} className="cmpl-item">
              <h4>{h}</h4>
              <p>{b}</p>
            </div>
          ))}
          <p className="cmpl-note">
            本文为产品内说明摘要，完整条款见
            <a className="link" href={标题 === '隐私政策' ? '/privacy' : '/terms'} target="_blank" rel="noopener noreferrer">完整版《{标题}》</a>
            ，以正式发布版本为准。
          </p>
        </div>
      </div>
    </div>
  )
}

// 账号弹窗里的「关于与条款」入口内容（随时可看）
export function AboutTerms() {
  const [show, setShow] = useState<'协议' | '隐私' | null>(null)
  return (
    <div className="acct-sec">
      <p className="acct-priv">
        观我是传统文化体验产品，解读由 <b>AI 生成，仅供文化娱乐与自我参考</b>，不构成医疗/法律/投资等决策依据，
        不预测生死灾祸、不提供改运消灾。建议年满 18 周岁使用。
      </p>
      <div className="acct-actions">
        <button className="btn-ghost" onClick={() => setShow('协议')}>用户协议</button>
        <button className="btn-ghost" onClick={() => setShow('隐私')}>隐私政策</button>
      </div>
      {show === '协议' && <政策弹层 标题="用户协议" 段落={协议要点} onClose={() => setShow(null)} />}
      {show === '隐私' && <政策弹层 标题="隐私政策" 段落={隐私要点} onClose={() => setShow(null)} />}
    </div>
  )
}

// 首次访问的合规同意门：未同意前挡住全站（告知-同意 + AI标识 + 未成年人 + 免责一处达成）
export function ConsentGate({ onAgree }: { onAgree: () => void }) {
  const [show, setShow] = useState<'协议' | '隐私' | null>(null)
  const agree = () => { 记同意(); onAgree() }
  return (
    <div className="consent-mask">
      <div className="consent-card">
        <div className="consent-brand"><span className="spike-mini">✦</span> 观我</div>
        <h2>使用前，先说清楚</h2>
        <ul className="consent-list">
          <li><b>传统文化体验。</b>以八字、紫微、六爻、解梦等中华传统文化为载体，帮你了解性格、梳理思路、探索自我。</li>
          <li><b>AI 生成，仅供参考。</b>所有解读由 AI 生成，属文化娱乐与自我参考，<b>不构成</b>医疗、法律、投资等任何决策依据。</li>
          <li><b>不预测生死灾祸，不改运消灾。</b>不预测生死、寿命、疾病、灾祸，也不提供改运、转运、消灾、开光等服务。</li>
          <li><b>请理性看待。</b>建议年满 18 周岁使用；未成年人请在监护人陪同与同意下使用。</li>
        </ul>
        <p className="consent-agree">
          点击下方即表示你已阅读并同意
          <button className="link" onClick={() => setShow('协议')}>《用户协议》</button>
          与
          <button className="link" onClick={() => setShow('隐私')}>《隐私政策》</button>。
        </p>
        <button className="btn-primary block lg" onClick={agree}>我已阅读并同意，开始体验</button>
      </div>
      {show === '协议' && <政策弹层 标题="用户协议" 段落={协议要点} onClose={() => setShow(null)} />}
      {show === '隐私' && <政策弹层 标题="隐私政策" 段落={隐私要点} onClose={() => setShow(null)} />}
    </div>
  )
}
