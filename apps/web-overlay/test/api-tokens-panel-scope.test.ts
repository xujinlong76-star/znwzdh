/**
 * 个人令牌三档权限（run72 auth-identity）：面板契约 + 服务端域守卫钉子。
 *
 * 缺陷背景：favorites 域此前只能靠全局 write 令牌写。给浏览器扩展「收藏当前页」
 * 发一枚令牌，就等于把历史、资料、设置、金库与账号注销/数据清理全部交出去——
 * 最小权限原则在用户域写面上完全失效。
 *
 * 本文件锁两层：
 *   1. UI：面板只提供 read / favorites / write 三档，默认只读，载荷传 permission，
 *      列表按 scopes 反推档位（历史 read,write 令牌仍显示「完整写入」）；
 *   2. 服务端：favorites 在 scope 词表里有一席（parseScopes / normalizeTokenScopes），
 *      但路由级 rank 与 read 同级（不得越权到实例级写），用户域守卫按域放行。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 读 overlay 源文件正文；镜像副本（apps/web/**）不会被误当成源 */
function overlayFile(rel: string): string {
  const p = resolve(HERE, '..', '..', 'web-overlay', rel)
  return readFileSync(p, 'utf8')
}

/** 服务端源码从两个根都能走到仓库根（apps/web-overlay/test 与 apps/web/test 深度相同） */
function apiSource(rel: string): string {
  return readFileSync(resolve(HERE, '..', '..', '..', rel), 'utf8')
}

const panel = overlayFile('src/components/user-center/api-tokens-panel.tsx')
const shared = apiSource('apps/api/src/routes/shared.ts')
const favorites = apiSource('apps/api/src/routes/favorites.ts')
const me = apiSource('apps/api/src/routes/me.ts')
const tokensRoute = apiSource('apps/api/src/routes/tokens.ts')
const auth = apiSource('apps/api/src/auth.ts')
const dialect = apiSource('packages/store/src/repository/dialect.ts')

describe('面板：三档权限是唯一入口', () => {
  it('档位词表只有 read / favorites / write，且默认只读', () => {
    expect(panel).toContain("type TokenPermission = 'read' | 'favorites' | 'write'")
    expect(panel).toContain("useState<TokenPermission>('read')")
  })

  it('创建载荷传 permission，不再用旧的 write:true 布尔开关', () => {
    expect(panel).toContain('body: JSON.stringify({ name: trimmed, permission })')
    expect(panel).not.toContain('write: true')
    expect(panel).not.toContain('writeAllowed')
    expect(panel).not.toContain('允许写入')
  })

  it('选择器可访问名与三档选项齐全', () => {
    expect(panel).toContain('aria-label="令牌权限"')
    expect(panel).toContain('<option value="read">')
    expect(panel).toContain('<option value="favorites">')
    expect(panel).toContain('<option value="write">')
  })

  it('档位提示解释各自边界（favorites 只放开收藏域）', () => {
    expect(panel).toContain('只读：读取收藏、历史、画像与金库')
    expect(panel).toContain('收藏写入：额外允许收藏增删改')
    expect(panel).toContain('完整写入：额外允许历史、资料、设置、金库与清理/注销等全部用户域写')
  })

  it('列表按 scopes 反推档位，历史 read,write 令牌不降级显示', () => {
    const start = panel.indexOf('function scopeLabel')
    expect(start).toBeGreaterThan(-1)
    const body = panel.slice(start, panel.indexOf('\n}', start))
    expect(body).toContain("scopes.includes('write') || scopes.includes('admin')")
    expect(body).toContain('完整写入')
    expect(body).toContain("scopes.includes('favorites')")
    expect(body).toContain('收藏写入')
    expect(body).toContain('只读')
    // 列表行用 scopeLabel(t.scopes)，不再直接拼 scopes.join
    expect(panel).toContain('{scopeLabel(t.scopes)}')
  })
})

describe('服务端：favorites 进词表但不进路由门槛', () => {
  it('auth.ts 三处词表都认 favorites', () => {
    expect(auth).toContain('export type ApiScope = "read" | "favorites" | "write" | "admin"')
    expect(auth).toContain('if (s === "read" || s === "favorites"')
  })

  it('favorites 与 read 同级（rank=1），write/admin 档次不变', () => {
    expect(auth).toContain('const rank: Record<ApiScope, number> = { read: 1, favorites: 1, write: 2, admin: 3 }')
  })

  it('store 归一化白名单含 favorites', () => {
    expect(dialect).toContain('new Set(["read", "favorites", "write", "admin"])')
  })

  it('令牌创建错误提示列全四档', () => {
    expect(tokensRoute).toContain('（read / favorites / write / admin）')
    expect(tokensRoute.match(/（read \/ favorites \/ write \/ admin）/g)?.length).toBe(2)
  })
})

describe('服务端：用户域写守卫按域放行', () => {
  it('shared.ts 的域参数默认 write，favorites 只在收藏域成立', () => {
    expect(shared).toContain('export type UserDomainWriteScope = "favorites" | "write"')
    expect(shared).toContain('domain: UserDomainWriteScope = "write"')
    expect(shared).toContain('return domain === "favorites" && scopes.includes("favorites")')
  })

  it('favorites.ts 七处写入口都声明 favorites 域', () => {
    const sites = favorites.match(/userDomainWriteAllowed\(req as never, "favorites"\)/g) ?? []
    expect(sites.length).toBe(7)
    expect(favorites).not.toContain('userDomainWriteAllowed(req as never)')
  })

  it('me.ts 钩子按路径选域：favorites/sync 走 favorites，其余写面走 write', () => {
    expect(me).toContain('const path = (req.url ?? "").split("?")[0]')
    expect(me).toContain('const domain = path === "/api/me/favorites/sync" ? "favorites" : "write"')
    expect(me).toContain('userDomainWriteAllowed(req as never, domain)')
    // 仅持 favorites 的令牌打其它写面要有专门文案，不能笼统说「只读」
    expect(me).toContain('当前令牌仅可写收藏，无法执行该操作')
  })

  it('令牌创建把 permission 映射成 scopes，且覆盖旧 write 布尔', () => {
    expect(me).toContain('permission: z.enum(["read", "favorites", "write"]).optional()')
    expect(me).toContain('permission === "write" ? "read,write" : permission === "favorites" ? "read,favorites" : "read"')
    expect(me).toContain('body.data.permission ?? (body.data.write ? "write" : "read")')
  })
})
