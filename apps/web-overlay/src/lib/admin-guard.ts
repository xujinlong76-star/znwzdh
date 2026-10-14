import { auth } from '@/lib/auth'

/**
 * 管理接口统一守卫。
 *
 * 背景：此前各管理路由各自手写 `if (!session) return 401`，口径不一，且
 * `app/api/admin/stats` 完全漏了鉴权（任何人可直接拉取站内统计）。
 *
 * 语义（渐进收紧，避免未配置时误伤既有部署）：
 *   1. 未登录 -> 401
 *   2. 配置了 NAVHUB_ADMIN_IDS 但未命中 -> 403
 *   3. 未配置白名单 -> 维持「已登录即可」的历史行为
 *
 * 需要严格管控时，设置 NAVHUB_ADMIN_IDS=github登录名或邮箱（逗号分隔），
 * 此时后台页面（middleware）与所有接入本守卫的接口都会强制校验。
 */
const ADMIN_IDS = (process.env.NAVHUB_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export interface AdminGuardResult {
  ok: boolean
  status?: number
  reason?: string
}

interface AdminSessionUser {
  email?: string | null
  name?: string | null
}

export async function requireAdmin(): Promise<AdminGuardResult> {
  let session: { user?: AdminSessionUser } | null = null
  try {
    session = (await auth()) as { user?: AdminSessionUser } | null
  } catch {
    return { ok: false, status: 401, reason: 'Unauthorized' }
  }

  if (!session?.user) return { ok: false, status: 401, reason: 'Unauthorized' }

  if (ADMIN_IDS.length > 0) {
    const identity = (session.user.email || session.user.name || '').toLowerCase()
    if (!identity || !ADMIN_IDS.includes(identity)) {
      return { ok: false, status: 403, reason: 'Forbidden' }
    }
  }

  return { ok: true }
}
