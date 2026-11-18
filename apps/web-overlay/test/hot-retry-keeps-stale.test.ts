import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /hot 重试失败不清空 SSR 旧榜（U-197）。
 *
 * 背景：重试 effect 用 Promise.all 六路并行重取，degrade() 把失败吞成
 * 空兜底，.then 原先无条件覆盖——在线首屏有榜时点重试、网络失败，
 * 三榜 + 时间戳一次被清空（「重试比不重试更糟」）。修法：每路独立
 * onDegraded 包装记失败标记，.then 里失败一路不覆盖旧榜，成功一路
 * 正常覆盖；recomputedAt 为 null 时不覆盖旧戳。
 *
 * 与 hot-recompute-stamp.test.ts 同风格：本仓库 vitest 是 node 环境，
 * 无 jsdom / @testing-library/react，钉住「接线都在、条件正确」，
 * 真实的断网重试行为由 Playwright e2e / 真机复核覆盖。
 */

const HOT_VIEW = join(import.meta.dirname, '..', 'src', 'app', 'hot', 'hot-view.tsx')
const NAVHUB_API = join(import.meta.dirname, '..', 'src', 'lib', 'navhub-api.ts')
const view = readFileSync(HOT_VIEW, 'utf8')
const api = readFileSync(NAVHUB_API, 'utf8')

// 只取重试 effect（首帧 SSR 分支 reloadToken === 0 时直接 return，不动）
const effect = view.slice(view.indexOf('if (reloadToken === 0) return'), view.indexOf('}, [reloadToken])'))

describe('/hot 重试失败保留旧榜（U-197）', () => {
  it('热度榜：失败一路不覆盖，setTrending 在 failed.trending 守卫块内', () => {
    expect(effect).toContain('if (!failed.trending)')
    expect(effect).toContain('setTrending(t.sites)')
    expect(effect.indexOf('if (!failed.trending)')).toBeLessThan(effect.indexOf('setTrending(t.sites)'))
    // 守卫块闭合在 setFresh 之前：setTrending 只在该块内出现一次
    expect(effect.split('setTrending(t.sites)').length - 1).toBe(1)
  })

  it('新品榜：失败一路不覆盖，setFresh 在 failed.fresh 守卫块内', () => {
    expect(effect).toContain('if (!failed.fresh)')
    expect(effect).toContain('setFresh(f)')
    expect(effect.indexOf('if (!failed.fresh)')).toBeLessThan(effect.indexOf('setFresh(f)'))
  })

  it('插件四组：逐组守门，失败组取 prev、成功组取新 items', () => {
    expect(effect).toContain('setPluginRankings((prev) =>')
    expect(effect).toContain('trending: failed.pt ? prev.trending : pt.items')
    expect(effect).toContain('popular: failed.pp ? prev.popular : pp.items')
    expect(effect).toContain('rating: failed.pr ? prev.rating : pr.items')
    expect(effect).toContain('fresh: failed.pf ? prev.fresh : pf.items')
  })

  it('时间戳：recomputedAt 为 null 时不覆盖旧戳，且无裸写', () => {
    expect(effect).toContain('if (t.recomputedAt != null)')
    expect(effect).toContain('setRecomputedAt(t.recomputedAt)')
    expect(effect.indexOf('if (t.recomputedAt != null)')).toBeLessThan(
      effect.indexOf('setRecomputedAt(t.recomputedAt)'),
    )
    // 全文件只此一处写时间戳，且在 null 守卫内——不存在无守卫的直写
    expect(view.split('setRecomputedAt(t.recomputedAt)').length - 1).toBe(1)
  })

  it('失败标记来源：每路取数配独立回调；API 层空兜底未动', () => {
    expect(effect).toContain("markFailed('trending')")
    expect(effect).toContain("markFailed('fresh')")
    expect(effect).toContain("markFailed('pt')")
    expect(effect).toContain("markFailed('pp')")
    expect(effect).toContain("markFailed('pr')")
    expect(effect).toContain("markFailed('pf')")
    // 防有人为修此 bug 改动 API 层兜底：失败仍静默返回空，由 hot-view 侧标记区分
    expect(api).toContain('{ sites: [], recomputedAt: null }')
    expect(api).toContain('{ items: [], total: 0')
  })
})
