import { useState } from 'react'
import type { BaziChart, 运柱 as 运柱型 } from '../engine/types'
import { 运柱, 流年干支, 排流月 } from '../engine'
import SsTag from './SsTag'

const 柱序: { key: keyof BaziChart['四柱']; label: string }[] = [
  { key: '年', label: '年柱' },
  { key: '月', label: '月柱' },
  { key: '日', label: '日柱' },
  { key: '时', label: '时柱' },
]

const 五行色: Record<string, string> = { 木: '#4a7c59', 火: '#9e2b25', 土: '#9c854c', 金: '#8a8479', 水: '#45576a' }
const 元色: Record<string, string> = { 木: '#2f7d4f', 火: '#c0392b', 土: '#9c7a33', 金: '#c97a2b', 水: '#2b6cb0' }
const 干五行: Record<string, string> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
const 支五行: Record<string, string> = { 寅: '木', 卯: '木', 巳: '火', 午: '火', 辰: '土', 戌: '土', 丑: '土', 未: '土', 申: '金', 酉: '金', 子: '水', 亥: '水' }
const cGan = (g: string) => 元色[干五行[g]] ?? 'var(--ink)'
const cZhi = (z: string) => 元色[支五行[z]] ?? 'var(--dai)'


// 一列的统一形状（四柱与运柱共用）
interface Col {
  key: string; label: string; sub?: string; grp: 'yun' | 'zhu'; last?: boolean; isDay?: boolean
  干十神: string; 天干: string; 地支: string; 旬空?: string; 纳音: string
  星运?: string; 自坐?: string; 藏干: { 干: string; 十神: string }[]; 神煞?: string[]
}

