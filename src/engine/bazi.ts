// 八字排盘 —— 基于 lunar-typescript（成熟历法库，不自己造天文轮子）。
// 年柱按立春、月柱按节气、日柱按连续干支，库内已处理。详见 docs/03。

import { Solar } from 'lunar-typescript'
import type { BaziChart, 柱, 运柱 } from './types'
import { 算神煞 } from './shensha'
import { 算调候 } from './tiaohou'

// 天干 → 五行
const 干五行: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
}

function 拆藏干(hideGan: string[], shiShen: string[]) {
  return hideGan.map((干, i) => ({ 干, 十神: shiShen[i] ?? '' }))
}

// ── 十神 ──
const 阳干集 = new Set(['甲', '丙', '戊', '庚', '壬'])
const 生我相: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
const 克我相: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }
function 十神(日干: string, 他干: string): string {
  const me = 干五行[日干]; const other = 干五行[他干]
  if (!me || !other) return ''
  const 同 = 阳干集.has(日干) === 阳干集.has(他干)
  if (me === other) return 同 ? '比肩' : '劫财'
  if (生我相[me] === other) return 同 ? '食神' : '伤官'
  if (克我相[me] === other) return 同 ? '偏财' : '正财'
  if (克我相[other] === me) return 同 ? '七杀' : '正官'
  return 同 ? '偏印' : '正印'
}

// ── 十二长生 ──
const 地支序 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const 长生序 = ['长生', '沐浴', '冠带', '临官', '帝旺', '衰', '病', '死', '墓', '绝', '胎', '养']
const 长生起 : Record<string, number> = { 甲: 11, 乙: 6, 丙: 2, 丁: 9, 戊: 2, 己: 9, 庚: 5, 辛: 0, 壬: 8, 癸: 3 }
function 长生(干: string, 支: string): string {
  const 起 = 长生起[干]; const zi = 地支序.indexOf(支)
  if (起 === undefined || zi < 0) return ''
  const 顺 = 阳干集.has(干)
  const i = 顺 ? (zi - 起 + 12) % 12 : (起 - zi + 12) % 12
  return 长生序[i]
}

// ── 干支基础表（构造大运/流年柱用）──
const 天干表 = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
// 地支藏干（主气、中气、余气）
const 支藏干: Record<string, string[]> = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '庚', '戊'], 午: ['丁', '己'], 未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
}
// 六十甲子纳音（按 甲子→癸亥 顺序，每两干支同一纳音）
const 纳音名 = [
  '海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
  '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '沙中金', '山下火', '平地木', '壁上土', '金箔金',
  '覆灯火', '天河水', '大驿土', '钗钏金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水',
]
function 甲子序(干支: string): number {
  const gi = 天干表.indexOf(干支[0]); const zi = 地支序.indexOf(干支[1])
  if (gi < 0 || zi < 0) return -1
  // 求 0..59 中 ≡gi(mod10) 且 ≡zi(mod12)
  for (let n = 0; n < 60; n++) if (n % 10 === gi && n % 12 === zi) return n
  return -1
}
function 纳音(干支: string): string {
  const n = 甲子序(干支)
  return n < 0 ? '' : 纳音名[Math.floor(n / 2)]
}
// 旬空：干支自身所在旬的两个空亡地支
function 旬空(干支: string): string {
  const gi = 天干表.indexOf(干支[0]); const zi = 地支序.indexOf(干支[1])
  if (gi < 0 || zi < 0) return ''
  const 旬首支 = (zi - gi + 12) % 12
  return 地支序[(旬首支 + 10) % 12] + 地支序[(旬首支 + 11) % 12]
}

