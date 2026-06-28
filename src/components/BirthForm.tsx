import { useEffect, useMemo, useState } from 'react'
import type { BirthInput, CalendarType, Gender, 城市 } from '../engine/types'
import { 城市表 } from '../engine/cities'

// 生日改用下拉选择（与出生时间一致）：选项天然合法，杜绝错月/无效日（如 2 月 30 日）
const 当前年 = new Date().getFullYear()
const 年列表 = Array.from({ length: 当前年 - 1920 + 1 }, (_, i) => 当前年 - i) // 今年→1920，新→旧
// 该年该月有多少天：公历按真实天数动态算；农历给到 30（月大小由引擎判定）
const 月天数 = (历法: CalendarType, y: number, mo: number) =>
  历法 === '农历' ? 30 : new Date(y, mo, 0).getDate()

const 时辰名 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
function 时辰描述(hour: number): string {
  if (hour >= 23) return '子时（晚）23:00–00:59'
  const i = Math.floor((hour + 1) / 2) % 12
  const 起 = i === 0 ? 23 : i * 2 - 1
  const 止 = i === 0 ? 0 : i * 2 // 时辰末整点（如未时 i=7 → 14，即 14:59 收尾，15:00 起属申时）
  return `${时辰名[i]}时 ${String(起).padStart(2, '0')}:00–${String(止).padStart(2, '0')}:59`
}

