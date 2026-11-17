import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * P3-4（卡片部分）+ P3-6 接线守卫。
 *
 * P3-4：卡片此前不显示更新日期。卡片须展示「更新于某日」（取运行时
 * updatedAt，复用仓内已有日期 helper formatPackDate（与详情头统一 YYYY-MM-DD）；无效时不渲染、
 * 不编造日期）。详情头由另一 worker 做，本文件只钉卡片。
 *
 * P3-6：hover 时「已安装」→「管理 / 卸载」，触屏无 hover；点按直接以
 * uninstall 模式打开弹窗，触屏用户预期是查看/管理，先看到卸载确认容易
 * 误点。触屏点「已安装」须先进已安装管家（/marketplace/installed，复用
 * 现有管理页），不直接弹卸载确认；鼠标点按保持原样。
 *
 * 仓内无 @testing-library（vitest environment 为 node），无法做真实
 * React 点按渲染测试；因此分两层钉死：去向判定是纯函数，在
 * install-state.test.ts 里做行为断言（模拟触屏点按）；本文件钉卡片
 * 的接线——判定函数确实在 handleAction 里、且在开弹窗之前先分流到
 * 管理页。
 *
 * 纯字符串断言，不引业务模块、无 vi.mock，不触发 mock-hygiene 清理要求。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..')

function overlayRead(rel: string): string {
  return readFileSync(resolve(OVERLAY, rel), 'utf8')
}

const CARD = overlayRead('src/components/plugins/plugin-card.tsx')

/** 取 handleAction 函数体（从定义到下一个顶层函数），接线顺序断言只在体内做 */
function handleActionBody(): string {
  const start = CARD.indexOf('const handleAction')
  expect(start).toBeGreaterThan(-1)
  const end = CARD.indexOf('const handleShare', start)
  expect(end).toBeGreaterThan(start)
  return CARD.slice(start, end)
}

describe('P3-4 卡片展示更新日期', () => {
  it('卡片复用仓内已有日期 helper，不内联 toLocaleDateString', () => {
    expect(CARD).toContain("import { formatPackDate } from '@/lib/link-pack'")
    expect(CARD).toContain('formatPackDate(plugin.updatedAt)')
    expect(CARD).not.toContain('formatVerifiedDate')
    expect(CARD).not.toContain('new Date(plugin.updatedAt).toLocaleDateString')
    expect(CARD).not.toContain('plugin.updatedAt).toLocaleDateString')
  })

  it('卡片底部统计栏可见“更新于某日”，带 data-testid 供查验', () => {
    expect(CARD).toContain('data-testid="plugin-updated-at"')
    expect(CARD).toContain('更新于 {updatedAtLabel}')
  })

  it('更新日期无效 / 缺失时不渲染，不编造日期', () => {
    // 卡片先守卫 updatedAt 为有限数再调 formatPackDate（该 helper 本身不判空）；
    // 无效时 label 为 null，卡片须以 label 为真才渲染，而不是给默认值。
    expect(CARD).toContain('{updatedAtLabel && (')
    expect(CARD).not.toContain('更新于 刚刚')
    expect(CARD).not.toContain("updatedAtLabel ?? '")
  })

})

describe('P3-6 触屏点“已安装”先进管理页', () => {
  it('卡片接线：用仓内触屏判定 + 纯函数判定去向', () => {
    expect(CARD).toContain("import { isTouchDevice } from '@/lib/platform'")
    expect(CARD).toContain('shouldOpenManageOnInstalledTap')
    expect(CARD).toContain('shouldOpenManageOnInstalledTap(targetMode, isTouchDevice())')
  })

  it('触屏分流在开卸载确认弹窗之前，且去向是已安装管家（复用现有管理页）', () => {
    const body = handleActionBody()
    const touchBranch = body.indexOf('shouldOpenManageOnInstalledTap(targetMode, isTouchDevice())')
    const openModal = body.indexOf('onOpenInstallModal(plugin, targetMode)')
    expect(touchBranch).toBeGreaterThan(-1)
    expect(openModal).toBeGreaterThan(-1)
    expect(touchBranch).toBeLessThan(openModal)
    expect(body).toContain("router.push('/marketplace/installed')")
    // 触屏分支 return 后才走到弹窗：分流点之后、开弹窗之前必须有 return
    const between = body.slice(touchBranch, openModal)
    expect(between).toContain('return')
  })

  it('触屏去向是管理页，不是详情页（详情页的“已安装”按钮同样直通卸载确认）', () => {
    const body = handleActionBody()
    expect(body).not.toContain("router.push(`/marketplace/${encodeURIComponent(plugin.slug)}`)")
  })

  it('鼠标点按路径未动：非触屏仍走卸载确认弹窗', () => {
    const body = handleActionBody()
    expect(body).toContain('if (onOpenInstallModal) {')
    expect(body).toContain('onOpenInstallModal(plugin, targetMode)')
  })
})
