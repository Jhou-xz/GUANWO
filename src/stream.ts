// 共用的流式 POST：fetch + 逐块解码回调。
// 只管「发请求 + 读流 + 解码逐块吐出」；abort、累加、busy 状态、错误文案都留给调用方——
// 各组件 state 形态差异大（单串 / 消息数组 / 双视角分线），不强行统一，保持精简。
export async function streamPost(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onChunk: (s: string) => void,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) return { ok: false, status: res.status }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(dec.decode(value, { stream: true }))
  }
  return { ok: true, status: res.status }
}
