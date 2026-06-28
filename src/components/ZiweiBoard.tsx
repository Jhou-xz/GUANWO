import { useState } from 'react'
import type { ZiweiChart, 宫, 星 } from '../engine/types'
import { 排紫微运限, type 紫微运限 } from '../engine'

// 传统命盘 4×4 方位：地支 → 网格坐标（row, col 从 1 起）
const 方位: Record<string, { r: number; c: number }> = {
  巳: { r: 1, c: 1 }, 午: { r: 1, c: 2 }, 未: { r: 1, c: 3 }, 申: { r: 1, c: 4 },
  辰: { r: 2, c: 1 }, 酉: { r: 2, c: 4 },
  卯: { r: 3, c: 1 }, 戌: { r: 3, c: 4 },
  寅: { r: 4, c: 1 }, 丑: { r: 4, c: 2 }, 子: { r: 4, c: 3 }, 亥: { r: 4, c: 4 },
}
const 地支序 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const 四化序 = ['禄', '权', '科', '忌']

type 运限源 = { 年: number; 月: number; 日: number; 时: number; 性别: '男' | '女' }

function StarSpan({ s, 运限 }: { s: 星; 运限?: { 大?: string; 年?: string } }) {
  return (
    <span className="star-wrap">
      <span className={`star`}>
        {s.名}
        {s.亮度 && <span className="b">{s.亮度}</span>}
        {s.四化 && <span className="hua">{s.四化}</span>}
      </span>
      {运限?.大 && <span className="hua-yun da">大{运限.大}</span>}
      {运限?.年 && <span className="hua-yun nian">年{运限.年}</span>}
    </span>
  )
}

function PalaceCell({ g, isSoul, 现行, state, 运限, onSelect }: {
  g: 宫; isSoul: boolean; 现行?: boolean; state: '' | 'sel' | 'tri' | 'fade'; 运限?: 紫微运限 | null; onSelect: () => void
}) {
  const pos = 方位[g.地支]
  const 神 = [g.长生十二神, g.博士十二神, g.将前十二神, g.岁前十二神].filter(Boolean) as string[]
  const 大限宫 = 运限?.大限.宫名[g.地支]
  const 流年宫 = 运限?.流年.宫名[g.地支]
  const 星运限 = (s: 星) => 运限 ? { 大: 运限.大限.四化[s.名], 年: 运限.流年.四化[s.名] } : undefined
  return (
    <div
      className={`palace${isSoul ? ' soul' : ''}${现行 ? ' now' : ''}${state ? ' ' + state : ''} selectable`}
      style={{ gridRow: pos.r, gridColumn: pos.c }}
      onClick={onSelect}
    >
      {现行 && <span className="now-tag">现行大限</span>}
      {运限 && (大限宫 || 流年宫) && (
        <div className="yun-badges">
          {大限宫 && <span className="yb da">限·{大限宫}</span>}
          {流年宫 && <span className="yb nian">年·{流年宫}</span>}
        </div>
      )}
      <div className="stars">
        {g.主星.map((s, i) => <StarSpan key={'M' + i} s={s} 运限={星运限(s)} />)}
        {g.辅星.map((s, i) => <StarSpan key={'m' + i} s={s} 运限={星运限(s)} />)}
        {g.杂曜.map((s, i) => <span key={'a' + i} className="star adj">{s.名}</span>)}
      </div>
      {神.length > 0 && <div className="palace-shen">{神.join(' · ')}</div>}
      <div className="foot">
        <span className="pname">
          {g.宫名}
          {g.是身宫 && <span className="body-tag">身</span>}
          {g.是来因宫 && <span className="lai-tag">来</span>}
        </span>
        <span className="foot-right">
          <span className="decadal">{g.大限.起虚岁}–{g.大限.止虚岁}</span>
          <span className="gz3">{g.天干}{g.地支}</span>
        </span>
      </div>
    </div>
  )
}

