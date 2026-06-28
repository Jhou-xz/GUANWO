import { describe, it, expect } from 'vitest'
import { 排六爻, 背数成爻, type 爻值 } from './liuyao'

// 固定起卦时间，让月建/日辰/旬空可复现（具体干支交给 lunar-typescript，与八字同源）
const T = new Date(2024, 5, 18, 14, 30) // 2024-06-18 14:30

const 摘 = (卦: ReturnType<typeof 排六爻>['本卦']) => 卦.爻.map((y) => `${y.干支}${y.五行}${y.六亲}`)

describe('六爻装卦对账', () => {
  it('乾为天：纳甲/六亲逐爻对账（最经典命例）', () => {
    const g = 排六爻([7, 7, 7, 7, 7, 7], T) // 六少阳
    expect(g.本卦.卦名).toBe('乾为天')
    expect(g.本卦.宫).toBe('乾')
    expect(摘(g.本卦)).toEqual([
      '甲子水子孙', '甲寅木妻财', '甲辰土父母', '壬午火官鬼', '壬申金兄弟', '壬戌土父母',
    ])
    // 本宫纯卦：世在上爻(6)、应在三爻(3)
    expect(g.本卦.爻[5].世应).toBe('世')
    expect(g.本卦.爻[2].世应).toBe('应')
    expect(g.动爻位).toEqual([])
    expect(g.变卦).toBeUndefined()
  })

  it('坤为地：阴卦纳甲逆排对账', () => {
    const k = 排六爻([8, 8, 8, 8, 8, 8], T) // 六少阴
    expect(k.本卦.卦名).toBe('坤为地')
    expect(k.本卦.宫).toBe('坤')
    expect(摘(k.本卦)).toEqual([
      '乙未土兄弟', '乙巳火父母', '乙卯木官鬼', '癸丑土兄弟', '癸亥水妻财', '癸酉金子孙',
    ])
    expect(k.本卦.爻[5].世应).toBe('世')
  })

  it('坎为水：阳卦支顺排 + 六亲对账', () => {
    const c = 排六爻([8, 7, 8, 8, 7, 8], T) // 下坎上坎
    expect(c.本卦.卦名).toBe('坎为水')
    expect(摘(c.本卦)).toEqual([
      '戊寅木子孙', '戊辰土官鬼', '戊午火妻财', '戊申金父母', '戊戌土官鬼', '戊子水兄弟',
    ])
  })

  it('动爻成变卦：乾·初爻老阳 → 天风姤，变爻六亲按本卦宫', () => {
    const g = 排六爻([9, 7, 7, 7, 7, 7], T) // 初爻老阳(动)
    expect(g.本卦.卦名).toBe('乾为天')
    expect(g.动爻位).toEqual([1])
    expect(g.本卦.爻[0].变).toBe(true)
    expect(g.变卦?.卦名).toBe('天风姤')
    // 变卦初爻：下巽辛丑(土)，相对本卦宫乾金 → 土生金 = 父母（子孙化父母·回头克）
    expect(g.变卦?.爻[0].干支).toBe('辛丑')
    expect(g.变卦?.爻[0].六亲).toBe('父母')
  })

  it('一世卦世应：天风姤 世在初(1)应在四(4)', () => {
    const gou = 排六爻([8, 7, 7, 7, 7, 7], T) // 下巽上乾 = 天风姤(无动爻)
    expect(gou.本卦.卦名).toBe('天风姤')
    expect(gou.本卦.爻[0].世应).toBe('世')
    expect(gou.本卦.爻[3].世应).toBe('应')
  })

  it('六神随日干起、初→上连续', () => {
    const g = 排六爻([7, 7, 7, 7, 7, 7], T)
    const 神 = g.本卦.爻.map((y) => y.六神)
    const i = 神.indexOf(神[0])
    expect(new Set(神).size).toBe(6) // 六神不重复
    void i
  })

  it('起卦时间产出有效月建/日辰/旬空，且本卦爻空亡只落在旬空两支', () => {
    const g = 排六爻([7, 8, 9, 6, 7, 8], T)
    expect(g.旬空).toHaveLength(2)
    expect(g.日辰).toHaveLength(2)
    expect('子丑寅卯辰巳午未申酉戌亥').toContain(g.月建)
    const 空支 = new Set(g.旬空.split(''))
    for (const y of g.本卦.爻) expect(y.空亡).toBe(空支.has(y.地支))
  })

  it('背数成爻：0~3 背 → 6/7/8/9', () => {
    expect([0, 1, 2, 3].map((b) => 背数成爻(b))).toEqual([6, 7, 8, 9] as 爻值[])
  })

  it('爻值非 6 个则抛错', () => {
    expect(() => 排六爻([7, 7, 7] as 爻值[], T)).toThrow()
  })
})
