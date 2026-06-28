// 流年 —— 给定公历年，算出该年的干支、相对日主的十神，以及当年所处的大运。
// 引擎只写「事实」：流年干支由 lunar-typescript 取（立春已处理），十神按日主推。

import { Solar } from 'lunar-typescript'
import type { BaziChart, 流年 } from './types'

const 干五行: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
}
const 阳干 = new Set(['甲', '丙', '戊', '庚', '壬'])
const 生: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
const 克: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }

// 他干相对日主的十神
function 十神(日干: string, 他干: string): string {
  const me = 干五行[日干]; const other = 干五行[他干]
  if (!me || !other) return ''
  const 同阴阳 = 阳干.has(日干) === 阳干.has(他干)
  if (me === other) return 同阴阳 ? '比肩' : '劫财'
  if (生[me] === other) return 同阴阳 ? '食神' : '伤官' // 我生
  if (克[me] === other) return 同阴阳 ? '偏财' : '正财' // 我克
  if (克[other] === me) return 同阴阳 ? '七杀' : '正官' // 克我
  if (生[other] === me) return 同阴阳 ? '偏印' : '正印' // 生我
  return ''
}

export function 排流年(八字: BaziChart, 公历年: number): 流年 {
  // 取该年 6 月 1 日，安全避开立春（约 2/4）边界，得到该公历年的年干支
  const ec = Solar.fromYmdHms(公历年, 6, 1, 12, 0, 0).getLunar().getEightChar()
  const 天干 = ec.getYearGan()
  const 地支 = ec.getYearZhi()

  // 由首个大运反推出生公历年：起始公历年 - 起始虚岁 + 1
  const 首运 = 八字.大运[0]
  const 出生年 = 首运 ? 首运.起始公历年 - 首运.起始虚岁 + 1 : 公历年
  const 虚岁 = 公历年 - 出生年 + 1

  // 当年所处大运：起始公历年 ≤ 目标年 的最后一个
  const 当前大运 = [...八字.大运].reverse().find((d) => d.起始公历年 <= 公历年)

  return {
    公历年,
    干支: `${天干}${地支}`,
    天干,
    地支,
    纳音: ec.getYearNaYin(),
    天干十神: 十神(八字.日主, 天干),
    虚岁,
    当前大运,
  }
}
