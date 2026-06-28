import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderRich } from './richText'

const html = (s: string) => renderToStaticMarkup(<>{renderRich(s)}</>)

describe('renderRich', () => {
  it('**加粗** 渲染成 <strong>', () => {
    const h = html('**重点**就在这')
    expect(h).toContain('<strong>重点</strong>')
    expect(h).toContain('就在这')
  })

  it('流式中未闭合的 ** 被截掉，不闪原始符号', () => {
    const h = html('已经说到一半 **还没闭合')
    expect(h).not.toContain('**')
    expect(h).not.toContain('<strong>')
    expect(h).toContain('已经说到一半')
  })

  it('--- 分割线被丢弃，空行分段成多个 <p>', () => {
    const h = html('第一段\n\n---\n\n第二段')
    expect(h).not.toContain('---')
    expect((h.match(/<p>/g) || []).length).toBe(2)
  })

  it('### 标题渲染成小标题块 .rt-h', () => {
    const h = html('### 性格底色')
    expect(h).toContain('rt-h')
    expect(h).toContain('性格底色')
    expect(h).not.toContain('#')
  })

  it('独占一行的 **标题** 也提成小标题块', () => {
    const h = html('**事业：稳中求变**\n\n正文在这。')
    expect(h).toMatch(/<h4 class="rt-h">[^]*事业：稳中求变/)
    expect(h).toContain('<p>')
    expect(h).toContain('正文在这')
  })

  it('段内单换行渲染 <br/>', () => {
    expect(html('上一行\n下一行')).toContain('<br/>')
  })

  it('空文本不炸', () => {
    expect(html('')).toBe('')
  })
})
