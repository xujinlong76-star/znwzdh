/**
 * Cron 端点的统一鉴权。
 *
 * 修复的两个历史缺陷（两个 cron 路由各写了一遍，且写法一致地不安全）：
 *
 * 1. **fail-open**：`if (cronSecret && providedSecret !== cronSecret)` —— 生产环境
 *    漏配 `CRON_SECRET` 时整段校验被跳过，匿名请求可直接触发采集写库，且不报错不告警。
 *    现在「未配置」= 关闭（503），而不是「放行」。
 *
 * 2. **允许 `?secret=`**：密钥进 URL 会被反向代理 access log、浏览器历史、Referer
 *    记录。现在只接受 `Authorization: Bearer <secret>`。
 *
 * 比较用 `timingSafeEqual`（先各自 sha256 成等长摘要，避免长度差异泄露）。
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string }

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function requireCronSecret(request: Request): CronAuthResult {
  const cronSecret = (process.env.CRON_SECRET || process.env.INTERNAL_JOB_TOKEN || '').trim()

  if (!cronSecret) {
    // fail-closed：宁可让定时任务失败并告警，也不能变成公开写接口
    return { ok: false, status: 503, error: 'Cron 未启用：缺少 CRON_SECRET / INTERNAL_JOB_TOKEN' }
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!provided) {
    return { ok: false, status: 401, error: 'Unauthorized: missing bearer token' }
  }

  const a = digest(provided)
  const b = digest(cronSecret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'Unauthorized: invalid cron secret' }
  }

  return { ok: true }
}
