// Bundle 瘦身 Step 3：成长模块（lib/growth.ts）按需加载——本地 growth-lazy 门面版。
//
// 背景：lib/growth.ts（约 101KB）是成长引擎全套结算，经根 layout 的 GrowthTracker 与
// HomepageBanner 静态 import 进全部路由首屏。本地方案（Step 3）不走 effect 内动态
// import，改立一座零值 import 门面 lib/growth-lazy.ts：
//  - 常量与纯函数（日期 key、连胜、赛季历法、空档案）从 growth.ts 逐字搬入，growth.ts
//    改为 re-export，单一来源不变；
//  - loadGrowthProfile() 同步轻读（v2 全量档案直接 JSON.parse 返回，后台完整加载补跑
//    结算，完成后发 GROWTH_UPDATED_EVENT 触发刷新）；
//  - 记账类动作（recordGrowthEvent 等）由门面动态 import 引擎后 fire-and-forget，
//    调用方只改 import 路径、不改调用时序。
// 因此首屏只含门面（常量 + 轻读 + 动态 import 入口），不含引擎本体；/ 实测 -37,341 B。
//
// 锁死点（与远程 5ccb063 的 effect 内动态 import 方案不同，合流时走本地门面版，
// 远程 growth-lazy-guard.test.ts 按本地机制重写）：
//  - growth-tracker 只从 @/lib/growth-lazy 静态 import 7 个名字，绝不静态 import @/lib/growth；
//    记账调用仍是同步 bare call（门面内部动态 import），tracker 本身没有 import('@/lib/growth')。
//  - 事件名 AI_CHAT_USED_EVENT 从门面静态 import，监听同步注册、同步摘除，不等 chunk。
//  - homepage-banner 只从 @/lib/growth-lazy 静态 import 两个常量 + loadGrowthProfile；
//    effect 同步轻读，无需 cancelled 守卫（无异步）。
//  - 门面本身零值 import @/lib/growth（只 import type），动态 import 只出现在 withGrowth / kickFullLoad。
//  - footer 不动：只 import HOMEPAGE_CLAIM_XP 常量，不 import growth 函数。
//  - growth.ts 本身：记账函数仍 export function；常量改为从 ./growth-lazy re-export。
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
const LAZY = 'src/lib/growth-lazy.ts'

/** 静态值 import 形如 `... from '@/lib/growth'`；动态 import() 无 from，不命中。 */
const STATIC_GROWTH_IMPORT = /import(?!\s+type)\b[^'";]*from\s*['"]@\/lib\/growth['"]/

describe('成长模块按需加载（Bundle 瘦身 Step 3：growth-lazy 门面）', () => {
  it('growth-tracker 只从门面静态引入 7 个名字，绝不静态引入 lib/growth', () => {
    const src = read(TRACKER)
    expect(src).not.toMatch(STATIC_GROWTH_IMPORT)
    expect(src).not.toContain("from '@/lib/growth'")
    expect(src).toContain("from '@/lib/growth-lazy'")
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
    // 记账调用仍是同步 bare call：动态 import 藏在门面内部，tracker 本身不写
    // import('@/lib/growth')，调用时序与瘦身前一致。
    expect(src).not.toContain("import('@/lib/growth')")
    expect(src).toContain('recordDailyVisitOnce()')
    expect(src).toContain("recordGrowthEvent('ai_chat')")
  })

  it('growth-tracker 监听 AI_CHAT_USED_EVENT 同步注册、同步摘除', () => {
    const src = read(TRACKER)
    expect(src).toContain('addEventListener(AI_CHAT_USED_EVENT, onWidgetChat)')
    expect(src).toContain('removeEventListener(AI_CHAT_USED_EVENT, onWidgetChat)')
    // 事件名从门面 import，不用硬编码字符串顶替常量。
    expect(src).not.toContain("'navhub:ai-chat-used'")
    expect(src).toContain('return null')
  })

  it('growth-lazy 门面零值 import 引擎，动态 import 只在内部', () => {
    const src = read(LAZY)
    // 门面只 import type + growth-season 常量，绝不静态 import 引擎本体；
    // '@/lib/growth' 只出现在动态 import() 里（withGrowth / kickFullLoad）。
    expect(src).not.toMatch(STATIC_GROWTH_IMPORT)
    expect(src).not.toContain("from '@/lib/growth'")
    expect(src).toContain("import('@/lib/growth')")
    // 常量住在门面里（单一来源），growth.ts 只 re-export。
    expect(src).toContain("export const AI_CHAT_USED_EVENT = 'navhub:ai-chat-used'")
    expect(src).toContain('export const HOMEPAGE_CLAIM_XP = 100')
    expect(src).toContain('export const HOMEPAGE_BANNER_DISMISSED_KEY =')
    // 轻读与记账包装仍由门面导出。
    expect(src).toContain('export function loadGrowthProfile()')
    expect(src).toContain('export function recordDailyVisitOnce()')
    expect(src).toContain('export function recordGrowthEvent(')
  })

  it('homepage-banner 只从门面静态引入常量与 loadGrowthProfile', () => {
    const src = read(BANNER)
    expect(src).toMatch(
      /import\s*\{\s*HOMEPAGE_BANNER_DISMISSED_KEY,\s*HOMEPAGE_CLAIM_XP,\s*loadGrowthProfile\s*\}\s*from\s*['"]@\/lib\/growth-lazy['"]/,
    )
    expect(src).not.toContain("from '@/lib/growth'")
    expect(src).not.toContain("import('@/lib/growth')")
    // effect 同步轻读：无异步、无需 cancelled 守卫。
    expect(src).toContain('loadGrowthProfile()')
    expect(src).toContain("pathname !== '/'")
    expect(src).toContain('homepageClaimedAt')
    expect(src).toContain('setVisible(true)')
    expect(src).toContain('{HOMEPAGE_CLAIM_XP}')
    expect(src).toContain('HOMEPAGE_BANNER_DISMISSED_KEY')
  })

  it('footer 不动：只 import HOMEPAGE_CLAIM_XP 常量，不 import growth 函数', () => {
    const src = read(FOOTER)
    expect(src).toContain("import { HOMEPAGE_CLAIM_XP } from '@/lib/growth-constants'")
    expect(src).not.toContain('loadGrowthProfile')
    expect(src).not.toContain('recordGrowthEvent')
  })

  it('growth.ts 本身：记账函数仍 export function，常量改为 re-export', () => {
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
    // 常量已搬入门面：growth.ts 只从 ./growth-lazy import 后 re-export，
    // 不再有 `export const X =` 定义。
    expect(src).toContain("} from './growth-lazy'")
    expect(src).toContain('export {')
    for (const name of ['HOMEPAGE_CLAIM_XP', 'HOMEPAGE_BANNER_DISMISSED_KEY', 'AI_CHAT_USED_EVENT']) {
      expect(src).toContain(name)
    }
    expect(src).not.toContain('export const HOMEPAGE_CLAIM_XP =')
    expect(src).not.toContain('export const AI_CHAT_USED_EVENT =')
  })
})
