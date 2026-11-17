import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * P1-6 星标 ≠ 收藏分叉守卫。
 *
 * 插件没有「收藏」只有「星标」，星标插件不在 /favorites——星标按钮旁必须
 * 写明找回入口，否则用户以为「星标丢了」。守卫锁三点：
 * 1. 详情页星标按钮旁有找回说明，点进 /marketplace?starred=1 星标列表；
 * 2. 卡片已星标时星标按钮旁同样有找回链接（未星标不占位）；
 * 3. 找回入口指向的 starred=1 确实被市场筛选解析（不是死链文案）。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..')

function overlayRead(rel: string): string {
  return readFileSync(resolve(OVERLAY, rel), 'utf8')
}

const DETAIL = overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')
const CARD = overlayRead('src/components/plugins/plugin-card.tsx')
const FILTERS = overlayRead('src/lib/plugins/marketplace-filters.ts')

describe('P1-6 星标找回说明', () => {
  it('详情页：星标按钮旁有找回说明，链向星标列表', () => {
    expect(DETAIL).toContain('data-testid="star-recovery-hint"')
    expect(DETAIL).toContain('星标可在插件中心找回')
    expect(DETAIL).toContain('href="/marketplace?starred=1"')
    // 找回说明必须在星标按钮之后（按钮旁/下方），不是页脚别处随便挂一句
    const starButton = DETAIL.indexOf("aria-label={starred ? '取消星标'")
    const hint = DETAIL.indexOf('data-testid="star-recovery-hint"')
    expect(starButton).toBeGreaterThan(-1)
    expect(hint).toBeGreaterThan(starButton)
  })

  it('详情页：找回说明不指向 /favorites（星标不在收藏夹）', () => {
    const hintStart = DETAIL.indexOf('data-testid="star-recovery-hint"')
    const hintBlock = DETAIL.slice(hintStart, hintStart + 600)
    expect(hintBlock).not.toContain('/favorites')
    expect(hintBlock).toContain('/marketplace?starred=1')
  })

  it('卡片：已星标时星标按钮旁有找回链接，未星标不占位', () => {
    expect(CARD).toContain('data-testid="star-recovery-hint"')
    expect(CARD).toContain('插件中心可找回')
    expect(CARD).toContain('href="/marketplace?starred=1"')
    // 找回链接只在已星标时渲染
    expect(CARD).toContain('{starred && (')
    const starButton = CARD.indexOf("aria-label={starred ? '取消星标'")
    const hint = CARD.indexOf('data-testid="star-recovery-hint"')
    expect(starButton).toBeGreaterThan(-1)
    expect(hint).toBeGreaterThan(starButton)
  })

  it('找回入口真实可用：starred=1 被市场筛选解析为星标态', () => {
    expect(FILTERS).toContain("rawStarred === '1'")
    expect(FILTERS).toContain('starred:')
  })
})