export default function ZiweiBoard({ chart, 运限源, onTerm, onAsk }: {
  chart: ZiweiChart; 运限源?: 运限源; onTerm: (k: string) => void; onAsk?: (q: string) => void
}) {
  const [sel, setSel] = useState<string | null>(null)
  const [mode, setMode] = useState<'本命' | '运限'>('本命')
  const 今年 = new Date().getFullYear()
  const 出生年 = 运限源?.年 ?? 今年

  // 大限列表（按起虚岁排序）
  const 大限表 = chart.十二宫.filter((g) => g.宫名 && g.大限干支)
    .map((g) => ({ 干支: g.大限干支!, 起: g.大限.起虚岁, 止: g.大限.止虚岁, 起年: 出生年 + g.大限.起虚岁 - 1 }))
    .sort((a, b) => a.起 - b.起)
  const 默认年 = (() => {
    const v = 今年 - 出生年 + 1
    const dy = 大限表.find((d) => v >= d.起 && v <= d.止)
    return dy ? 今年 : (大限表[0]?.起年 ?? 今年)
  })()
  const [选年, set选年] = useState(默认年)
  const 选虚岁 = 选年 - 出生年 + 1
  const 当前大限 = 大限表.find((d) => 选虚岁 >= d.起 && 选虚岁 <= d.止) ?? 大限表[0]
  const 该限流年 = 当前大限
    ? Array.from({ length: 当前大限.止 - 当前大限.起 + 1 }, (_, k) => ({ 虚岁: 当前大限.起 + k, 公历年: 出生年 + 当前大限.起 + k - 1 }))
    : []

  const 运限 = (mode === '运限' && 运限源) ? 排紫微运限(运限源, 选年) : null

  // 当前正走的大限（默认标出，外行不点也懂）
  const 当前虚岁 = 今年 - 出生年 + 1
  const 现行大限宫 = 运限源 ? chart.十二宫.find((g) => g.宫名 && 当前虚岁 >= g.大限.起虚岁 && 当前虚岁 <= g.大限.止虚岁) : null

  // 三方四正（点选）
  const 三方四正 = (支: string): string[] => {
    const i = 地支序.indexOf(支)
    return [(i + 6) % 12, (i + 4) % 12, (i + 8) % 12].map((x) => 地支序[x])
  }
  const tri = sel ? 三方四正(sel) : null
  const triSet = tri ? new Set(tri) : null
  const 选宫 = sel ? chart.十二宫.find((g) => g.地支 === sel) : null
  const 三方宫名 = tri ? tri.map((支) => chart.十二宫.find((g) => g.地支 === 支)?.宫名).filter(Boolean).join(' · ') : ''
  const 选宫星名 = 选宫 ? ([...选宫.主星, ...选宫.辅星].map((s) => s.名).join('·') || '空宫') : ''

  // 生年四化
  const 生年四化: Record<string, string> = {}
  chart.十二宫.forEach((g) => [...g.主星, ...g.辅星].forEach((s) => { if (s.四化) 生年四化[s.四化] = s.名 }))

  return (
    <div className="ziwei-wrap">
      {运限源 && (
        <div className="ziwei-mode">
          <div className="seg">
            {(['本命', '运限'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setSel(null) }}>{m}</button>
            ))}
          </div>
          {运限 && <span className="mode-hint">大限 <b>{运限.大限.干支}</b> · 流年 <b>{运限.流年.干支}</b>（{选年}）</span>}
        </div>
      )}

      <div className="ziwei-board" onClick={(e) => { if (e.currentTarget === e.target) setSel(null) }}>
        {chart.十二宫.filter((g) => g.宫名).map((g) => {
          const state = sel === g.地支 ? 'sel' : triSet?.has(g.地支) ? 'tri' : sel ? 'fade' : ''
          return (
            <PalaceCell key={g.地支} g={g} isSoul={g.地支 === chart.命宫地支} state={state} 运限={运限}
              现行={mode === '本命' && !sel && g.地支 === 现行大限宫?.地支}
              onSelect={() => setSel((s) => (s === g.地支 ? null : g.地支))} />
          )
        })}
        <div className="center-cell">
          <div className="big term" onClick={() => onTerm('五行局')}>{chart.五行局} <i>?</i></div>
          <div className="row">
            <span className="term" onClick={() => onTerm('命宫')}>命宫</span><b>{chart.命宫地支}</b> ·{' '}
            <span className="term" onClick={() => onTerm('身宫')}>身宫</span><b>{chart.身宫地支}</b>
          </div>
          <div className="row">命主<b>{chart.命主}</b> · 身主<b>{chart.身主}</b></div>
          {四化序.some((h) => 生年四化[h]) && (
            <div className="sihua term" onClick={() => onTerm('四化')}>
              {四化序.filter((h) => 生年四化[h]).map((h) => (
                <span key={h} className="sihua-item"><i>{生年四化[h]}</i>化{h}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 运限时间轴 */}
      {mode === '运限' && 大限表.length > 0 && (
        <>
          <div className="dayun-head">大限 <span className="en">点选切换运限</span></div>
          <div className="timeline">
            {大限表.map((d) => (
              <button key={d.起} className={`tl-cell${选虚岁 >= d.起 && 选虚岁 <= d.止 ? ' on' : ''}`}
                onClick={() => set选年(今年 >= d.起年 && 今年 <= d.起年 + (d.止 - d.起) ? 今年 : d.起年)}>
                <span className="gz2">{d.干支}</span>
                <span className="age">{d.起}–{d.止}岁</span>
                <span className="year">{d.起年}</span>
              </button>
            ))}
          </div>
          <div className="dayun-head">流年 <span className="en">{当前大限?.起年}–{(当前大限?.起年 ?? 0) + (当前大限 ? 当前大限.止 - 当前大限.起 : 0)}</span></div>
          <div className="timeline ln">
            {该限流年.map((y) => (
              <button key={y.公历年} className={`tl-cell${y.公历年 === 选年 ? ' on' : ''}`} onClick={() => set选年(y.公历年)}>
                <span className="gz2">{y.公历年}</span>
                <span className="age">{y.虚岁}岁</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 选中宫位信息栏（本命模式） */}
      {mode === '本命' && (选宫 ? (
        <div className="palace-bar">
          <div className="pb-info">
            <b className="pb-name">{选宫.宫名}{选宫.是身宫 && <em>·身宫</em>}</b>
            <span className="pb-stars">{选宫星名}</span>
            <span className="pb-tri">三方四正：{三方宫名}</span>
          </div>
          {onAsk && (
            <button className="btn-ghost" onClick={() => onAsk(`详细讲讲我的${选宫!.宫名}（${选宫星名}），结合它的三方四正（${三方宫名}）说说对我意味着什么。`)}>
              这一宫问 AI →
            </button>
          )}
        </div>
      ) : (
        <div className="palace-hint">
          {现行大限宫
            ? <>你现在正走 <b>「{现行大限宫.宫名}」大限</b>（{现行大限宫.大限.起虚岁}–{现行大限宫.大限.止虚岁} 岁）· 点任一宫看三方四正与详情</>
            : '点任一宫，看它的三方四正与详情，再决定要不要问 AI'}
        </div>
      ))}

      {mode === '运限' && 运限 && onAsk && (
        <div className="palace-bar">
          <div className="pb-info">
            <b className="pb-name">{选年} 年运势</b>
            <span className="pb-stars">大限{运限.大限.干支} · 流年{运限.流年.干支}</span>
          </div>
          <button className="btn-ghost" onClick={() => onAsk(`${选年}年我的紫微运势如何？大限${运限!.大限.干支}（飞${四化序.filter(h=>Object.values(运限!.大限.四化).includes(h)).map(h=>Object.keys(运限!.大限.四化).find(k=>运限!.大限.四化[k]===h)+'化'+h).join('、')}）、流年${运限!.流年.干支}，结合我的盘说说。`)}>
            这一年问 AI →
          </button>
        </div>
      )}
    </div>
  )
}
