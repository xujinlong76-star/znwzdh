/**
 * /me 首屏概览的服务端取数 —— 只可在 Server Component / Route Handler 里用。
 *
 * 为什么要有它：页面此前先 GET `/api/auth/session`、再 GET `/api/me`，登录用户
 * 首屏必然多一次往返（骨架 → 两跳取数）。会话在服务端本来就有，把概览直接注入
 * 给客户端岛，只剩交互需要水合。
 *
 * 为什么直连中枢而不是自取 `/api/me`：RSC 里 fetch 相对路径会抛
 * `Failed to parse URL`（见 lib/server/hub.ts 的同一处说明）；签名逻辑直接复用
 * `lib/identity-signature`，身份口径与 BFF（app/api/me/[[...path]]/route.ts）一致。
 *
 * 降级口径：**任何失败都返回 null**，页面据此回落到原有的客户端自取分支
 * （loading / anonymous / error 四态语义不变）。首屏优化不该成为新的失败面，
 * 所以这里绝不抛。
 *
 * 仓库没有安装 `server-only` 包（依赖里没有），用这行说明代替它：
 * 本模块只允许被服务端代码引用，客户端组件不要 import。
 */
import type { Overview } from '@/lib/me-types'
import { hubIdentitySecret, signIdentity } from '@/lib/identity-signature'

/** 与 BFF 同源的取值顺序，避免「页面直连」和「BFF 转发」打到不同中枢 */
const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/+$/, '')

/** 比 BFF 的 15s 短：首屏等不起，超时就回落客户端自取 */
const TIMEOUT_MS = 8_000

function serviceToken(): string | undefined {
  return (
    process.env.NAVHUB_ADMIN_TOKEN ||
    process.env.NAVHUB_BOOTSTRAP_TOKEN ||
    process.env.NAVHUB_STORAGE_TOKEN ||
    process.env.NAVHUB_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    undefined
  )
}

/**
 * 形状校验：中枢返回 200 但字段缺失（老版本 / 网关占位响应）时按失败处理。
 * 概览渲染会直接读 counts/settings，形状不对宁可让客户端重新取一次。
 */
function isOverview(value: unknown): value is Overview {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const bag = (key: string) => Boolean(v[key]) && typeof v[key] === 'object'
  return typeof v.identity === 'string' && v.identity.length > 0 && bag('counts') && bag('settings')
}

export async function fetchMeOverview(identity: string): Promise<Overview | null> {
  const who = identity.trim()
  if (!who) return null

  try {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-navhub-user-id': who,
    }
    // 与 BFF 一致：有密钥用签名，无密钥但开启鉴权时回退附带服务端 Bearer token
    const secret = hubIdentitySecret()
    if (secret) {
      headers['x-navhub-identity-signature'] = await signIdentity(secret, who)
    } else {
      const token = serviceToken()
      if (token) headers['authorization'] = 'Bearer ' + token
    }

    const res = await fetch(HUB_BASE + '/api/me', {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null

    const data: unknown = await res.json().catch(() => {
      // 非 JSON（网关错误页 / 半截响应）：当作取数失败，交给客户端自取
      return null
    })
    return isOverview(data) ? data : null
  } catch {
    // 超时 / DNS / 连接被拒：首屏优化失败不等于页面失败，回落客户端自取
    return null
  }
}
