/**
 * 管理守卫语义锁定测试（升级改造方案 P0-3）。
 *
 * 修的是什么：同一个仓库里曾经并存两套管理员判定口径——
 *   - `lib/auth.ts` 的 verifyAdminSession：未配白名单时「仅非生产环境放行」，生产 fail-closed；
 *   - `lib/admin-guard.ts` 的 requireAdmin：自己维护一份 ADMIN_IDS 副本，未配置时
 *     **任何已登录用户都放行且不区分环境**（文件头还写着「渐进收紧，避免未配置时误伤既有部署」）。
 * 于是：部署开了 GitHub OAuth 却没配 NAVHUB_ADMIN_IDS 时，任何能登录的人都能调
 * /api/admin/*（admin/stats、submissions 投稿队列、投稿审核通过/拒绝）。两套口径并存时，
 * 永远是更松的那个说了算。
 *
 * 现在的要求：requireAdmin 复用 verifyAdminSession（唯一口径）；生产未配白名单 403；
 * 开发环境保留豁免（否则本地开发立刻锁死）；并且未配置这件事必须在启动期看得见。
 *
 * 本测试断言的是**守卫语义**（放行/拒绝矩阵 + 启动告警），不是实现细节字符串——
 * 只有最后一节「口径唯一性」刻意做源码断言，防止有人再往 admin-guard 里塞第二份
 * 白名单副本。改实现需同步本文件。
 *
 * 为什么 mock next-auth：本仓 vitest 跑在 node 环境，next-auth 在 pnpm store 里解析
 * `next/server` 会直接抛 "Cannot find module"（同目录 admin-auth-source-guard.test.ts
 * 也据此只做源码守卫）。这里只替换 NextAuth 工厂与两个 provider，让真实的
 * verifyAdminSession / requireAdmin 逻辑在受控 session 下跑起来。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** 受控 session：verifyAdminSession 内部调用 auth() 时读它 */
const SESSION = vi.hoisted(() => ({
  current: null as null | { user?: Record<string, unknown> },
}))

vi.mock('next-auth', () => ({
  default: () => ({
    auth: async () => SESSION.current,
    handlers: { GET: () => {}, POST: () => {} },
  }),
}))
vi.mock('next-auth/providers/github', () => ({
  default: (o: Record<string, unknown>) => ({ ...o, id: 'github' }),
}))
vi.mock('next-auth/providers/credentials', () => ({
  default: (o: Record<string, unknown>) => ({ ...o, id: 'credentials' }),
}))

type GuardModule = typeof import('../src/lib/admin-guard')

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')

/** NODE_ENV 在 @types/node 里是只读字面量类型，测试需要动态改写 */
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key]
  else (process.env as Record<string, string | undefined>)[key] = value
}

type LoadOptions = {
  nodeEnv: string
  adminIds?: string
  session?: null | { user?: Record<string, unknown> }
  nextPhase?: string
}

/** 在受控环境下重新加载守卫（白名单与 NODE_ENV 都是模块级读取，必须 import 前设好） */
async function loadGuard(opts: LoadOptions): Promise<GuardModule> {
  vi.resetModules()
  SESSION.current = opts.session ?? null
  setEnv('NAVHUB_ADMIN_IDS', opts.adminIds)
  setEnv('NEXT_PHASE', opts.nextPhase)
  setEnv('NODE_ENV', opts.nodeEnv)
  // auth.config 在生产运行期缺 secret 会直接抛错，与本次断言无关，先给足
  setEnv('AUTH_SECRET', 's'.repeat(40))
  return import('../src/lib/admin-guard')
}

/** 一个普通的、已登录但不在白名单里的 GitHub OAuth 用户 */
const githubUser = (over: Record<string, unknown> = {}) => ({
  user: { id: 'gh-12345', email: 'stranger@example.com', name: 'stranger', ...over },
})

let savedNodeEnv: string | undefined
const savedKeys = ['NAVHUB_ADMIN_IDS', 'NEXT_PHASE', 'AUTH_SECRET'] as const

