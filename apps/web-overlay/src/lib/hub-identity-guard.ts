/**
 * /api/hub/* 代理的身份裁决（纯函数，单测见 apps/web-overlay/test/hub-identity-guard.test.ts）。
 *
 * 为什么需要：代理原先对「请求里自称的身份」无条件签名（query/body/header 三入口），
 * 签名只证明"代理见过这个字符串"，并不证明调用方拥有该身份——任何登录用户把
 * `?anonId=github:victim` 带进来即可读写他人收藏/历史/画像/金库。**签名 ≠ 授权**。
 *
 * 裁决规则（顺序敏感）：
 * 1. 有 NextAuth 会话 → 一律使用会话派生的 canonical 身份，忽略并覆盖客户端自称；
 * 2. 无会话 → 只允许 `anon-<random>` 匿名域身份（凭据即浏览器 localStorage 里的
 *    随机 UUID，122 bit 不可枚举）；
 * 3. 无会话且自称非匿名身份（如 `github:123`）→ 拒绝（403）。开放模式下也拒绝：
 *    这条不依赖 HMAC 密钥是否配置，是无密钥部署的唯一防线。
 *
 * 匿名绑定 cookie（ANON_COOKIE）：代理在匿名请求上写入 HttpOnly 的
 * `<anonId>.<hmac>`，合并（/api/me/merge）时校验 body.anonId 是否与当前浏览器
 * 绑定的一致——防共享设备/多账号串号。它是 TOFU（首次接触即绑定），
 * 残余风险见 docs/USER-CENTER-UPGRADE-PLAN-2026-10-22.md §5.3。
 */

/** 与中枢 ANON_ID_RE 同族：anon- 前缀 + 随机串（UUID 含连字符） */
const ANON_PATTERN = /^anon-[A-Za-z0-9_-]{8,64}$/

export const ANON_COOKIE = 'navhub_anon'

export type HubIdentityVerdict =
  | { kind: 'session'; identity: string }
  | { kind: 'anon'; identity: string }
  | { kind: 'anonymous' }
  | { kind: 'rejected'; claimed: string }

export function isAnonIdentity(value: unknown): value is string {
  return typeof value === 'string' && ANON_PATTERN.test(value)
}

export function resolveHubIdentity(input: {
  sessionIdentity?: string | null
  claimedIdentity?: string | null
}): HubIdentityVerdict {
  const sessionIdentity = (input.sessionIdentity ?? '').trim()
  if (sessionIdentity) return { kind: 'session', identity: sessionIdentity }

  const claimed = (input.claimedIdentity ?? '').trim()
  if (!claimed) return { kind: 'anonymous' }
  if (isAnonIdentity(claimed)) return { kind: 'anon', identity: claimed }
  return { kind: 'rejected', claimed }
}

/** cookie 值格式：`<anonId>.<hex hmac>`；anonId 本身不含 '.'，从最后一个点切分是安全的 */
export function encodeAnonCookie(anonId: string, mac: string): string {
  return `${anonId}.${mac}`
}

export function parseAnonCookie(
  value: string | null | undefined,
): { anonId: string; mac: string } | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0 || dot === value.length - 1) return null
  const anonId = value.slice(0, dot)
  const mac = value.slice(dot + 1)
  if (!isAnonIdentity(anonId) || !/^[0-9a-f]{64}$/.test(mac)) return null
  return { anonId, mac }
}
