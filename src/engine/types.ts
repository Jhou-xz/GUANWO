// 命盘数据模型 —— 引擎与 UI/AI 之间的唯一契约。
// 引擎只写「事实」，不写「判断」（吉凶好坏是 AI 的活）。详见 docs/05。

export type Gender = '男' | '女'
export type CalendarType = '公历' | '农历'

export interface 城市 {
  名称: string
  经度: number
}

export interface BirthInput {
  历法: CalendarType
  年: number
  月: number
  日: number
  时: number // 0-23
  分: number // 0-59
  性别: Gender
  闰月?: boolean // 农历模式可选
  出生地?: 城市 // 真太阳时校正用
  真太阳时校正?: boolean // 默认 true（需出生地）
  时辰未知?: boolean // 不知道出生时间时为 true，时柱精度下降
}

// ───────────── 八字 ─────────────

export interface 藏干 {
  干: string
  十神: string
}

export interface 柱 {
  天干: string
  地支: string
  干十神: string // 日柱为「日主」
  纳音: string
  藏干: 藏干[]
  星运?: string // 日主在该地支的十二长生（长生/沐浴/…）
  自坐?: string // 该柱天干在该柱地支的十二长生
  旬空?: string // 该柱干支自身所在旬的旬空（如「戌亥」）
  神煞?: string[] // 该柱所带神煞
}

// 大运 / 流年 / 流月 共用的「一柱」结构（由干支即时构造）
export interface 运柱 {
  干支: string
  天干: string
  地支: string
  干十神: string
  藏干: 藏干[]
  星运: string
  自坐: string
  旬空: string
  纳音: string
  神煞: string[]
}

export interface 流年项 {
  公历年: number
  虚岁: number
  干支: string
  干十神: string
}

export interface 流月项 {
  节气: string
  日期: string
  干支: string
  天干: string
  地支: string
  干十神: string
  支十神: string // 地支主气藏干相对日主的十神
}

export interface 大运 {
  干支: string
  起始虚岁: number
  起始公历年: number
  干十神?: string // 大运天干相对日主的十神
  长生?: string // 日主在大运地支的十二长生
  流年?: 流年项[] // 该步大运覆盖的十年流年
}

export interface 五行统计 {
  木: number
  火: number
  土: number
  金: number
  水: number
  权重方案: string
}

// 五行旺相休囚死（以月令论）
export interface 五行旺衰 {
  木: string; 火: string; 土: string; 金: string; 水: string
  月令五行: string
}

export interface BaziChart {
  四柱: { 年: 柱; 月: 柱; 日: 柱; 时: 柱 }
  日主: string
  日主五行: string
  五行统计: 五行统计
  五行旺衰?: 五行旺衰
  起运: { 虚岁: number; 月: number; 方向: '顺行' | '逆行'; 交运公历?: string }
  大运: 大运[]
  胎元?: string
  命宫?: string
  身宫?: string
  司令?: string // 人元司令（月令当令之神）
  调候?: { 月令: string; 用神: string[]; 透: string[]; 藏: string[]; 标题: string }
}

// ───────────── 流年 ─────────────

export interface 流年 {
  公历年: number
  干支: string
  天干: string
  地支: string
  纳音: string
  天干十神: string // 流年天干相对日主的十神（如「正财」「七杀」）
  虚岁: number
  当前大运?: 大运 // 该年所处的大运；起运前为空
}

// ───────────── 紫微 ─────────────

export interface 星 {
  名: string
  类型: string // 主星 | 辅星 | 煞星 | 杂耀…
  亮度?: string
  四化?: string // 禄 | 权 | 科 | 忌
}

export interface 宫 {
  宫名: string
  天干: string
  地支: string
  是身宫: boolean
  是来因宫?: boolean
  主星: 星[]
  辅星: 星[]
  杂曜: 星[]
  大限: { 起虚岁: number; 止虚岁: number }
  大限干支?: string // 该宫作大限时的干支
  长生十二神?: string // 长生/沐浴/…
  博士十二神?: string // 博士/力士/青龙…
  将前十二神?: string // 将星/攀鞍/岁驿…
  岁前十二神?: string // 岁建/晦气/丧门…
  小限?: number[] // 该宫所主的小限虚岁
}

export interface ZiweiChart {
  五行局: string
  命宫地支: string
  身宫地支: string
  命主: string
  身主: string
  十二宫: 宫[] // 按地支固定顺序：子丑寅卯辰巳午未申酉戌亥
}

// ───────────── 顶层命盘 ─────────────

export interface 命盘 {
  版本: string
  元信息: {
    输入: BirthInput
    公历: string
    农历: string
    时辰: string
    公历计算?: { 年: number; 月: number; 日: number; 时: number } // 校正后实际排盘用的阳历（运限重算用）
    真太阳时?: {
      启用: boolean
      校正后时刻: string // 如「14:31」；跨日则带日期
      经度时差分钟: number
      均时差分钟: number
      总偏移分钟: number
      跨日: boolean
    }
    说明: string[]
  }
  八字: BaziChart
  紫微: ZiweiChart
}
