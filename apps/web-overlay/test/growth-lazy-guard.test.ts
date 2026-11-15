// Bundle 瘦身续刀：成长模块（lib/growth.ts）按需加载。
//
// 背景：lib/growth.ts（约 32KB）经根 layout 的 GrowthTracker 与
// HomepageBanner 静态 import 进全部路由首屏，/sites 因此超预算
// 28KB（CI 775KB，预算 747KB）。两者都只在 effect 里调用 growth
// 函数：改 effect 内动态 import（单例 promise，chunk 只拉一次），
// 首屏不再含 growth.ts。横幅在 /sites 恒为 null，/sites 行为零变化；
// 首页横幅晚一个 chunk 出现（与 CRDT 小药丸先渲染连接中态同款先例）。
//
// 锁死点：
//  - growth-tracker 不得静态 import lib/growth（只许 effect 内动态 import）。
//  - homepage-banner 不得静态 import loadGrowthProfile（只许 effect 内
//    动态 import）；渲染用的两个常量（HOMEPAGE_CLAIM_XP、
//    HOMEPAGE_BANNER_DISMISSED_KEY）改从零依赖的 @/lib/growth-constants
//    静态 import，不再经 @/lib/growth。
//    注意（第 75 轮改写原因）：旧断言称常量“只留约 1.6KB”，该数是 esbuild
//    探针值，已被 CI 实测证伪（第 72 轮拆函数 import 后 /sites 反增 3KB，
//    唯一剩下的静态边就是这两个常量 import）；常量定义已移出 growth.ts，
//    新行为是新模块静态 import + growth.ts re-export 保兼容，守卫强度不变。
//  - tracker 的 7 个 growth 引用（6 函数 + AI_CHAT_USED_EVENT 事件名）
//    一个不能少：事件名活在 growth.ts 里，监听须等 chunk 加载后注册。
//  - banner 的 effect 必须有 cancelled 守卫：pathname 从 `/` 切走后，
//    pending 的 promise 回来时不得再 setVisible(true)。
//  - footer 不动：只 import HOMEPAGE_CLAIM_XP 常量，不得 import growth 函数。
//    注意（第 75 轮改写原因）：常量来源改成 @/lib/growth-constants，
//    footer 的 import 目标随之改指新模块；“只 import 常量、不 import 函数”
//    的锁死点不变。
//  - growth.ts 本身只剩 re-export：两个首屏常量改由它从 ./growth-constants
//    re-export，函数与调用点原样。
//    注意（第 75 轮改写原因）：旧断言要求两个常量定义仍在 growth.ts 内，
//    新行为是定义搬进 growth-constants.ts、growth.ts 只留 re-export；
//    7 个函数仍为 `export function` 的锁死点不变。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const TRACKER = 'src/components/growth/growth-tracker.tsx'
const BANNER = 'src/components/growth/homepage-banner.tsx'
const FOOTER = 'src/components/footer.tsx'
const GROWTH = 'src/lib/growth.ts'

/** 静态值 import 形如 `... from '@/lib/growth'`；动态 import() 无 from，不命中。 */
const STATIC_GROWTH_IMPORT = /import(?!\s+type)\b[^'";]*from\s*['"]@\/lib\/growth['"]/

