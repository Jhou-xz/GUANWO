import type { ReactNode } from 'react'

// 极简渲染：**加粗** + 段落（空行分段）+ 小标题。流式时隐藏未闭合的 **。
// 解读/深度分析/解梦/流年/追问共用。不引 markdown 库——保持轻量、避免流式闪烁。

function inline(s: string, keyBase: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={keyBase + i}>{part.slice(2, -2)}</strong>
      : <span key={keyBase + i}>{part}</span>,
  )
}

// 整行是标题：### 标题（模型偶吐）或独占一行的 **标题** → 提成小标题块，给长报告阅读锚点
function 取标题(ln: string): string | null {
  const h = ln.match(/^#{1,6}\s+(.+)$/) // 1–6 级井号都兜底（模型偶吐 #### 也不漏成字面量）
  if (h) return h[1].trim()
  const b = ln.match(/^\*\*([^*]+)\*\*$/)
  if (b) return b[1].trim()
  return null
}

export function renderRich(text: string): ReactNode {
  let t = text
  // 流式中若有未闭合的 **，先截掉，避免闪现原始符号
  if (((t.match(/\*\*/g) || []).length) % 2 === 1) t = t.slice(0, t.lastIndexOf('**'))

  const nodes: ReactNode[] = []
  let k = 0
  for (const blk of t.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b && !/^-{2,}$/.test(b))) {
    const lines = blk.split('\n')
    let para: string[] = []
    const flushPara = () => {
      if (!para.length) return
      const arr = para
      nodes.push(
        <p key={`p${k++}`}>
          {arr.map((ln, li) => (
            <span key={li}>{inline(ln, `${li}-`)}{li < arr.length - 1 && <br />}</span>
          ))}
        </p>,
      )
      para = []
    }
    for (const ln of lines) {
      const title = 取标题(ln)
      if (title) { flushPara(); nodes.push(<h4 className="rt-h" key={`h${k++}`}>{inline(title, 'h-')}</h4>) }
      else para.push(ln)
    }
    flushPara()
  }
  return nodes
}