// 由干支即时构造一柱（大运 / 流年 / 流月用），ctx 提供日主与三柱地支以算神煞
export function 运柱(干支: string, ctx: { 日干: string; 年干: string; 年支: string; 日支: string; 月支: string }): 运柱 {
  const g = 干支[0]; const z = 干支[1]
  return {
    干支,
    天干: g,
    地支: z,
    干十神: 十神(ctx.日干, g),
    藏干: (支藏干[z] ?? []).map((h) => ({ 干: h, 十神: 十神(ctx.日干, h) })),
    星运: 长生(ctx.日干, z),
    自坐: 长生(g, z),
    旬空: 旬空(干支),
    纳音: 纳音(干支),
    神煞: 算神煞({ 天干: g, 地支: z }, ctx),
  }
}
// 今日日柱对命主的「运柱」——每日一瞥用。date 默认今天，取正午避开晚子时边界。
export function 今日运柱(chart: BaziChart, date = new Date()): 运柱 {
  const ec = Solar.fromYmdHms(date.getFullYear(), date.getMonth() + 1, date.getDate(), 12, 0, 0).getLunar().getEightChar()
  const c = chart.四柱
  return 运柱(ec.getDayGan() + ec.getDayZhi(), { 日干: chart.日主, 年干: c.年.天干, 年支: c.年.地支, 日支: c.日.地支, 月支: c.月.地支 })
}

// 地支六冲 / 六合（每日一瞥用：今日地支与命主日支的关系，让日签个体化——逢冲主动荡、逢合主牵绊）
const 六冲: Record<string, string> = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' }
const 六合: Record<string, string> = { 子: '丑', 丑: '子', 寅: '亥', 亥: '寅', 卯: '戌', 戌: '卯', 辰: '酉', 酉: '辰', 巳: '申', 申: '巳', 午: '未', 未: '午' }
export function 支关系(a: string, b: string): '冲' | '合' | null {
  if (六冲[a] === b) return '冲'
  if (六合[a] === b) return '合'
  return null
}

// 公历年 → 流年干支（以立春为界的标准年干支）
export function 流年干支(year: number): string {
  return 天干表[(year - 4 + 1000) % 10] + 地支序[(year - 4 + 1200) % 12]
}

// 地支主气藏干（用于流月支十神）
const 支主气: Record<string, string> = {
  子: '癸', 丑: '己', 寅: '甲', 卯: '乙', 辰: '戊', 巳: '丙', 午: '丁', 未: '己', 申: '庚', 酉: '辛', 戌: '戊', 亥: '壬',
}
// 十二节令（按节排月：正月立春起）。日期由 lunar 按年精确取。
const 流月节 = ['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒']

// 排某流年的十二流月：干支按五虎遁（正月寅起），节气日期取该年实际值
export function 排流月(year: number, 日干: string): import('./types').流月项[] {
  const 年干 = 流年干支(year)[0]
  const yi = 天干表.indexOf(年干)
  if (yi < 0) return []
  const 正月干 = (yi % 5) * 2 + 2 // 五虎遁：甲己丙、乙庚戊、丙辛庚、丁壬壬、戊癸甲
  // 实际节气日期：立春~大雪取本年，小寒取次年
  let 表本年: Record<string, ReturnType<typeof toMD>> = {}
  let 表次年: Record<string, ReturnType<typeof toMD>> = {}
  function toMD(s: { getMonth(): number; getDay(): number }) { return `${s.getMonth()}/${s.getDay()}` }
  try {
    const t1 = Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable()
    const t2 = Solar.fromYmd(year + 1, 2, 1).getLunar().getJieQiTable()
    for (const k of 流月节) { if (t1[k]) 表本年[k] = toMD(t1[k]); if (t2[k]) 表次年[k] = toMD(t2[k]) }
  } catch { /* 取节气失败则留空 */ }
  return 流月节.map((节, i) => {
    const g = 天干表[(正月干 + i) % 10]
    const z = 地支序[(2 + i) % 12] // 正月=寅(2)
    const 日期 = (节 === '小寒' ? 表次年[节] : 表本年[节]) ?? ''
    return {
      节气: 节, 日期, 干支: g + z, 天干: g, 地支: z,
      干十神: 十神(日干, g), 支十神: 十神(日干, 支主气[z] ?? ''),
    }
  })
}

