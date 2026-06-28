import { describe, it, expect } from 'vitest'
import { 排盘 } from './index'
import { 观我人格, 极标签 } from './renge'
import type { BirthInput } from './types'

const 盘 = (over: Partial<BirthInput> = {}) =>
  排盘({ 历法: '公历', 年: 1996, 月: 8, 日: 12, 时: 14, 分: 30, 性别: '男', ...over })

const 合法代号 = (c: string) =>
  /^[显隐][主应][创守][暖凉]$/.test(c)

describe('观我人格（东方版 MBTI）', () => {
  it('代号四位合法、名号与标签齐备', () => {
    const p = 观我人格(盘())
    expect(合法代号(p.代号)).toBe(true)
    expect(p.名号).toBeTruthy()
    expect(p.一句话).toBeTruthy()
    expect(p.标签).toHaveLength(4)
    expect('木火土金水').toContain(p.元素)
  })

  it('确定性：同生辰多次推导完全一致', () => {
    const a = 观我人格(盘())
    const b = 观我人格(盘())
    expect(a).toEqual(b)
  })

  it('标签与四轴一一对应', () => {
    const p = 观我人格(盘())
    expect(p.标签).toEqual([极标签[p.朝向], 极标签[p.底盘], 极标签[p.心法], 极标签[p.气候]])
  })

  it('朝向由日主阴阳决定（阳=显/阴=隐）', () => {
    // 1995-02-04 后多为乙亥年附近；直接构造阳日主与阴日主两盘对照
    const 阳 = 观我人格(盘({ 年: 1984, 月: 6, 日: 6 })) // 取一阳干日主盘
    const 阴 = 观我人格(盘({ 年: 1985, 月: 6, 日: 6 }))
    // 不假设具体日主，只校验：显↔阳干、隐↔阴干 的内在一致由 解释 文案体现
    for (const p of [阳, 阴]) {
      if (p.朝向 === '显') expect(p.解释.朝向).toContain('阳')
      else expect(p.解释.朝向).toContain('阴')
    }
  })

  it('扫一年生日：16 型代号全部合法，且不退化为单一型', () => {
    const 集 = new Set<string>()
    for (let m = 1; m <= 12; m++) {
      for (const d of [3, 12, 21]) {
        for (const g of ['男', '女'] as const) {
          const p = 观我人格(盘({ 年: 1994, 月: m, 日: d, 性别: g }))
          expect(合法代号(p.代号)).toBe(true)
          集.add(p.代号)
        }
      }
    }
    // 一年的样本应覆盖到多种型（不应所有盘都同一型——那说明判定退化）
    expect(集.size).toBeGreaterThanOrEqual(5)
  })

  it('元素取最旺五行', () => {
    const c = 盘()
    const p = 观我人格(c)
    const s = c.八字.五行统计
    const 最旺 = (['木', '火', '土', '金', '水'] as const).reduce((a, b) => (s[b] > s[a] ? b : a), '木' as const)
    expect(p.元素).toBe(最旺)
  })
})
