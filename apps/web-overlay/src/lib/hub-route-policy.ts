import { HUB_ROUTES, type HubRouteEntry } from './hub-route-policy.generated'

/**
 * `/api/hub/*` 网关的能力判决。
 *
 * 存在的理由：中枢在「开放模式」下把匿名当成全量 scope（`auth.ts` 的历史默认，
 * 个人/NAS 部署零配置可用），于是 web 的代理隧道成了匿名触达管理面的入口。
 * 实测匿名可经此下载全站备份、读 Token 名册、执行 VACUUM 与批量写入。
 *
 * 判决数据来自枢纽自己的 `config.scope` 声明（脚本生成，`--check` 防过期）：
 *   public → 放行；read/write/admin → 要求管理员会话。
 * 未在清单里的路径一律拒绝——新增接口必须先跑生成脚本，默认不会「静默公开」。
 *
 * 为什么 read 也要求管理员：枢纽把管理面只读（审计 / 任务 / 存储 / 站点列表）
 * 统一标成 read；面向公众的读接口都是 public。把 read 当「登录即可」会泄露审计面。
 */

export type HubAccess = 'public' | 'admin' | 'deny'

export interface HubPolicyDecision {
  access: HubAccess
  /** 命中的枢纽路由（未命中为 null） */
  route: HubRouteEntry | null
  reason: string
}

interface CompiledRoute extends HubRouteEntry {
  re: RegExp
}

function compilePath(path: string): RegExp {
  const segments = path.split('/').map((seg) => {
    if (seg.startsWith(':')) return '[^/]+'
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return new RegExp('^' + segments.join('/') + '$')
}

const COMPILED: readonly CompiledRoute[] = HUB_ROUTES.map((r) => ({ ...r, re: compilePath(r.path) }))

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * @param path 代理已剥离 `/api/hub` 前缀后的路径段（如 ['admin','audit']）
 */
export function decideHubRequest(path: readonly string[], method: string): HubPolicyDecision {
  const upper = method.toUpperCase()
  const full = '/api/' + path.join('/')

  // 字面量路由优先于参数路由：`/api/plugins/taps`（admin）必须压过
  // `/api/plugins/:slug`（public），否则同名 slug 会把管理面读接口放成匿名。
  const literal = COMPILED.find((r) => r.method === upper && r.path === full)
  if (literal) return fromRoute(literal)

  // 同路径不同方法可能有不同 scope：再找方法精确命中（参数化路径）
  const exact = COMPILED.find((r) => r.method === upper && r.re.test(full))
  if (exact) return fromRoute(exact)

  // 方法不命中但路径存在：按该路径上最严格的声明处理（默认拒绝，避免方法穿越）
  const samePath = COMPILED.filter((r) => r.re.test(full))
  if (samePath.length > 0) {
    const strictest = samePath.reduce((acc, r) => (rank(r.scope) > rank(acc.scope) ? r : acc))
    return {
      access: strictest.scope === 'public' ? (READ_METHODS.has(upper) ? 'public' : 'deny') : 'admin',
      route: strictest,
      reason: `方法未在枢纽注册（同路径按 ${strictest.scope} 处理）`,
    }
  }

  return { access: 'deny', route: null, reason: `未在枢纽路由清单中（${upper} ${full}），请运行 node scripts/gen-hub-route-policy.mjs` }
}

const SCOPE_RANK: Record<string, number> = { public: 0, read: 1, write: 2, admin: 3 }
function rank(scope: string): number {
  return SCOPE_RANK[scope] ?? 99
}

function fromRoute(route: CompiledRoute): HubPolicyDecision {
  if (route.scope === 'public') {
    return { access: 'public', route, reason: '枢纽声明为 public' }
  }
  return { access: 'admin', route, reason: `枢纽声明为 ${route.scope}，需要管理员会话` }
}