export default function BaziBoard({ chart, onTerm, onAsk }: {
  chart: BaziChart; onTerm: (k: string) => void; onAsk?: (q: string) => void
}) {
  const maxWx = Math.max(...(['木', '火', '土', '金', '水'] as const).map((k) => chart.五行统计[k]))
  const 起 = chart.起运
  const 旺衰 = chart.五行旺衰
  const ctx = { 日干: chart.日主, 年干: chart.四柱.年.天干, 年支: chart.四柱.年.地支, 日支: chart.四柱.日.地支, 月支: chart.四柱.月.地支 }
  const 大运表 = chart.大运 ?? []

  // 当前选中：默认覆盖今年的大运 + 今年
  const 今年 = new Date().getFullYear()
  const 默认运 = (() => {
    const i = 大运表.findIndex((d) => 今年 >= d.起始公历年 && 今年 < d.起始公历年 + 10)
    return i >= 0 ? i : 0
  })()
  const [运idx, set运idx] = useState(默认运)
  const [选柱, set选柱] = useState<string | null>(null)
  const 典籍 = ['穷通宝鉴', '滴天髓', '三命通会', '子平真诠', '渊海子平']
  const [典idx, set典idx] = useState(0)
  const dy = 大运表[运idx]
  const 该运流年 = dy?.流年 ?? (dy ? Array.from({ length: 10 }, (_, k) => {
    const y = dy.起始公历年 + k; return { 公历年: y, 虚岁: dy.起始虚岁 + k, 干支: 流年干支(y), 干十神: '' }
  }) : [])
  const 默认年 = (dy && 今年 >= dy.起始公历年 && 今年 < dy.起始公历年 + 10) ? 今年 : (dy?.起始公历年 ?? 今年)
  const [选年, set选年] = useState(默认年)
  const 选中流年 = 该运流年.find((y) => y.公历年 === 选年) ?? 该运流年[0]

  const 选运 = (i: number) => {
    set运idx(i)
    const d = 大运表[i]
    set选年(d && 今年 >= d.起始公历年 && 今年 < d.起始公历年 + 10 ? 今年 : (d?.起始公历年 ?? 今年))
  }

  // 组装列：年 月 日 时 ‖ 流年 · 大运。本命四柱在前——窄屏先看见自己的盘（尤其日元），
  // 流年/大运作为叠加的「当下语境」排在右侧，下方还有完整时间线，滑不到也不丢。
  const 运到列 = (rc: 运柱型, key: string, label: string, sub: string): Col => ({
    key, label, sub, grp: 'yun',
    干十神: rc.干十神, 天干: rc.天干, 地支: rc.地支, 旬空: rc.旬空, 纳音: rc.纳音,
    星运: rc.星运, 自坐: rc.自坐, 藏干: rc.藏干, 神煞: rc.神煞,
  })
  const cols: Col[] = []
  const 有运列 = !!(dy && 选中流年)
  柱序.forEach((p, idx) => {
    const c = chart.四柱[p.key]
    cols.push({
      key: p.key, label: p.label, grp: 'zhu', isDay: p.key === '日',
      last: 有运列 && idx === 柱序.length - 1, // 时柱后若接运列，加一道分隔
      干十神: c.干十神, 天干: c.天干, 地支: c.地支, 旬空: c.旬空, 纳音: c.纳音,
      星运: c.星运, 自坐: c.自坐, 藏干: c.藏干, 神煞: c.神煞,
    })
  })
  if (有运列) {
    cols.push(运到列(运柱(选中流年!.干支, ctx), 'ln', '流年', String(选年)))
    cols.push(运到列(运柱(dy!.干支, ctx), 'dy', '大运', `${dy!.起始虚岁}岁`))
  }

  const hasShensha = cols.some((c) => c.神煞 && c.神煞.length)
  const hasStar = cols.some((c) => c.星运)
  const cellCls = (c: Col) => `${c.grp === 'yun' ? 'g-yun ' : ''}${c.last ? 'g-div ' : ''}${c.key === 选柱 ? 'col-sel ' : ''}`.trim()
  const 选列 = cols.find((c) => c.key === 选柱)
  const 柱问 = (c: Col) => c.grp === 'yun'
    ? `详细讲讲我的${c.label}「${c.天干}${c.地支}」对我意味着什么？结合我的盘说说。`
    : `详细讲讲我的${c.label}（${c.天干}${c.地支}${c.isDay ? '，日元' : '，' + c.干十神}），它在我命里说明什么？`

  return (
    <div>
      <div className="bz-scroll">
        <table className="bazi-table pro">
          <thead>
            <tr>
              <th></th>
              {cols.map((c) => (
                <th key={c.key} className={`col-head ${cellCls(c)}`}
                  onClick={() => set选柱((s) => (s === c.key ? null : c.key))}>
                  {c.label}{c.sub && <em className="th-sub">{c.sub}</em>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rowlabel term" onClick={() => onTerm('十神')}>主星</td>
              {cols.map((c) => <td key={c.key} className={`ss ${cellCls(c)}`}>{c.isDay ? <b className="dayuan">日元</b> : c.干十神}</td>)}
            </tr>
            <tr className="gz-row">
              <td className="rowlabel">天干<br />地支</td>
              {cols.map((c) => (
                <td key={c.key} className={cellCls(c)}>
                  <div className={`gz${c.isDay ? ' day' : ''}`}>
                    <span className="gan" style={{ color: cGan(c.天干) }}>{c.天干}</span>
                    <span className="zhi" style={{ color: cZhi(c.地支) }}>{c.地支}</span>
                  </div>
                </td>
              ))}
            </tr>
            <tr>
              <td className="rowlabel term" onClick={() => onTerm('藏干')}>藏干</td>
              {cols.map((c) => (
                <td key={c.key} className={cellCls(c)}>
                  <div className="cang">
                    {c.藏干.map((h, j) => <span key={j}><i style={{ color: cGan(h.干) }}>{h.干}</i><small>{h.十神}</small></span>)}
                  </div>
                </td>
              ))}
            </tr>
            {hasStar && (
              <tr>
                <td className="rowlabel term" onClick={() => onTerm('星运')}>星运</td>
                {cols.map((c) => <td key={c.key} className={`cs ${cellCls(c)}`}>{c.星运 || '—'}</td>)}
              </tr>
            )}
            {cols.some((c) => c.自坐) && (
              <tr>
                <td className="rowlabel term" onClick={() => onTerm('自坐')}>自坐</td>
                {cols.map((c) => <td key={c.key} className={`cs ${cellCls(c)}`}>{c.自坐 || '—'}</td>)}
              </tr>
            )}
            {cols.some((c) => c.旬空) && (
              <tr>
                <td className="rowlabel term" onClick={() => onTerm('空亡')}>空亡</td>
                {cols.map((c) => <td key={c.key} className={`cs ${cellCls(c)}`}>{c.旬空 || '—'}</td>)}
              </tr>
            )}
            <tr>
              <td className="rowlabel term" onClick={() => onTerm('纳音')}>纳音</td>
              {cols.map((c) => <td key={c.key} className={`nayin ${cellCls(c)}`}>{c.纳音}</td>)}
            </tr>
            {hasShensha && (
              <tr className="ss-row">
                <td className="rowlabel term" onClick={() => onTerm('神煞')}>神煞</td>
                {cols.map((c) => (
                  <td key={c.key} className={cellCls(c)}>
                    <div className="shensha">{(c.神煞 ?? []).map((s) => <SsTag key={s} label={s} onClick={() => onTerm(s)} />)}</div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {选列 ? (
        <div className="palace-bar">
          <div className="pb-info">
            <b className="pb-name">{选列.label}　{选列.天干}{选列.地支}</b>
            <span className="pb-stars">
              {选列.isDay ? '日元' : 选列.干十神}
              {选列.星运 ? ` · 星运${选列.星运}` : ''}
              {选列.纳音 ? ` · ${选列.纳音}` : ''}
            </span>
            {选列.神煞 && 选列.神煞.length > 0 && <span className="pb-tri">神煞：{选列.神煞.join('·')}</span>}
          </div>
          {onAsk && (
            <button className="btn-ghost" onClick={() => onAsk(柱问(选列!))}>这一柱问 AI →</button>
          )}
        </div>
      ) : (
        <div className="palace-hint">点任一柱（含流年/大运），看这一柱详情，再决定要不要问 AI</div>
      )}

      {(chart.胎元 || chart.命宫 || chart.身宫 || chart.司令 || 起.交运公历) && (
        <div className="bz-info">
          {chart.司令 && <span><i className="term" onClick={() => onTerm('司令')}>司令</i><b>{chart.司令}</b></span>}
          {chart.胎元 && <span><i className="term" onClick={() => onTerm('胎元')}>胎元</i><b>{chart.胎元}</b></span>}
          {chart.命宫 && <span><i className="term" onClick={() => onTerm('命宫八字')}>命宫</i><b>{chart.命宫}</b></span>}
          {chart.身宫 && <span><i className="term" onClick={() => onTerm('身宫八字')}>身宫</i><b>{chart.身宫}</b></span>}
          <span className={onAsk ? 'term' : ''} onClick={onAsk ? () => onTerm('起运') : undefined}><i>起运</i><b>{起.虚岁}岁{起.月 ? ` ${起.月}月` : ''}</b>{起.交运公历 && <em>交运 {起.交运公历}</em>}</span>
        </div>
      )}

      <div className={`wuxing${onAsk ? ' askable-row' : ''}`} onClick={onAsk ? () => onTerm('五行') : undefined}>
        {(['木', '火', '土', '金', '水'] as const).map((k) => (
          <div className="wx-chip" key={k}>
            <div className="name" style={{ color: 五行色[k] }}>{k}</div>
            <div className="bar" style={{ background: 五行色[k], width: `${maxWx ? (chart.五行统计[k] / maxWx) * 100 : 0}%` }} />
            <div className="cnt">{chart.五行统计[k]}</div>
          </div>
        ))}
      </div>

      {旺衰 && (
        <div className={`wangshuai${onAsk ? ' askable-row' : ''}`} title="以月令论四时旺衰" onClick={onAsk ? () => onTerm('旺相') : undefined}>
          {(['木', '火', '土', '金', '水'] as const).map((k) => (
            <span key={k}><i style={{ color: 五行色[k] }}>{k}</i>{旺衰[k]}</span>
          ))}
        </div>
      )}

      {大运表.length > 0 && (
        <>
          <div className="dayun-head">大运 <span className="en">{起.方向} · 约 {起.虚岁} 岁起运 · 点选联动上表</span></div>
          <div className="timeline">
            {大运表.map((d, i) => (
              <button key={i} className={`tl-cell${i === 运idx ? ' on' : ''}`} onClick={() => 选运(i)}>
                {d.干十神 && <span className="ds">{d.干十神}</span>}
                <span className="gz2">{d.干支}</span>
                {d.长生 && <span className="ds cs">{d.长生}</span>}
                <span className="age">{d.起始虚岁}岁</span>
                <span className="year">{d.起始公历年}</span>
                {onAsk && <span className="ask-pill" onClick={(e) => { e.stopPropagation(); onAsk(`我走「${d.干支}」大运（${d.起始虚岁}岁起，${d.干十神 ?? ''}），这十年运势如何？结合我的盘说说。`) }}>问AI</span>}
              </button>
            ))}
          </div>

          <div className="dayun-head">流年 <span className="en">{dy?.起始公历年}–{(dy?.起始公历年 ?? 0) + 9}</span></div>
          <div className="timeline ln">
            {该运流年.map((y) => (
              <button key={y.公历年} className={`tl-cell${y.公历年 === 选年 ? ' on' : ''}`} onClick={() => set选年(y.公历年)}>
                {y.干十神 && <span className="ds">{y.干十神}</span>}
                <span className="gz2">{y.干支}</span>
                <span className="age">{y.虚岁}岁</span>
                <span className="year">{y.公历年}</span>
                {onAsk && <span className="ask-pill" onClick={(e) => { e.stopPropagation(); onAsk(`${y.公历年}年（${y.干支}流年，${y.干十神 ?? ''}）对我意味着什么？结合我的盘说说。`) }}>问AI</span>}
              </button>
            ))}
          </div>

          <div className="dayun-head">流月 <span className="en">{选年} 年 · 按节令</span></div>
          <div className="timeline ly">
            {排流月(选年, chart.日主).map((m) => (
              <div key={m.干支 + m.节气} className="tl-cell ly-cell">
                <span className="jq">{m.节气}<em>{m.日期}</em></span>
                <span className="ds">{m.干十神}</span>
                <span className="gz2" style={{ color: cGan(m.天干) }}>{m.天干}</span>
                <span className="gz2 zhi" style={{ color: cZhi(m.地支) }}>{m.地支}</span>
                <span className="ds cs">{m.支十神}</span>
                {onAsk && <span className="ask-pill" onClick={(e) => { e.stopPropagation(); onAsk(`${选年}年${m.节气}起的${m.干支}月（${m.干十神}）这段时间，我要注意或适合做什么？`) }}>问AI</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {chart.调候 && (
        <div className="guji">
          <div className="dayun-head">古籍参考 <span className="en">CLASSICAL REFERENCE</span></div>
          <div className="guji-card">
            <div className="guji-tabs">
              {典籍.map((t, i) => (
                <button key={t} className={i === 典idx ? 'on' : ''} onClick={() => set典idx(i)}>{t}</button>
              ))}
            </div>
            <div className="guji-body">
              {典idx === 0 ? (
                <>
                  <div className="th-row">
                    <span className="th-k term" onClick={() => onTerm('调候用神')}>调候用神</span>
                    <span className="th-chips">
                      {chart.调候.用神.map((u) => <b key={u} className="th-chip" style={{ color: cGan(u) }}>{u}</b>)}
                    </span>
                  </div>
                  <div className="th-row">
                    <span className="th-k">本八字</span>
                    <span className="th-state">
                      {chart.调候.透.length > 0 && <>透 {chart.调候.透.map((u) => <b key={u} className="th-chip on" style={{ color: cGan(u) }}>{u}</b>)}</>}
                      {chart.调候.藏.length > 0 && <>　藏 {chart.调候.藏.map((u) => <b key={u} className="th-chip dim" style={{ color: cGan(u) }}>{u}</b>)}</>}
                      {chart.调候.透.length === 0 && chart.调候.藏.length === 0 && <em className="th-none">用神不显，调候偏弱</em>}
                    </span>
                  </div>
                  <div className="guji-title">{chart.调候.标题}</div>
                  <p className="guji-text">
                    《穷通宝鉴》以日主与生月定调候用神：本盘<b>{chart.日主}</b>生<b>{chart.调候.月令}月</b>，
                    取 <b>{chart.调候.用神.join('、')}</b> 为调候关键。
                    {chart.调候.透.length > 0
                      ? `其中 ${chart.调候.透.join('、')} 已透于天干，调候得力。`
                      : chart.调候.藏.length > 0
                        ? `用神藏于地支（${chart.调候.藏.join('、')}），力量含蓄、待引而发。`
                        : '惜用神不显，寒暖调候偏弱，喜行运补之。'}
                  </p>
                  {onAsk && (
                    <button className="btn-ghost" onClick={() => onAsk(`结合《穷通宝鉴》，我${chart.日主}生${chart.调候?.月令}月、调候用神为${chart.调候?.用神.join('')}，这对我意味着什么？`)}>
                      让 AI 据此展开 →
                    </button>
                  )}
                </>
              ) : (
                <div className="guji-empty">
                  <p>《{典籍[典idx]}》的论断，会由 AI 结合你这张盘，在「解读」分区现场展开——比照搬古籍原文更贴合你本人。</p>
                  {onAsk && (
                    <button className="btn-ghost" onClick={() => onAsk(`请用《${典籍[典idx]}》的视角，解读我这张八字盘。`)}>
                      用《{典籍[典idx]}》视角解读 →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="notes">
        <div>日主 <b style={{ color: 'var(--cinnabar)' }}>{chart.日主}（{chart.日主五行}）</b> · 五行为透明计数，非旺衰权威断语 · 表格右侧「流年/大运」两列随下方点选联动</div>
      </div>
    </div>
  )
}
