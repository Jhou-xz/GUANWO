// 排盘引擎入口：生辰 → 命盘 JSON（确定性，纯函数，无网络）。

import { Solar, Lunar } from 'lunar-typescript'
import type { BirthInput, 命盘 } from './types'
import { 排八字 } from './bazi'
import { 排紫微 } from './ziwei'
import { 真太阳时校正 } from './solartime'

export * from './types'
export { 排流年 } from './liunian'
export { 运柱, 流年干支, 排流月, 今日运柱, 支关系 } from './bazi'
export { 命盘详述 } from './aiformat'
export { 观我人格, 极标签 } from './renge'
export type { 人格 } from './renge'
export { 排六爻, 背数成爻, 爻值阳, 爻值变 } from './liuyao'
export type { 六爻卦, 单卦, 爻 as 六爻爻, 爻值 } from './liuyao'
export { 排紫微运限 } from './ziwei'
export type { 紫微运限, 运限层 } from './ziwei'

// 命盘指纹：同生辰即同一张盘。各处缓存/对话键统一以此为基，别再各写一遍。
export const 指纹 = (c: 命盘) => `${c.元信息.公历}|${c.元信息.时辰}|${c.元信息.输入.性别}`

const 时辰名 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
function 时辰(hour: number): string {
  if (hour >= 23) return '子（晚）'
  return 时辰名[Math.floor((hour + 1) / 2) % 12] + '时'
}
const pad = (n: number) => String(n).padStart(2, '0')

export function 排盘(input: BirthInput): 命盘 {
  let y = input.年
  let m = input.月
  let d = input.日

  // 农历输入先转公历，后续统一用公历驱动两套引擎
  if (input.历法 === '农历') {
    const lunar = Lunar.fromYmd(y, input.闰月 ? -m : m, d)
    const solar = lunar.getSolar()
    y = solar.getYear()
    m = solar.getMonth()
    d = solar.getDay()
  }
  // 校正前的阳历出生日期（用于「公历」展示）
  const 公历显示 = `${y}年${m}月${d}日 ${pad(input.时)}:${pad(input.分)}`

  // 真太阳时校正（需出生地；校正后可能跨日，故同时改写 y/m/d/时/分）
  let 时 = input.时
  let 分 = input.分
  let 真太阳时元 : 命盘['元信息']['真太阳时'] = undefined
  // 经度须为 [-180,180] 的有限数才校正——引擎可多端复用，脏经度(NaN/越界)宁可跳过校正，
  // 也不静默产出错盘（UI 端经度取自城市表已天然合法，这里是给其它调用方兜底）。
  const 经度有效 = typeof input.出生地?.经度 === 'number' && Number.isFinite(input.出生地.经度) && Math.abs(input.出生地.经度) <= 180
  const 启用校正 = input.真太阳时校正 !== false && !!input.出生地 && 经度有效
  if (启用校正 && input.出生地) {
    const r = 真太阳时校正(y, m, d, 时, 分, input.出生地.经度)
    y = r.校正后.年
    m = r.校正后.月
    d = r.校正后.日
    时 = r.校正后.时
    分 = r.校正后.分
    真太阳时元 = {
      启用: true,
      校正后时刻: r.跨日 ? `${m}月${d}日 ${pad(时)}:${pad(分)}` : `${pad(时)}:${pad(分)}`,
      经度时差分钟: r.经度时差分钟,
      均时差分钟: r.均时差分钟,
      总偏移分钟: r.总偏移分钟,
      跨日: r.跨日,
    }
  }

  const lunar = Solar.fromYmdHms(y, m, d, 时, 分, 0).getLunar()

  const 八字 = 排八字(y, m, d, 时, 分, input.性别)
  const 紫微 = 排紫微(y, m, d, 时, input.性别, true)

  const 说明: string[] = []
  if (启用校正) {
    说明.push(`已按出生地（${input.出生地!.名称}，东经 ${input.出生地!.经度}°）做真太阳时校正。`)
  } else {
    说明.push('未做真太阳时校正（按钟表/北京时间排算）；填写出生地可提升时柱精度。')
  }
  if (input.时辰未知) {
    说明.push('出生时辰未知，已按正午（午时）取值——时柱与紫微时系星耀不可靠，仅供参考。')
  }
  说明.push('流派选择：晚子时按库默认处理；旺衰为透明计数，非权威断语。')
  说明.push('仅供传统文化与自我探索参考。')

  return {
    版本: '1.0',
    元信息: {
      输入: input,
      公历: 公历显示,
      农历: lunar.toString(),
      时辰: 时辰(时),
      公历计算: { 年: y, 月: m, 日: d, 时 },
      真太阳时: 真太阳时元,
      说明,
    },
    八字,
    紫微,
  }
}