export default function BirthForm({ onSubmit }: { onSubmit: (i: BirthInput, 称呼?: string) => void }) {
  const [称呼, set称呼] = useState('')
  const [历法, set历法] = useState<CalendarType>('公历')
  const [性别, set性别] = useState<Gender>('男')
  const [年, set年] = useState('') // 默认留空：让用户选自己的生日，别预填一个陌生人的日期
  const [月, set月] = useState('')
  const [日, set日] = useState('')
  const [时, set时] = useState('14')
  const [分, set分] = useState('30')
  const [闰月, set闰月] = useState(false)
  const [时辰未知, set时辰未知] = useState(false)

  const [城市输入, set城市输入] = useState('')
  const [选中城市, set选中城市] = useState<城市 | null>(null)
  const [显示列表, set显示列表] = useState(false)
  const [真太阳时, set真太阳时] = useState(true)

  const 候选 = useMemo(() => {
    const q = 城市输入.trim()
    if (!q) return 城市表.slice(0, 8)
    return 城市表.filter((c) => c.名称.includes(q)).slice(0, 8)
  }, [城市输入])

  const [dateErr, setDateErr] = useState('')

  // 切年/月/历法后，若当前「日」超出该月天数（如 1月31日→2月），收回到当月最后一天
  useEffect(() => {
    const max = 月天数(历法, +年, +月)
    if (+日 > max) set日(String(max))
  }, [历法, 年, 月, 日])

  const submit = () => {
    const y = +年, mo = +月, d = +日
    if (!年 || !月 || !日 || y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) {
      setDateErr('请把出生年月日填完整：年 1900–2100、月 1–12、日 1–31。')
      return
    }
    // 公历需再查这一天真实存在（如 2 月 30 日、4 月 31 日）；农历交给引擎，不在此卡
    if (历法 === '公历') {
      const dt = new Date(y, mo - 1, d)
      if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) { setDateErr(`${y} 年 ${mo} 月没有 ${d} 号，检查一下出生日期。`); return }
    }
    setDateErr('')
    onSubmit({
      历法,
      性别,
      年: +年, 月: +月, 日: +日,
      时: 时辰未知 ? 12 : +时,
      分: 时辰未知 ? 0 : +分,
      闰月: 历法 === '农历' ? 闰月 : undefined,
      出生地: 选中城市 ?? undefined,
      真太阳时校正: 真太阳时,
      时辰未知,
    }, 称呼.trim() || undefined)
  }

  return (
    <div className="form-card">
      <div className="field" style={{ marginBottom: 22 }}>
        <label>称呼 <span className="opt">（给这张盘起个名，如「我自己」「我对象」，可不填）</span></label>
        <input value={称呼} onChange={(e) => set称呼(e.target.value)} placeholder="我自己" />
      </div>
      <div className="seg-row">
        <div className="field">
          <label>历法</label>
          <div className="seg">
            {(['公历', '农历'] as CalendarType[]).map((c) => (
              <button key={c} className={历法 === c ? 'on' : ''} onClick={() => set历法(c)}>{c}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>性别</label>
          <div className="seg">
            {(['男', '女'] as Gender[]).map((g) => (
              <button key={g} className={性别 === g ? 'on' : ''} onClick={() => set性别(g)}>{g}</button>
            ))}
          </div>
        </div>
        {历法 === '农历' && (
          <div className="field">
            <label>闰月</label>
            <div className="seg">
              <button className={!闰月 ? 'on' : ''} onClick={() => set闰月(false)}>否</button>
              <button className={闰月 ? 'on' : ''} onClick={() => set闰月(true)}>是</button>
            </div>
          </div>
        )}
      </div>

      <div className="date-row">
        <div className="field"><label>年</label>
          <select value={年} onChange={(e) => set年(e.target.value)}>
            <option value="" disabled>选择</option>
            {年列表.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field"><label>月</label>
          <select value={月} onChange={(e) => set月(e.target.value)}>
            <option value="" disabled>选择</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} 月</option>)}
          </select>
        </div>
        <div className="field"><label>日</label>
          <select value={日} onChange={(e) => set日(e.target.value)}>
            <option value="" disabled>选择</option>
            {Array.from({ length: 年 && 月 ? 月天数(历法, +年, +月) : 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} 日</option>)}
          </select>
        </div>
      </div>
      {dateErr && <div className="field-err">{dateErr}</div>}

      {/* 出生时间 */}
      <div className="subfield">
        <div className="subfield-head">
          <label>出生时间</label>
          <button className={`mini-toggle${时辰未知 ? ' on' : ''}`} onClick={() => set时辰未知(!时辰未知)}>
            {时辰未知 ? '✓ ' : ''}不知道时辰
          </button>
        </div>
        {!时辰未知 ? (
          <div className="time-row">
            <select value={时} onChange={(e) => set时(e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')} 时</option>)}
            </select>
            <span className="colon">:</span>
            <select value={分} onChange={(e) => set分(e.target.value)}>
              {Array.from({ length: 60 }, (_, mi) => <option key={mi} value={mi}>{String(mi).padStart(2, '0')} 分</option>)}
            </select>
            <span className="shichen-hint">{时辰描述(+时)}</span>
          </div>
        ) : (
          <div className="unknown-hint">将按正午取值排盘；时柱不可靠，建议日后补准出生时间。</div>
        )}
      </div>

      {/* 出生地 + 真太阳时 */}
      <div className="subfield">
        <div className="subfield-head">
          <label>出生地<span className="opt">（用于真太阳时校正，可不填）</span></label>
          {选中城市 && (
            <button className={`mini-toggle${真太阳时 ? ' on' : ''}`} onClick={() => set真太阳时(!真太阳时)}>
              {真太阳时 ? '✓ ' : ''}真太阳时校正
            </button>
          )}
        </div>
        <div className="city-picker">
          <input
            placeholder="搜索城市，如「上海」"
            value={选中城市 ? `${选中城市.名称}（东经 ${选中城市.经度}°）` : 城市输入}
            onChange={(e) => { set选中城市(null); set城市输入(e.target.value); set显示列表(true) }}
            onFocus={() => { if (选中城市) { set选中城市(null); set城市输入('') } set显示列表(true) }}
            onBlur={() => setTimeout(() => set显示列表(false), 150)}
          />
          {显示列表 && 候选.length > 0 && (
            <div className="city-list">
              {候选.map((c) => (
                <div key={c.名称} className="city-item"
                  onMouseDown={() => { set选中城市(c); set城市输入(''); set显示列表(false) }}>
                  <span>{c.名称}</span><small>东经 {c.经度}°</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="actions">
        <button className="btn-primary block lg" onClick={submit}>起 盘</button>
      </div>
      <p className="form-note">观我基于传统八字与紫微文化，仅供自我探索与娱乐，非科学预测，不构成医疗 / 投资 / 法律建议。命盘默认只存在你这台设备（登录并开启同步后，才会加密存到服务器用于换设备找回）；生成解读时会把命盘发送给 AI 服务用于本次生成，不另作留存。</p>
    </div>
  )
}
