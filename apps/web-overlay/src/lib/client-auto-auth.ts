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

/**
 * 服务端口径的「当前用户是不是管理员」——给“是否展示管理员入口”这类
 * 显隐决策用（F-09：/videos 页头“采集最新技术视频”按钮）。
 *
 * 为什么不用上面的 ensureAdminSession：它只认 session 里的 role/id，
 * 而 GitHub 白名单管理员（NAVHUB_ADMIN_IDS）登录后 session 里没有 role、
 * id 是 GitHub 数字 id，会被误判为非管理员——按钮一藏，这类管理员反而
 * 丢掉了自己有权限用的入口（回归）。这里直接探 GET /api/videos/harvest：
 * 该路由先跑服务端 verifyAdminSession（isAdminAccessAllowed 唯一口径，
 * 含白名单），非管理员在读任何数据前就 401/403；管理员才返回 200。
 * 探针无副作用：GET 只是读概览，不触发采集；失败一律按「不是管理员」
 * 处理（fail-closed，按钮默认隐藏）。
 */
export async function hasAdminAccess(): Promise<boolean> {
  try {
    const res = await fetch('/api/videos/harvest', { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}