describe('成长模块按需加载（Bundle 瘦身续刀）', () => {
  it('growth-tracker 不静态引入 lib/growth，只走 effect 内动态 import', () => {
    const src = read(TRACKER)
    expect(src).not.toMatch(STATIC_GROWTH_IMPORT)
    expect(src).not.toContain("from '@/lib/growth'")
    expect(src).toContain("import('@/lib/growth')")
    // 单例 promise：chunk 只拉一次，多处调用共享同一份 import。
    expect(src).toContain('growthPromise ??= import(')
  })

  it('growth-tracker 的 7 个 growth 引用一个不能少', () => {
    const src = read(TRACKER)
    for (const name of [
      'recordDailyVisitOnce',
      'markMemberSeenAction',
      'claimPwaInstallAction',
      'recordIdleMinute',
      'recordGrowthEvent',
      'recordPageVisitAction',
      'AI_CHAT_USED_EVENT',
    ]) {
      expect(src).toContain(name)
    }
    // 事件名活在 growth.ts 里：监听须等 chunk 加载后注册，cleanup 用
    // 存下的事件名 + handler 解绑，不得用硬编码字符串顶替常量。
    expect(src).not.toContain("'navhub:ai-chat-used'")
    expect(src).toContain('window.addEventListener(eventName, onWidgetChat)')
    expect(src).toContain('window.removeEventListener(eventName, onWidgetChat)')
  })

  it('growth-tracker 仍不渲染任何可见 UI，记账仍是 best-effort', () => {
    const src = read(TRACKER)
    expect(src).toContain('return null')
    // chunk 拉取失败（如离线首访）时静默跳过本次记账，不抛未处理 rejection。
    // 注意（第 73 轮改写原因）：旧断言 `.catch(() => {})` 是裸空 catch，与
    // silent-catch 守卫的「0 处吞掉失败却没写理由」规则直接互斥，两测试不可
    // 能同时通过。新行为是 catch 块内必须带理由注释，断言按新行为改写：
    // 仍要求静默吞掉失败（块内无语句），但必须写明为什么可以吞；守卫强度不变。
    expect(src).toContain('.catch(() => { /*')
    expect(src).not.toContain('.catch(() => {})')
  })

  it('homepage-banner 不静态引入 loadGrowthProfile，只走 effect 内动态 import', () => {
    const src = read(BANNER)
    expect(src).not.toMatch(
      /import\s*\{[^}]*loadGrowthProfile[^}]*\}\s*from\s*['"]@\/lib\/growth['"]/,
    )
    expect(src).toContain("import('@/lib/growth')")
    expect(src).toContain('loadGrowthProfile()')
  })

  it('homepage-banner 渲染用的两个常量改从 growth-constants 静态 import，不再碰 growth.ts', () => {
    const src = read(BANNER)
    // 注意（第 75 轮改写原因）：旧断言要求精确匹配 `from '@/lib/growth'`；
    // 常量定义已移出 growth.ts，新行为是改指零依赖的 growth-constants，
    // 且 banner 内不得出现任何静态 `from '@/lib/growth'`。
    expect(src).toMatch(
      /import\s*\{\s*HOMEPAGE_BANNER_DISMISSED_KEY,\s*HOMEPAGE_CLAIM_XP\s*\}\s*from\s*['"]@\/lib\/growth-constants['"]/,
    )
    expect(src).not.toMatch(STATIC_GROWTH_IMPORT)
    expect(src).toContain('{HOMEPAGE_CLAIM_XP}')
    expect(src).toContain('HOMEPAGE_BANNER_DISMISSED_KEY')
  })

  it('homepage-banner 的 effect 有 cancelled 守卫，切走路由后不误显示', () => {
    const src = read(BANNER)
    expect(src).toContain('let cancelled = false')
    expect(src).toContain('if (cancelled) return')
    expect(src).toContain('cancelled = true')
    // 横幅仍只在首页出现、已领取不显示、可关闭。
    expect(src).toContain("pathname !== '/'")
    expect(src).toContain('homepageClaimedAt')
    expect(src).toContain('setVisible(true)')
  })

  it('footer 不动：只 import HOMEPAGE_CLAIM_XP 常量，不 import growth 函数', () => {
    const src = read(FOOTER)
    // 注意（第 75 轮改写原因）：旧断言要求精确字符串 `from '@/lib/growth'`；
    // 常量定义已移出 growth.ts，新行为是改指零依赖的 growth-constants，
    // 且 footer 内不得出现任何静态 `from '@/lib/growth'`。
    expect(src).toContain("import { HOMEPAGE_CLAIM_XP } from '@/lib/growth-constants'")
    expect(src).not.toMatch(STATIC_GROWTH_IMPORT)
    expect(src).not.toContain('loadGrowthProfile')
    expect(src).not.toContain('recordGrowthEvent')
  })

  it('growth.ts 只 re-export 两个首屏常量，函数仍从它导出', () => {
    const src = read(GROWTH)
    for (const name of [
      'recordDailyVisitOnce',
      'markMemberSeenAction',
      'claimPwaInstallAction',
      'recordIdleMinute',
      'recordGrowthEvent',
      'recordPageVisitAction',
      'loadGrowthProfile',
    ]) {
      expect(src).toContain(`export function ${name}`)
    }
    // 注意（第 75 轮改写原因）：旧断言要求两个常量仍以 `export const … =`
    // 定义在 growth.ts 内；新行为是定义搬进 growth-constants.ts，
    // growth.ts 只留 re-export——断言按新行为改写：两名必须仍能从 growth.ts
    // 导出（旧调用点零改动），定义本身不得再留在 growth.ts 内。
    expect(src).toContain("from './growth-constants'")
    expect(src).toContain('export { HOMEPAGE_BANNER_DISMISSED_KEY }')
    expect(src).toContain('export { HOMEPAGE_CLAIM_XP }')
    expect(src).not.toContain('export const HOMEPAGE_CLAIM_XP =')
    expect(src).not.toContain('export const HOMEPAGE_BANNER_DISMISSED_KEY =')
    expect(src).toContain('export const AI_CHAT_USED_EVENT =')
  })
})
