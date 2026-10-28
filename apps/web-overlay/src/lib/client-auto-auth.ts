'use client'

/**
 * 客户端鉴权自动保障器 —— **刻意不做自动登录**。
 *
 * 早期版本在这里硬编码 `username=admin / password=admin` 并直接 POST
 * `/api/auth/callback/credentials`，三个后果都不可接受：
 *   1. 口令常量进了客户端 bundle，等于把默认凭证对公开发布（可被自动扫描）；
 *   2. `auth.ts` 里 `username = rawUsername || 'admin'` 且未配置
 *      `NAVHUB_ADMIN_PASSWORD` 的实例上，这段请求会**真的成功**——
 *      任何访客点开视频采集控制台即拿到管理员会话；
 *   3. 失败时静默 `return false`，调用方分不清「未登录」与「登录失败」。
 *
 * 现在的语义只有一条：**如实回答「当前是不是管理员会话」，不代用户做认证**。
 * 需要管理员权限的操作应当引导用户登录，而不是替他猜口令。
 * 守卫测试：apps/web/test/client-hardcoded-credentials.test.ts。
 */
export async function ensureAdminSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store' })
    if (!res.ok) return false
    const session = (await res.json()) as { user?: { id?: string; role?: string } } | null
    const user = session?.user
    return user?.role === 'admin' || user?.id === 'admin'
  } catch {
    // 会话读取失败按「不是管理员」处理：调用方会提示登录，不会误判为已授权
    return false
  }
}
