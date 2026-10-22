import { verifyAdminSession } from '@/lib/auth'

/**
 * 管理接口统一守卫。
 *
 * 背景：此前各管理路由各自手写 `if (!session) return 401`，口径不一，且
 * `app/api/admin/stats` 完全漏了鉴权（任何人可直接拉取站内统计）。
 *
 * **唯一口径 = `verifyAdminSession`**：
 *   1. 未登录 -> 401
 *   2. 凭证管理员（id='admin'）-> 放行
 *   3. 配置了 NAVHUB_ADMIN_IDS 且命中 -> 放行
 *   4. 生产环境未配置白名单 -> **403（fail-closed）**
 *   5. 仅开发环境未配置白名单 -> 放行（与既有开发体验一致）
 *
 * 历史缺陷：本文件曾自己维护一份 ADMIN_IDS，未配置时任何已登录用户都放行且
 * 不区分环境——生产漏配白名单等于把 `/api/admin/*` 对所有人开放。现已删除
 * 这份副本，避免两套口径再次分叉。
 *
 * 上线迁移步骤（运维）：
 *   1. 部署前设置 `NAVHUB_ADMIN_IDS=github登录名或邮箱`（逗号分隔，大小写不敏感），
 *      或改用 `NAVHUB_ADMIN_PASSWORD` 走凭证管理员登录（后者不受白名单影响）；
 *   2. 来不及配也不要放宽本守卫——生产启动日志会打印
 *      「未配置 NAVHUB_ADMIN_IDS：管理员入口将拒绝全部请求」，
 *      看到即说明「还没配」已被观测到，后台 403 是预期的安全默认而非故障；
 *   3. 本地开发（NODE_ENV !== production）未配白名单仍放行，不影响既有开发流程。
 */
export interface AdminGuardResult {
  ok: boolean
  status?: number
  reason?: string
}

export async function requireAdmin(): Promise<AdminGuardResult> {
  try {
    const result = await verifyAdminSession()
    if (result.ok) return { ok: true }
    return { ok: false, status: result.status, reason: result.error }
  } catch {
    // auth() 自身异常（密钥缺失/会话解析失败）按未授权处理，不放行
    return { ok: false, status: 401, reason: 'Unauthorized' }
  }
}
