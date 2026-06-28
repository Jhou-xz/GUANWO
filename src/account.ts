// 账号 / 云端同步的前端调用。cookie 会话靠 same-origin 自动带。
import type { 命盘 } from './engine/types'

export type 账号 = { id: string; displayName: string | null; credits: number }
export type 同步盘 = { id: string; label: string; chart: 命盘; reading: string | null; ts: number }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || String(r.status))
  }
  return r.json() as Promise<T>
}
const postJSON = (body?: unknown): RequestInit =>
  ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

// 我是谁 + 微信登录是否可用（后端按是否配 appid 返回）
export const 取我 = () => j<{ user: 账号 | null; wechat: boolean }>('/api/me')
export const 退出 = () => j<{ ok: true }>('/api/auth/logout', postJSON())
export const dev登录 = (name: string) => j<{ user: 账号 }>('/api/auth/dev', postJSON({ name }))
export const 登录账号 = (username: string, password: string) => j<{ user: 账号 }>('/api/auth/login', postJSON({ username, password }))
export const 注册账号 = (username: string, password: string) => j<{ user: 账号 }>('/api/auth/register', postJSON({ username, password }))
export const 充值点数 = (amount: number) => j<{ ok: boolean; credits: number }>('/api/credits/recharge', postJSON({ amount }))
export const 微信登录地址 = '/api/auth/wechat'

// 双向同步：上传本地盘 → 服务端合并 → 回全量（前端据此替换本地）
type 上传盘 = { id: string; label: string; chart: 命盘; reading: string | null; ts: number }
export const 同步命盘 = (charts: 上传盘[]) => j<{ charts: 同步盘[] }>('/api/charts/sync', postJSON({ charts }))
export const 删云端盘 = (id: string) => j<{ ok: true }>('/api/charts/delete', postJSON({ id }))
export const 注销账号 = () => j<{ ok: true }>('/api/account/delete', postJSON())
