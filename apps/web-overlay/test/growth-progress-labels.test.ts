/**
 * U-376：同一份 XP，两根进度条口径打架。
 *
 * 复现（纯 main be8fb8c5）：口径只在 me-view.tsx:309-311 注释里自认，
 * 两处可见 UI 文案都没有口径标注——
 *  - 概览横幅（me-view.tsx GrowthBanner）：总经验/下一级门槛（总进度），
 *    进度条 aria-label 只写「距离下一级的总进度」，可见文案无「总进度」。
 *  - 成长面板（growth-panel.tsx）：本级进度（levelProgress.progress），
 *    进度条只有 aria-label="升级进度"，可见文案无「本级进度」。
 *
 * 修复：两处各加一行可见文案（「总进度」/「本级进度」），不改口径本身。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const ME_VIEW = overlaySource('src/app/me/me-view.tsx')
const GROWTH = overlaySource('src/components/user-center/growth-panel.tsx')

describe('U-376：概览横幅标明「总进度」', () => {
  it('GrowthBanner 有可见文案「总进度 {pct}%」（不是只藏在 aria-label 里）', () => {
    const start = ME_VIEW.indexOf('function GrowthBanner()')
    const body = ME_VIEW.slice(start, ME_VIEW.indexOf('export function MeView', start))
    // aria-label 里已有「总进度」字样（读屏器可见、肉眼不可见），不算；
    // 可见文案必须是渲染出的文本节点。
    expect(body).toContain('总进度 {progressPct}%')
  })

  it('总进度数字与文案同一口径（totalXp / nextXp）', () => {
    const start = ME_VIEW.indexOf('function GrowthBanner()')
    const body = ME_VIEW.slice(start, ME_VIEW.indexOf('export function MeView', start))
    expect(body).toContain('profile.totalXp / lp.nextXp')
    expect(body).toContain('总进度 {progressPct}%')
  })
})

describe('U-376：成长面板标明「本级进度」', () => {
  it('顶部升级进度条旁有可见文案「本级进度」', () => {
    // 顶栏进度条在 aria-label="本级进度" 附近：可见文案必须在同一区域，
    // 不能只改 aria-label（读屏器看得见、肉眼看不见等于没标）。
    const barAt = GROWTH.indexOf('aria-label="本级进度"')
    expect(barAt).toBeGreaterThan(0)
    const around = GROWTH.slice(Math.max(0, barAt - 600), barAt + 600)
    expect(around).toContain('本级进度')
  })

  it('本级进度数字用 levelProgress.progress（本级内口径），不用总进度', () => {
    expect(GROWTH).toContain('const lp = levelProgress(profile.totalXp)')
    expect(GROWTH).toContain('const progressPct = Math.round(lp.progress * 100)')
    expect(GROWTH).toContain('本级进度')
  })
})
