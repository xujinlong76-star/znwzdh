import { describe, expect, it } from 'vitest'
import { HUB_ROUTES } from '../src/lib/hub-route-policy.generated'
import { decideHubRequest } from '../src/lib/hub-route-policy'

/** 把 :id 之类的参数换成样例值，得到一条「真实请求」路径 */
function concrete(path: string): string[] {
  return path
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? 'sample' : seg))
}

describe('hub-route-policy：以枢纽 scope 声明为准', () => {
  it('覆盖全部枢纽路由，且非 public 一律要求管理员（匿名不可达）', () => {
    expect(HUB_ROUTES.length).toBeGreaterThan(200)
    const leaks: string[] = []
    for (const route of HUB_ROUTES) {
      const decision = decideHubRequest(concrete(route.path), route.method)
      const expected = route.scope === 'public' ? 'public' : 'admin'
      if (decision.access !== expected) {
        leaks.push(`${route.method} ${route.path} scope=${route.scope} -> ${decision.access}`)
      }
    }
    expect(leaks).toEqual([])
  })

  it('匿名不得触达管理面（P0 攻击面的直接回归）', () => {
    const forbidden: Array<[string, string]> = [
      ['GET', 'admin/audit'],
      ['GET', 'tokens'],
      ['POST', 'tokens'],
      ['GET', 'backup/restore/status/1'],
      ['POST', 'backup/restore'],
      ['GET', 'storage'],
      ['PUT', 'storage'],
      ['DELETE', 'trash/1'],
      ['POST', 'jobs'],
      ['POST', 'admin/maintenance/vacuum'],
      ['POST', 'sites/bulk'],
      ['POST', 'categories'],
      ['PATCH', 'submissions/1'],
      ['POST', 'warmup'],
    ]
    for (const [method, path] of forbidden) {
      const decision = decideHubRequest(path.split('/'), method)
      expect(decision.access, `${method} ${path}`).toBe('admin')
    }
  })

  it('公开读与用户域写保持匿名可用（不误伤存量功能）', () => {
    const allowed: Array<[string, string]> = [
      ['GET', 'sites/sample'],
      ['GET', 'categories'],
      ['GET', 'tags'],
      ['GET', 'collections'],
      ['GET', 'facets'],
      ['GET', 'search'],
      ['GET', 'rank/new'],
      ['GET', 'plugins/search'],
      ['GET', 'favorites'],
      ['POST', 'favorites'],
      ['DELETE', 'favorites/sample'],
      ['DELETE', 'search-history'],
      ['POST', 'submissions'],
      ['POST', 'events'],
    ]
    for (const [method, path] of allowed) {
      const decision = decideHubRequest(path.split('/'), method)
      expect(decision.access, `${method} ${path}`).toBe('public')
    }
  })

  it('列表型读接口不向匿名开放（可能含待审/归档站点）', () => {
    // /api/sites 是枢纽的 read 面（管理列表），公开面走 BFF 的 /api/home 与 /site/[id]
    expect(decideHubRequest(['sites'], 'GET').access).toBe('admin')
    // 字面量管理路由必须压过同名参数路由
    expect(decideHubRequest(['plugins', 'taps'], 'GET').access).toBe('admin')
    expect(decideHubRequest(['plugins', 'taps', 'public'], 'GET').access).toBe('public')
  })

  it('同路径按方法区分：GET /api/sites/:id 公开，DELETE 需管理员', () => {
    expect(decideHubRequest(['sites', 'abc'], 'GET').access).toBe('public')
    expect(decideHubRequest(['sites', 'abc'], 'DELETE').access).toBe('admin')
  })

  it('清单外路径默认拒绝（新增接口必须先重新生成）', () => {
    expect(decideHubRequest(['not-a-real-endpoint'], 'GET').access).toBe('deny')
    expect(decideHubRequest(['not-a-real-endpoint'], 'POST').access).toBe('deny')
    expect(decideHubRequest(['admin', '..', 'sites'], 'GET').access).toBe('deny')
    expect(decideHubRequest([], 'GET').access).toBe('deny')
  })
})
