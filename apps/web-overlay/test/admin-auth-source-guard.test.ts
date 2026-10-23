/**
 * 后台鉴权与投稿审核的接线守卫（P0-1 / P1-3 / P0-2）。
 *
 * 为什么用源码守卫而不是行为测试：本仓库 vitest 跑在 node 环境（无 jsdom/RTL），
 * next-auth 的 jwt/session 回调与 Next route handler 无法在单测里真正执行；
 * 管理端 E2E 又因为需要登录态在 CI 里自跳过。这里锁「语义形态」，
 * 而不是把注释挖空后的字符串匹配。
 *
 * 修的是什么：
 *  P0-1 jwt/session 回调把 role 默认成 'admin' → GitHub OAuth 用户（profile 无 role）
 *       也拿到 role='admin'，于是 verifyAdminSession 里 `user.role === 'admin'`
 *       对任何登录用户放行，NAVHUB_ADMIN_IDS 白名单被整体绕过（页面中间件拦住了，
 *       但 API 路由全部失守）。
 *  P0-2 navigation/[id]、videos/[id]、extension/[id] 等 6 个动态子路由写操作直接调
 *       auth() + getServerGithubToken(session.user.id)，绕过了 verifyAdminSession() 的
 *       NAVHUB_ADMIN_IDS 白名单校验，导致任何普通 GitHub 登录用户均可篡改/删除全站导航与视频数据。
 *  P1-3 投稿审核只有「通过」分支调 requireAdmin，「拒绝」分支只校验登录；
 *       GET /api/submissions（投稿队列，含投稿人 URL/说明）完全无鉴权；
 *       且中枢回退通道下需携带服务端管理凭据避免 NAVHUB_AUTH_REQUIRED=true 时 401 死锁。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

/** role 被默认成 admin 的旧写法（`...role || 'admin'`） */
const ROLE_DEFAULT_ADMIN = /token\.role\s*=\s*\(user as \{ role\?: string \}\)\.role\s*\|\|/

describe('P0-1：登录用户不得因 role 默认值自动成为管理员', () => {
  const auth = read('src/lib/auth.ts')
  const authConfig = read('src/lib/auth.config.ts')

  it('两处 jwt 回调都不再把 role 默认成 admin', () => {
    expect(auth).not.toMatch(ROLE_DEFAULT_ADMIN)
    expect(authConfig).not.toMatch(ROLE_DEFAULT_ADMIN)
  })

  it('verifyAdminSession 不再凭 user.role === admin 放行（历史旧 session 也拦得住）', () => {
    const start = auth.indexOf('export async function verifyAdminSession')
    expect(start).toBeGreaterThan(-1)
    const rest = auth.slice(start)
    const end = rest.indexOf('\nexport ', 10)
    const body = end > 0 ? rest.slice(0, end) : rest

    expect(body).not.toContain("user.role === 'admin'")
    // 放行矩阵已下沉到 auth.config（P1-11），凭证管理员识别仍在那里、且同样不看 role
    expect(body).toContain('isAdminAccessAllowed(user)')
    expect(authConfig).toContain("user.id === 'admin'")
    expect(authConfig).not.toContain("user.role === 'admin'")
  })
})

describe('P0-2：所有导航/视频/扩展动态写路由必须统一走 verifyAdminSession 校验管理员白名单', () => {
  const DYNAMIC_ADMIN_ROUTES = [
    'src/app/api/navigation/[id]/route.ts',
    'src/app/api/navigation/[id]/categories/route.ts',
    'src/app/api/navigation/[id]/items/route.ts',
    'src/app/api/videos/[id]/route.ts',
    'src/app/api/videos/[id]/items/route.ts',
    'src/app/api/extension/[id]/route.ts',
  ]

  it.each(DYNAMIC_ADMIN_ROUTES)('%s 使用 verifyAdminSession 校验而非裸 getServerGithubToken', (rel) => {
    const src = read(rel)
    expect(src).toContain('verifyAdminSession')
    expect(src).not.toContain('getServerGithubToken(session.user.id)')
  })
})

describe('P1-3：审核动作与投稿队列都必须要求管理员且中枢通道携带委托凭据', () => {
  it('审核路由在入口统一 requireAdmin（通过 / 拒绝共用一道门）并支持中枢凭据', () => {
    const src = read('src/app/api/submissions/[number]/route.ts')
    expect(src).toContain("import { requireAdmin } from '@/lib/admin-guard'")
    expect(src).toMatch(/const adminCheck = await requireAdmin\(\)/)
    expect(src).toContain('NAVHUB_ADMIN_TOKEN')
  })

  it('GET /api/submissions 带 requireAdmin 门禁且透传 X-Forwarded-For 限流头', () => {
    const src = read('src/app/api/submissions/route.ts')
    expect(src).toContain("import { requireAdmin } from '@/lib/admin-guard'")
    expect(src).toMatch(/const admin = await requireAdmin\(\)[\s\S]{0,400}admin\.status \?\? 403/)
    expect(src).toContain('sanitizeForwardedFor')
    expect(src).toContain('NAVHUB_ADMIN_TOKEN')
  })
})

describe('边界与清理项：不留可重入的副作用', () => {
  it('算术投机解析不再使用 new Function，且仍有长度上限', () => {
    const src = read('src/lib/speculative.ts')
    expect(src).not.toContain('new Function')
    expect(src).toContain('if (trimmed.length > 256) return null')
  })

  it('模块级 <style> 注入按固定 id 去重（HMR 不再堆积重复节点）', () => {
    const src = read('src/app/admin/resources/page.tsx')
    expect(src).toContain('navhub-shimmer-keyframes')
    expect(src).toMatch(/!\s*document\.getElementById\(SHIMMER_STYLE_ID\)/)
  })
})
