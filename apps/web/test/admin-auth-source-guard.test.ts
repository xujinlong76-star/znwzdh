/**
 * 后台鉴权与投稿审核的接线守卫（P0-1 / P1-3）。
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
 *  P1-3 投稿审核只有「通过」分支调 requireAdmin，「拒绝」分支只校验登录；
 *       GET /api/submissions（投稿队列，含投稿人 URL/说明）完全无鉴权。
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
    expect(body).toContain("user.id === 'admin'")
  })
})

describe('P1-3：审核动作与投稿队列都必须要求管理员', () => {
  it('审核路由在入口统一 requireAdmin（通过 / 拒绝共用一道门）', () => {
    const src = read('src/app/api/submissions/[number]/route.ts')
    expect(src).toContain("import { requireAdmin } from '@/lib/admin-guard'")
    expect(src).toMatch(/const adminCheck = await requireAdmin\(\)/)
  })

  it('GET /api/submissions 带 requireAdmin 门禁（此前无鉴权）', () => {
    const src = read('src/app/api/submissions/route.ts')
    expect(src).toContain("import { requireAdmin } from '@/lib/admin-guard'")
    expect(src).toMatch(/const admin = await requireAdmin\(\)[\s\S]{0,400}admin\.status \?\? 403/)
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