// 地支 → 五行（定月令）
const 支五行: Record<string, string> = {
  寅: '木', 卯: '木', 巳: '火', 午: '火', 辰: '土', 戌: '土', 丑: '土', 未: '土', 申: '金', 酉: '金', 子: '水', 亥: '水',
}
// 五行旺相休囚死（行=月令五行，列=被判五行）
const 旺相表: Record<string, Record<string, string>> = {
  木: { 木: '旺', 火: '相', 水: '休', 金: '囚', 土: '死' },
  火: { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' },
  土: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  金: { 金: '旺', 水: '相', 土: '休', 火: '囚', 木: '死' },
  水: { 水: '旺', 木: '相', 金: '休', 土: '囚', 火: '死' },
}

// 人元司令分野：地支 → [人元干, 用事天数]（按「子平」常用一组；流派略有出入）
const 司令分野: Record<string, [string, number][]> = {
  子: [['壬', 10], ['癸', 20]],
  丑: [['癸', 9], ['辛', 3], ['己', 18]],
  寅: [['戊', 7], ['丙', 7], ['甲', 16]],
  卯: [['甲', 10], ['乙', 20]],
  辰: [['乙', 9], ['癸', 3], ['戊', 18]],
  巳: [['戊', 7], ['庚', 7], ['丙', 16]],
  午: [['丙', 10], ['己', 9], ['丁', 11]],
  未: [['丁', 9], ['乙', 3], ['己', 18]],
  申: [['戊', 7], ['壬', 7], ['庚', 16]],
  酉: [['庚', 10], ['辛', 20]],
  戌: [['辛', 9], ['丁', 3], ['戊', 18]],
  亥: [['戊', 7], ['甲', 5], ['壬', 18]],
}
// 距月节天数 → 当令人元
function 算司令(月支: string, 距节天: number): string {
  const seg = 司令分野[月支]
  if (!seg) return ''
  let acc = 0
  for (const [干, 日] of seg) { acc += 日; if (距节天 < acc) return 干 }
  return seg[seg.length - 1][0]
}

export function 排八字(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  gender: '男' | '女',
): BaziChart {
  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0)
  const lunar = solar.getLunar()
  const ec = lunar.getEightChar()

  const 年: 柱 = {
    天干: ec.getYearGan(),
    地支: ec.getYearZhi(),
    干十神: ec.getYearShiShenGan(),
    纳音: ec.getYearNaYin(),
    藏干: 拆藏干(ec.getYearHideGan(), ec.getYearShiShenZhi()),
  }
  const 月: 柱 = {
    天干: ec.getMonthGan(),
    地支: ec.getMonthZhi(),
    干十神: ec.getMonthShiShenGan(),
    纳音: ec.getMonthNaYin(),
    藏干: 拆藏干(ec.getMonthHideGan(), ec.getMonthShiShenZhi()),
  }
  const 日: 柱 = {
    天干: ec.getDayGan(),
    地支: ec.getDayZhi(),
    干十神: '日主',
    纳音: ec.getDayNaYin(),
    藏干: 拆藏干(ec.getDayHideGan(), ec.getDayShiShenZhi()),
  }
  const 时: 柱 = {
    天干: ec.getTimeGan(),
    地支: ec.getTimeZhi(),
    干十神: ec.getTimeShiShenGan(),
    纳音: ec.getTimeNaYin(),
    藏干: 拆藏干(ec.getTimeHideGan(), ec.getTimeShiShenZhi()),
  }

  // 专业字段：星运（日主十二长生）、自坐、旬空（各柱自身旬空对）、神煞
  const 日干 = ec.getDayGan()
  const 煞ctx = { 日干, 年干: 年.天干, 年支: 年.地支, 日支: 日.地支, 月支: 月.地支 }
  for (const 柱 of [年, 月, 日, 时]) {
    柱.星运 = 长生(日干, 柱.地支)
    柱.自坐 = 长生(柱.天干, 柱.地支)
    柱.旬空 = 旬空(柱.天干 + 柱.地支)
    柱.神煞 = 算神煞({ 天干: 柱.天干, 地支: 柱.地支 }, 煞ctx)
  }

  // 五行统计：4 天干各计 1，所有藏干各计 1（方案透明，见权重方案字段）
  const 统计 = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  const 计入 = (干: string) => {
    const wx = 干五行[干]
    if (wx) 统计[wx as keyof typeof 统计] += 1
  }
  for (const 柱 of [年, 月, 日, 时]) {
    计入(柱.天干)
    柱.藏干.forEach((c) => 计入(c.干))
  }

  // 调候用神（穷通宝鉴）：用神 + 本盘透/藏
  const 天干集 = [年, 月, 日, 时].map((p) => p.天干)
  const 藏干集 = [年, 月, 日, 时].flatMap((p) => p.藏干.map((c) => c.干))
  const 调候 = 算调候(日干, 月.地支, 天干集, 藏干集) ?? undefined

  // 五行旺衰（以月令论四时旺相休囚死）
  const 令 = 支五行[月.地支]
  const 五行旺衰 = 令 ? {
    木: 旺相表[令].木, 火: 旺相表[令].火, 土: 旺相表[令].土, 金: 旺相表[令].金, 水: 旺相表[令].水, 月令五行: 令,
  } : undefined

  // 司令（人元用事）：出生距月节天数 → 当令人元
  let 司令: string | undefined
  try {
    const 节 = lunar.getPrevJie().getSolar()
    const 距节天 = Solar.fromYmd(year, month, day).subtract(节)
    司令 = 算司令(月.地支, 距节天) || undefined
  } catch { /* 取节失败则略过 */ }

  // 大运（lunar gender: 1 男 / 0 女）
  const yun = ec.getYun(gender === '男' ? 1 : 0)
  const 大运 = yun.getDaYun().slice(1, 9).map((d) => {
    const gz = d.getGanZhi()
    const 起年 = d.getStartYear()
    const 起岁 = d.getStartAge()
    // 该步大运覆盖的十年流年
    const 流年 = Array.from({ length: 10 }, (_, k) => {
      const y = 起年 + k
      const 干支 = 流年干支(y)
      return { 公历年: y, 虚岁: 起岁 + k, 干支, 干十神: 十神(日干, 干支[0]) }
    })
    return {
      干支: gz,
      起始虚岁: 起岁,
      起始公历年: 起年,
      干十神: gz ? 十神(日干, gz[0]) : '',
      长生: gz ? 长生(日干, gz[1]) : '',
      流年,
    }
  })

  // 顺逆：阳男阴女顺行，阴男阳女逆行（由年干阴阳定）
  const 阳干 = ['甲', '丙', '戊', '庚', '壬']
  const 年阳 = 阳干.includes(年.天干)
  const 顺行 = (年阳 && gender === '男') || (!年阳 && gender === '女')

  return {
    四柱: { 年, 月, 日, 时 },
    日主: ec.getDayGan(),
    日主五行: 干五行[ec.getDayGan()] ?? '',
    五行统计: { ...统计, 权重方案: '天干及全部藏干各计 1（透明计数，非旺衰权威值）' },
    五行旺衰,
    起运: {
      虚岁: yun.getStartYear(),
      月: yun.getStartMonth(),
      方向: 顺行 ? '顺行' : '逆行',
      交运公历: yun.getStartSolar().toYmd(),
    },
    大运,
    胎元: ec.getTaiYuan(),
    命宫: ec.getMingGong(),
    身宫: ec.getShenGong(),
    调候,
    司令,
  }
}
