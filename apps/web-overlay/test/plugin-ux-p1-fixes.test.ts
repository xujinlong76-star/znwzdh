/**
 * 插件体验研究 P1 缺陷修复守卫（2026-11-17 UX 研究线发现，行级根因已定位）。
 *
 * 守两件事：
 * 1. P1-1 作者回复永远显示失败：服务端回 {success:true, review}，客户端旧判
 *    res.ok 恒为 undefined，永远走失败分支。守卫：sendAuthorReply 判 res.success，
 *    replyPluginReview 返回类型为 {success:boolean}（服务端契约另由
 *    apps/api/test/plugins-api.test.ts 钉死 replyBody.success === true）。
 * 2. P1-2 待审新版本在管理台无审批入口：审查按钮组只在 status==='pending' 时
 *    渲染，已上架插件纵有 pendingVersion 也无入口。守卫：已上架 + pendingVersion
 *    时单独渲染版本审查区（审查差异 / 通过新版本 / 驳回新版本），审查比对与
 *    弹窗展示的都是 pendingManifest（不是线上正在跑的 manifest），
 *    批准/驳回的文案与焦点目标区分“新版本”与“首次上架”。
 *
 * 证伪方法（R7）：对修复前基底（70c9b483）本文件应全红——P1-1 在第一轮真机
 * 复现（红 toast 目击）+ 第二轮 curl/DB/源码复核确认；P1-2 在管理台截图 +
 * curl 批准复核确认（服务端分支本就支持，缺口纯在 UI）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('P1-1 作者回复按服务端契约判 success，不再判 res.ok', () => {
  const section = read('src/components/plugins/plugin-review-section.tsx')
  const api = read('src/lib/navhub-api.ts')

  it('sendAuthorReply 成功分支判 res.success', () => {
    const start = section.indexOf('const sendAuthorReply')
    expect(start).toBeGreaterThan(-1)
    const block = section.slice(start, section.indexOf('const handleSendAuthorReply', start))
    expect(block).toContain('if (res.success)')
    // 只禁代码判式 if (res.ok)：注释里解释旧错时提到 res.ok 是允许的。
    expect(block).not.toMatch(/if\s*\(\s*res\.ok\s*\)/)
    expect(block).toContain("toast.success('作者回复已发布')")
  })

  it('replyPluginReview 返回类型与服务端回体一致（success，不是 ok）', () => {
    const start = api.indexOf('export async function replyPluginReview')
    expect(start).toBeGreaterThan(-1)
    const block = api.slice(start, start + 900)
    expect(block).toContain('Promise<{ success: boolean; review: HubPluginReviewItem }>')
    expect(block).not.toContain('{ ok: boolean')
    expect(block).toContain("sendJson<{ success: boolean; review: HubPluginReviewItem }>")
  })

  it('服务端回复路由回 {success:true, review}（契约锚点，与 API 测试一致）', () => {
    const route = readFileSync(
      resolve(ROOT, '..', 'api', 'src', 'routes', 'plugins', 'p3-versions-and-reviews.ts'),
      'utf8',
    )
    const start = route.indexOf('/reviews/:id/reply')
    expect(start).toBeGreaterThan(-1)
    const block = route.slice(start, start + 2500)
    expect(block).toContain('return { success: true, review }')
  })
})

describe('P1-2 待审新版本在管理台有审批入口', () => {
  const page = read('src/app/admin/plugins/page.tsx')

  it('已上架 + pendingVersion 时单独渲染版本审查区（三按钮齐全）', () => {
    const start = page.indexOf("item.status === 'published' && item.pendingVersion")
    expect(start).toBeGreaterThan(-1)
    const block = page.slice(start, start + 3500)
    expect(block).toContain('审查差异')
    expect(block).toContain('驳回新版本')
    expect(block).toContain('通过新版本')
    expect(block).toContain('handleOpenAudit(item)')
    expect(block).toContain('handleApprove(item)')
    expect(block).toContain('setRejectModalOpen(true)')
  })

  it('批准文案区分新版本升级与首次上架', () => {
    const start = page.indexOf('const handleApprove')
    expect(start).toBeGreaterThan(-1)
    const block = page.slice(start, start + 1800)
    expect(block).toContain('isVersionApprove')
    expect(block).toContain('新版本 v${plugin.pendingVersion}')
    expect(block).toContain('已升级')
  })

  it('审查比对目标是 pendingManifest，不是线上 manifest', () => {
    const start = page.indexOf('const handleOpenAudit')
    expect(start).toBeGreaterThan(-1)
    const block = page.slice(start, start + 1800)
    expect(block).toContain('item.pendingManifest ?? item.manifest')
  })

  it('审查弹窗展示待审清单（标题/版本号/JSON 均走 pendingManifest）', () => {
    expect(page).toContain('const auditManifest = auditPluginItem ? (auditPluginItem.pendingManifest ?? auditPluginItem.manifest) : null')
    expect(page).toContain('JSON.stringify(auditManifest, null, 2)')
    expect(page).toContain("审查{auditPluginItem?.pendingVersion ? '待审新版本' : '待上架插件'}")
    expect(page).toContain('v{auditPluginItem?.pendingVersion ?? auditPluginItem?.version}')
  })

  it('驳回弹窗与驳回成功提示区分新版本驳回（线上版本不受影响）', () => {
    expect(page).toContain('驳回新版本 v${rejectPluginItem.pendingVersion}')
    expect(page).toContain('只驳回这个待审新版本，线上已上架的当前版本不受影响')
    expect(page).toContain('新版本 v${rejectPluginItem.pendingVersion} 已驳回')
  })
})
