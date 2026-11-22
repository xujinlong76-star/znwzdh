import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEVEL_UNLOCK_HINTS, LEVELS, levelUnlockHint } from '../src/lib/growth'
import { TASK_ACTIONS } from '../src/components/growth/task-actions'

const HERE = dirname(fileURLToPath(import.meta.url))
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay') && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录')
  return hit
}
const read = (rel: string) => readFileSync(join(overlayRoot(), rel), 'utf8')

describe('/me/growth UX 全面重构守卫（任务一～任务五）', () => {
  it('任务一：顶栏在 /me/growth 隐藏激活态红点，且 768–1280px 紧凑排版防截断', () => {
    const nav = read('src/components/user-center/user-center-nav.tsx')
    expect(nav).toContain("const isGrowthPage = pathname === '/me/growth' || pathname.startsWith('/me/growth/')")
    expect(nav).toContain("const showGrowthDot = item.href === '/me/growth' && growthAlert && !isGrowthPage")
    expect(nav).toContain('activeEl.scrollIntoView')
    expect(nav).toContain('px-2 py-1.5 text-xs font-medium transition-all duration-200 md:px-2.5 lg:px-3')

    const cat = read('public/xiaomaomao/xiaomaomao.js')
    expect(cat).toContain('#xiaomaomao.xm-me-safe')
    expect(cat).toContain('syncMeRouteSafeAnchor')
  })

  it('任务二：LEVEL_UNLOCK_HINTS 覆盖 Lv.2–Lv.16，首屏注入升级回报钩子 + 12 栏热力图与里程碑预告卡', () => {
    for (const def of LEVELS) {
      if (def.level >= 2) {
        const hint = levelUnlockHint(def.level)
        expect(hint, `Lv.${def.level} 缺少升级权益配置`).not.toBeNull()
        expect(hint!.summary.length).toBeGreaterThan(4)
        expect(hint!.perks.length).toBeGreaterThanOrEqual(1)
      }
    }
    expect(LEVEL_UNLOCK_HINTS[2]?.summary).toContain('小猫配饰槽位')

    const panel = read('src/components/user-center/growth-panel.tsx')
    expect(panel).toContain('levelUnlockHint(lp.nextLevel)')
    expect(panel).toContain('lg:grid-cols-12')
    expect(panel).toContain('lg:col-span-7')
    expect(panel).toContain('lg:col-span-5')
    expect(panel).toContain('data-next-milestone-card="true"')

    // 确认二级 Tab 位于顶部档案卡外侧
    const cardClose = panel.indexOf('</section>', panel.indexOf('data-growth-profile-card="true"'))
    const segCtrl = panel.indexOf('data-growth-segmented-control="true"')
    expect(segCtrl).toBeGreaterThan(cardClose)

    const heatmap = read('src/components/growth/growth-heatmap.tsx')
    expect(heatmap).toContain('const isNewUser = activeDays < 7')
    expect(heatmap).toContain('近 4 周活跃日历')
    expect(heatmap).toContain('展开近 16 周')
    // 2026-11-21 移动端横滚：16 周格子需保可点尺寸，窄屏不再 w-full 压缩
    expect(heatmap).toContain('grid-flow-col grid-rows-7 gap-1')
    expect(heatmap).toContain('max-sm:min-w-[340px]')
  })

  it('任务三 & 任务四：Primary CTA 层级、动态置顶新手一周与 4 处黑盒指标无障碍 Tooltip', () => {
    const panel = read('src/components/user-center/growth-panel.tsx')
    expect(panel).toContain('当前倍率计算与连登提倍阶梯说明')
    expect(panel).toContain('冻结卡作用与获取途径说明')
    expect(panel).toContain('专注浏览经验换算规则')

    const tasks = read('src/components/growth/growth-tasks.tsx')
    expect(tasks).toContain('满格一天 120 经验凑单路径说明')
    expect(tasks).toContain('firstPendingDailyId')
    expect(tasks).toContain('data-task-cta={variant}')
    expect(tasks).toContain('data-chest-ready={daily.chestAvailable')
    expect(tasks).toContain('const pinRookieTop = rookie.active && !rookieAllDone')
  })

  it('任务五：带语义上下文跨页跳转 + 首页微引导清理 URL + 跨页全清宝箱 Toast 原地开箱', () => {
    expect(TASK_ACTIONS['st-cat']?.href).toContain('from=growth_task&highlight=unvisited_category')
    expect(TASK_ACTIONS['core-search']?.href).toContain('from=growth_task&focus=search&hint=ai')
    expect(TASK_ACTIONS['sh-brief']?.href).toContain('/brief?from=growth_task')

    const home = read('src/components/navigation-content.tsx')
    expect(home).toContain("sp.get('from') === 'growth_task'")
    expect(home).toContain('window.history.replaceState')

    const tracker = read('src/components/growth/growth-tracker.tsx')
    expect(tracker).toContain('今日三件事已全清')
    expect(tracker).toContain('一键开宝箱')
    expect(tracker).toContain('openDailyChestLazy')
    expect(tracker).toContain('/me/growth?openChest=1')
  })
})