afterEach(() => {
  setEnv('NODE_ENV', savedNodeEnv)
  for (const k of savedKeys) setEnv(k, undefined)
  SESSION.current = null
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('requireAdmin 放行矩阵（P0-3 唯一口径）', () => {
  it('生产 + 未配置白名单 + 已登录非白名单用户 → 403（核心修复：此前放行）', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({ nodeEnv: 'production', session: githubUser() })
    const r = await guard.requireAdmin()
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
    expect(r.reason).toBe('Forbidden')
  })

  it('开发 + 未配置白名单 + 已登录 → 放行（dev 豁免必须保留，否则本地开发锁死）', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({ nodeEnv: 'development', session: githubUser() })
    await expect(guard.requireAdmin()).resolves.toEqual({ ok: true })
  })

  it('配置了白名单且命中（邮箱）→ 放行', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({
      nodeEnv: 'production',
      adminIds: 'koudev,dev@example.com',
      session: githubUser({ email: 'dev@example.com' }),
    })
    await expect(guard.requireAdmin()).resolves.toEqual({ ok: true })
  })

  it('配置了白名单且命中（GitHub 登录名，大小写不敏感）→ 放行', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({
      nodeEnv: 'production',
      adminIds: 'KouDev',
      session: githubUser({ email: undefined, name: 'koudev' }),
    })
    await expect(guard.requireAdmin()).resolves.toEqual({ ok: true })
  })

  it('配置了白名单但未命中 → 403', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({
      nodeEnv: 'production',
      adminIds: 'koudev',
      session: githubUser(),
    })
    const r = await guard.requireAdmin()
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  it('未登录 → 401（与调用方「请先登录」分支一致）', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({ nodeEnv: 'production', adminIds: 'koudev', session: null })
    const r = await guard.requireAdmin()
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
    expect(r.reason).toBe('Unauthorized')
  })

  it('凭证管理员（id=admin）即使不在白名单也放行（与 verifyAdminSession / 页面中间件同口径）', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const guard = await loadGuard({
      nodeEnv: 'production',
      adminIds: 'koudev',
      session: { user: { id: 'admin', email: 'admin@navhub.local', name: 'admin' } },
    })
    await expect(guard.requireAdmin()).resolves.toEqual({ ok: true })
  })
})

describe('启动期可观测告警（未配白名单必须看得见，而不是等被锁死才发现）', () => {
  it('生产运行期未配置白名单 → 打印 WARN 并写明「管理员入口将拒绝全部请求」', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadGuard({ nodeEnv: 'production', session: githubUser() })
    const msg = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(msg).toContain('未配置 NAVHUB_ADMIN_IDS')
    expect(msg).toContain('管理员入口将拒绝全部请求')
  })

  it('生产运行期已配置白名单 → 不打告警', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadGuard({ nodeEnv: 'production', adminIds: 'koudev', session: githubUser() })
    expect(warn).not.toHaveBeenCalled()
  })

  it('开发环境未配置白名单 → 不打告警（本地开发不该被噪音刷屏）', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadGuard({ nodeEnv: 'development', session: githubUser() })
    expect(warn).not.toHaveBeenCalled()
  })

  it('next build 期（NEXT_PHASE）不打告警 → 不污染镜像构建日志', async () => {
    savedNodeEnv = process.env.NODE_ENV
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadGuard({
      nodeEnv: 'production',
      nextPhase: 'phase-production-build',
      session: githubUser(),
    })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('口径唯一性：admin-guard 不得再自带第二份白名单', () => {
  const src = readFileSync(resolve(ROOT, 'src/lib/admin-guard.ts'), 'utf8')

  it('不再自行解析 NAVHUB_ADMIN_IDS / 自行比对身份（注释里提到变量名不算）', () => {
    expect(src).not.toContain('process.env.NAVHUB_ADMIN_IDS')
    expect(src).not.toContain('const ADMIN_IDS')
    expect(src).not.toContain('ADMIN_IDS.includes')
  })

  it('判定委托给 verifyAdminSession，并把 401/403 原样透出', () => {
    expect(src).toContain("from '@/lib/auth'")
    expect(src).toMatch(/await verifyAdminSession\(\)/)
    expect(src).toContain('status: result.status')
    expect(src).toContain('reason: result.error')
    expect(src).toContain('status: 401')
  })

  it('verifyAdminSession 只在非生产环境豁免未配置白名单（判定下沉到 auth.config）', () => {
    const auth = readFileSync(resolve(ROOT, 'src/lib/auth.ts'), 'utf8')
    const config = readFileSync(resolve(ROOT, 'src/lib/auth.config.ts'), 'utf8')
    // 401/403 的区分仍在 auth.ts，放行矩阵只有一份
    expect(auth).toContain('isAdminAccessAllowed(user)')
    expect(auth).toContain("error: 'Unauthorized', status: 401")
    expect(auth).toContain("error: 'Forbidden', status: 403")
    expect(config).toContain("const IS_NON_PRODUCTION = process.env.NODE_ENV !== 'production'")
    expect(config).toContain('if (ADMIN_IDS.length === 0) return IS_NON_PRODUCTION')
  })

  it('proxy.ts 的 /admin 闸门复用同一判定，不再是「登录即可」', () => {
    const proxy = readFileSync(resolve(ROOT, 'src/proxy.ts'), 'utf8')
    expect(proxy).toContain('isAdminAccessAllowed')
    expect(proxy).toContain('error=AccessDenied')
    // 旧实现只判 req.auth?.user 后直接 next()，必须消失
    expect(proxy).not.toMatch(/if \(!req\.auth\?\.user\) \{\s*const callbackUrl[\s\S]*?\}\s*\}\s*return NextResponse\.next\(\)/)
  })
})
