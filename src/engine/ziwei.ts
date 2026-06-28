// 紫微斗数排盘 —— 基于 iztro（专门的紫微 TS 库）。
// 安星规则确定性查表，库内已处理。详见 docs/03。

import { astro } from 'iztro'
import type { ZiweiChart, 宫, 星 } from './types'

// 地支固定顺序（命盘按此排，便于 UI 用方位渲染）
const 地支序 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

// 出生小时 → iztro 时辰序号（0 早子 … 11 亥 … 12 晚子）
export function 时辰序号(hour: number): number {
  if (hour >= 23) return 12 // 晚子时
  return Math.floor((hour + 1) / 2)
}

type IztroStar = { name: string; type: string; brightness?: string; mutagen?: string }

function 转星(stars: IztroStar[]): 星[] {
  return stars.map((s) => ({
    名: s.name,
    类型: s.type,
    亮度: s.brightness || undefined,
    四化: s.mutagen || undefined,
  }))
}

export function 排紫微(
  year: number,
  month: number,
  day: number,
  hour: number,
  gender: '男' | '女',
  fixLeap = true,
): ZiweiChart {
  const dateStr = `${year}-${month}-${day}`
  const a = astro.bySolar(dateStr, 时辰序号(hour), gender, fixLeap, 'zh-CN')

  // iztro palaces 顺序不保证为地支序，按地支重排，缺位留空
  const byBranch = new Map<string, (typeof a.palaces)[number]>()
  a.palaces.forEach((p) => byBranch.set(p.earthlyBranch, p))

  const 十二宫: 宫[] = 地支序.map((支) => {
    const p = byBranch.get(支)
    if (!p) {
      return { 宫名: '', 天干: '', 地支: 支, 是身宫: false, 主星: [], 辅星: [], 杂曜: [], 大限: { 起虚岁: 0, 止虚岁: 0 } }
    }
    const d = p.decadal as { range: number[]; heavenlyStem: string; earthlyBranch: string }
    return {
      宫名: p.name,
      天干: p.heavenlyStem,
      地支: p.earthlyBranch,
      是身宫: p.isBodyPalace,
      是来因宫: (p as { isOriginalPalace?: boolean }).isOriginalPalace,
      主星: 转星(p.majorStars as IztroStar[]),
      辅星: 转星(p.minorStars as IztroStar[]),
      杂曜: 转星(p.adjectiveStars as IztroStar[]),
      大限: { 起虚岁: d.range[0], 止虚岁: d.range[1] },
      大限干支: d.heavenlyStem && d.earthlyBranch ? d.heavenlyStem + d.earthlyBranch : undefined,
      长生十二神: (p as { changsheng12?: string }).changsheng12 || undefined,
      博士十二神: (p as { boshi12?: string }).boshi12 || undefined,
      将前十二神: (p as { jiangqian12?: string }).jiangqian12 || undefined,
      岁前十二神: (p as { suiqian12?: string }).suiqian12 || undefined,
      小限: (p as { ages?: number[] }).ages || undefined,
    }
  })

  return {
    五行局: a.fiveElementsClass,
    命宫地支: a.earthlyBranchOfSoulPalace,
    身宫地支: a.earthlyBranchOfBodyPalace,
    命主: a.soul,
    身主: a.body,
    十二宫,
  }
}

// ── 运限（大限 / 流年）：用 iztro horoscope 叠加宫位旋转 + 飞星四化 ──
export interface 运限层 {
  干支: string
  命宫地支: string // 该运的「命宫」落在哪个地支
  宫名: Record<string, string> // 地支 → 运限宫名
  四化: Record<string, string> // 星名 → 化(禄/权/科/忌)
}
export interface 紫微运限 { 大限: 运限层; 流年: 运限层 }

function 建运限层(layer: { index: number; heavenlyStem: string; earthlyBranch: string; palaceNames: string[]; mutagen: string[] }, idx到支: string[]): 运限层 {
  const 宫名: Record<string, string> = {}
  layer.palaceNames.forEach((名, i) => { if (idx到支[i]) 宫名[idx到支[i]] = 名 })
  const 四化: Record<string, string> = {}
  const 化序 = ['禄', '权', '科', '忌']
  layer.mutagen.forEach((星, i) => { if (星 && 化序[i]) 四化[星] = 化序[i] })
  return { 干支: layer.heavenlyStem + layer.earthlyBranch, 命宫地支: idx到支[layer.index], 宫名, 四化 }
}

// 由命盘 + 目标公历年，算出该年的大限/流年运限叠加层
export function 排紫微运限(g: { 年: number; 月: number; 日: number; 时: number; 性别: '男' | '女' }, 公历年: number, fixLeap = true): 紫微运限 | null {
  try {
    const a = astro.bySolar(`${g.年}-${g.月}-${g.日}`, 时辰序号(g.时), g.性别, fixLeap, 'zh-CN')
    const idx到支 = a.palaces.map((p) => p.earthlyBranch)
    const h = a.horoscope(`${公历年}-06-01`)
    return {
      大限: 建运限层(h.decadal as never, idx到支),
      流年: 建运限层(h.yearly as never, idx到支),
    }
  } catch {
    return null
  }
}
