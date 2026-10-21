/**
 * 用户中心身份工具（纯函数，便于单测）。
 *
 * 会话里的 user.id 可能已经是 `github:123` 形态，也可能只是 provider 原始 id。
 * 统一收敛成 `<provider>:<id>`，与中枢 users.id（/api/users/sync 的返回值）一致。
 */

export interface SessionUserLike {
  id?: string | null
  provider?: string | null
}

export function canonicalUserId(user: SessionUserLike | null | undefined): string | null {
  const raw = (user?.id ?? '').trim()
  if (!raw) return null
  // 已经是 canonical 形态（例如中枢 sync 后写回的 id），不再重复加前缀
  if (raw.includes(':')) return raw
  const provider = (user?.provider ?? (raw === 'admin' ? 'credentials' : 'github')).trim()
  return provider + ':' + raw
}

/** 前端生成的匿名 id：anon-<uuid>，限制长度避免异常值进入别名表 */
export function isAnonId(value: unknown): value is string {
  return typeof value === 'string' && /^anon-[A-Za-z0-9_-]{8,80}$/.test(value)
}
