import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * U-401：/me/data「行为事件与画像」清理文案与服务端删除范围一致。
 *
 * 历史缺陷：文案称「清除近 180 天点击/浏览遥测与画像标签」，服务端
 * `POST /api/me/prune` 的 events_profile 分支却是无日期过滤的全删——
 * `DELETE FROM events WHERE identity = ?` + `DELETE FROM user_profiles
 * WHERE user_id = ?`（整行画像删除）。「近 180 天」全仓唯一出处即该文案，
 * 无任何 180 天过滤与之对应；180 应是与 historyRetentionDays 默认 180 天
 * 混淆。William 2026-11-22 点选默认修法：改文案（不改服务端为只删 180 天内）。
 *
 * 为什么用源码守卫 + API 行为测试双钉：
 *  - 文案守卫（本文件）：vitest 跑 node 环境，无法渲染依赖 next-auth 会话的
 *    页面；同页既有守卫（me-data-delete-confirm.test.ts）也是这个写法。
 *    文案一旦改回「180 天」，或服务端分支悄悄加了日期过滤，守卫变红。
 *  - 行为测试（apps/api/test/me-data-api.test.ts 的 U-401 用例）：往库里插
 *    一条 200 天前的旧事件再调 prune，断言旧事件也被删——钉住「全删」语义。
 *    若服务端改成只删 180 天内，旧事件残留，行为测试变红。
 */
const WEB = resolve(__dirname, '..')
const REPO = resolve(__dirname, '../../..')
const readWeb = (p: string) => readFileSync(resolve(WEB, p), 'utf8')
const readRepo = (p: string) => readFileSync(resolve(REPO, p), 'utf8')

/** 服务端 prune 的 events_profile 分支全文（从分支头切到下一分支头）。 */
function eventsProfileBranch(src: string): string {
  const start = src.indexOf('domain === "events_profile"')
  const end = src.indexOf('} else if (domain === "vault")', start)
  if (start < 0 || end < 0) throw new Error('events_profile 分支未找到')
  return src.slice(start, end)
}

/** 页面 PRUNE_OPTIONS 里 events_profile 一项的 description。 */
function eventsProfileDescription(src: string): string {
  const start = src.indexOf("id: 'events_profile'")
  const end = src.indexOf('},', start)
  if (start < 0 || end < 0) throw new Error('events_profile 文案未找到')
  return src.slice(start, end)
}

describe('U-401：/me/data「行为事件与画像」文案不再谎称只清近 180 天', () => {
  it('文案不再出现「180 天」：服务端是全删，不是只删 180 天内', () => {
    const page = readWeb('src/app/me/data/page.tsx')
    expect(page).not.toContain('近 180 天')
    expect(page).not.toContain('180 天')
    expect(page).not.toContain('180天')
  })

  it('文案写明全部范围：清除全部遥测与画像（不限时间）', () => {
    const page = readWeb('src/app/me/data/page.tsx')
    const desc = eventsProfileDescription(page)
    expect(desc).toContain('清除全部点击/浏览遥测与画像（不限时间），搜索恢复默认排序')
    expect(desc).toContain('全部')
    expect(desc).toContain('不限时间')
  })

  it('服务端 events_profile 分支确实全删：两条 DELETE 均无日期过滤', () => {
    const me = readRepo('apps/api/src/routes/me.ts')
    const branch = eventsProfileBranch(me)
    expect(branch).toContain('DELETE FROM events WHERE identity = ?')
    expect(branch).toContain('DELETE FROM user_profiles WHERE user_id = ?')
    // 任一日期过滤出现都意味着文案（不限时间）与实现脱节，守卫必须变红。
    expect(branch).not.toContain('created_at')
    expect(branch).not.toContain('180')
    expect(branch).not.toContain('INTERVAL')
    expect(branch).not.toContain('Date.now')
    expect(branch).not.toContain('cutoff')
    expect(branch).not.toContain('since')
  })

  it('同一页其余清理域文案口径未被顺带改坏：搜索历史仍写“全部”', () => {
    const page = readWeb('src/app/me/data/page.tsx')
    expect(page).toContain('清除全部云端搜索词记录，保留收藏夹与个人设置')
  })
})
