import type { 命盘 } from '../engine/types'
import { 天干原型, 解读五行 } from '../engine/knowledge'
import { 观我人格 } from '../engine/renge'

// 五行配色（深色面用，提亮版）：命主横幅 PersonaHero 与分享卡 ShareCard 共用。命主大字按本元素上色。
export const 五行色深: Record<string, string> = { 木: '#86b69a', 火: '#e0916f', 土: '#c79a5c', 金: '#e7c45c', 水: '#86abcd' }

// 命主摘要：观我人格「型」（主角）+ 命主原型 / 五行旺弱 / 命宫主星（底料）。
// 命主卡与分享卡共用一处，避免两边各算一遍漂移。
export function 命主摘要(chart: 命盘) {
  const 日主 = chart.八字.日主
  const 命宫 = chart.紫微.十二宫.find((g) => g.地支 === chart.紫微.命宫地支)
  return {
    人格: 观我人格(chart),
    日主,
    五行: chart.八字.日主五行,
    原型: 天干原型[日主],
    wx: 解读五行(chart.八字.五行统计),
    主星: 命宫?.主星.map((s) => s.名).join(' · ') || '空宫',
  }
}
