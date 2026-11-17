import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * P2-1 开发者认证徽章落 UI。
 *
 * 背景：authorVerified?: boolean 字段已存在（navhub-api.ts 的 HubPluginItem），
 * 全仓除类型定义外 UI 零引用；作者页只有哈希 ownerKey + 作品列表。
 *
 * 断言风格沿用本仓既有守卫（P1-6 plugin-star-recovery-hint.test.ts 的源码
 * 断言）：卡片与作者页不做 DOM 渲染（next/link、next/dynamic 需整套 mock），
 * 改为锁定渲染条件与文案——徽章只在 authorVerified 严格为 true 时出现。
 *
 * 本文件不使用 vi.mock，不写 process.env，不触发 mock-hygiene 守卫。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..')

function overlayRead(rel: string): string {
  return readFileSync(resolve(OVERLAY, rel), 'utf8')
}

const CARD = overlayRead('src/components/plugins/plugin-card.tsx')
const AUTHOR = overlayRead('src/app/marketplace/author/[key]/author-plugins-view.tsx')
const API = overlayRead('src/lib/navhub-api.ts')

describe('P2-1 开发者认证徽章', () => {
  it('字段来源：authorVerified 仍是 HubPluginItem 上的可选布尔字段', () => {
    expect(API).toContain('authorVerified?: boolean')
  })

  it('徽章本体：共享组件 AuthorVerifiedBadge，文案沿用详情页既有说法「认证作者」', () => {
    expect(CARD).toContain('export function AuthorVerifiedBadge')
    expect(CARD).toContain('data-testid="author-verified-badge"')
    expect(CARD).toContain('认证作者')
    // 徽章图标用已有的 ShieldCheck，不另引新图标
    expect(CARD).toContain('<ShieldCheck className="w-3 h-3" />')
  })

  it('认证规则写进代码注释：身份验证 + 无违规记录，对标 Established Publisher', () => {
    expect(CARD).toContain('Established Publisher')
    expect(CARD).toContain('身份验证')
    expect(CARD).toContain('无违规记录')
    // 诚实边界：字段由中枢/人工认证流程写入，站内无自助认证入口
    expect(CARD).toContain('中枢/人工认证流程')
    expect(CARD).toContain('无自助认证')
  })

  it('卡片：作者行展示作者名（有 ownerKey 链向作者页），徽章只在严格 true 时出现', () => {
    // 卡片此前不展示作者，徽章无处可挂——作者行是徽章的锚点
    expect(CARD).toContain('作者：')
    expect(CARD).toContain('href={`/marketplace/author/${encodeURIComponent(plugin.ownerKey)}`}')
    expect(CARD).toContain('{plugin.authorVerified === true && <AuthorVerifiedBadge />}')
    // 未认证/字段缺失不占位：徽章只在这一处条件渲染，没有无条件渲染
    const badgeUses = CARD.split('<AuthorVerifiedBadge />').length - 1
    expect(badgeUses).toBe(1)
  })

  it('作者页：认证态从作品列表派生（响应体无该字段），已认证才在作者名旁显徽章', () => {
    expect(AUTHOR).toContain('items.some((item) => item.authorVerified === true)')
    expect(AUTHOR).toContain('import { PluginCard, AuthorVerifiedBadge }')
    expect(AUTHOR).toContain('{authorVerified && <AuthorVerifiedBadge />}')
    // 徽章挂在作者名同一行（h1 之后、统计区之前），不是页脚别处
    const nameRow = AUTHOR.indexOf('data.profile?.displayName || data.author')
    const badge = AUTHOR.indexOf('{authorVerified && <AuthorVerifiedBadge />}')
    const stats = AUTHOR.indexOf('data.stats.plugins} 个已上架插件')
    expect(nameRow).toBeGreaterThan(-1)
    expect(badge).toBeGreaterThan(nameRow)
    expect(stats).toBeGreaterThan(badge)
  })

  it('作者页：无作品时无法判定，不展示徽章（不猜、不补默认值）', () => {
    expect(AUTHOR).toContain('?? false')
    expect(AUTHOR).toContain('尚无已上架作品时无法判定')
  })

  it('未认证不显示：两处徽章都在条件分支内，没有裸露的无条件渲染', () => {
    expect(CARD).not.toMatch(/^\s*<AuthorVerifiedBadge \/>\s*$/m)
    expect(AUTHOR).not.toMatch(/^\s*<AuthorVerifiedBadge \/>\s*$/m)
  })
})
