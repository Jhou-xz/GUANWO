// 真太阳时校正 —— 钟表(北京)时间 → 出生地真太阳时。
// 真太阳时 = 北京时间 + 经度时差 + 均时差
//   经度时差 = (出生地经度 − 120) × 4 分钟（东经为正）
//   均时差   = 地球公转椭圆轨道与黄赤交角造成的偏差，全年约 ±16 分钟
// 校正后可能跨日（西部城市），故用儒略日做时间运算。详见 docs/03。

import { Solar } from 'lunar-typescript'

export interface 真太阳时结果 {
  校正后: { 年: number; 月: number; 日: number; 时: number; 分: number }
  经度时差分钟: number
  均时差分钟: number
  总偏移分钟: number
  跨日: boolean
}

const 取整 = (n: number) => Math.round(n)

// 一年中的第几天（基于儒略日，避免闰年手算出错）
function 年内日序(year: number, month: number, day: number): number {
  const jd0 = Solar.fromYmd(year, 1, 1).getJulianDay()
  const jd = Solar.fromYmd(year, month, day).getJulianDay()
  return Math.round(jd - jd0) + 1
}

// 均时差（分钟），标准近似公式，精度约 ±1 分钟
export function 均时差分钟(year: number, month: number, day: number): number {
  const N = 年内日序(year, month, day)
  const B = (2 * Math.PI * (N - 81)) / 364
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)
}

export function 真太阳时校正(
  year: number, month: number, day: number, hour: number, minute: number, 经度: number,
): 真太阳时结果 {
  const 经度时差 = (经度 - 120) * 4
  const 均时 = 均时差分钟(year, month, day)
  const 偏移 = 经度时差 + 均时

  const jd = Solar.fromYmdHms(year, month, day, hour, minute, 0).getJulianDay()
  const c = Solar.fromJulianDay(jd + 偏移 / 1440)

  return {
    校正后: { 年: c.getYear(), 月: c.getMonth(), 日: c.getDay(), 时: c.getHour(), 分: c.getMinute() },
    经度时差分钟: 取整(经度时差),
    均时差分钟: 取整(均时),
    总偏移分钟: 取整(偏移),
    跨日: c.getYear() !== year || c.getMonth() !== month || c.getDay() !== day,
  }
}
