import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 插件详情页拆分守卫（第五批 A3.1）。
 *
 * plugin-detail-view.tsx（1817 行）拆成：壳（hero/动作/tab 栏 + 状态与处理器）+
 * detail-tab-panels（六个 tab 面板）+ detail-modals（安装/举报/徽章/审计/工作室五弹窗）。
 * 行为由 e2e/plugin-market.spec.ts 的 7 例全链路锁定（安装/时间轴/徽章/评价/试用/投稿），
 * 本守卫锁拆分结构本身：六个 tab 值、弹窗门控、壳瘦身下限。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRead(rel: string): string {
  const p = resolve(HERE, '..', '..', 'web-overlay', rel)
  if (!existsSync(p)) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(p, 'utf8')
}

const DIR = resolve(HERE, '..', '..', 'web-overlay', 'src', 'app', 'marketplace', '[slug]')

function combined(): string {
  const parts = [overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')]
  for (const f of ['detail-tab-panels.tsx', 'detail-modals.tsx']) {
    const p = resolve(DIR, f)
    if (existsSync(p)) parts.push(readFileSync(p, 'utf8'))
  }
  return parts.join('\n')
}

const TABS = ['preview', 'diff', 'impact', 'raw', 'history', 'reviews'] as const

describe('plugin-detail-view 拆分守卫', () => {
  it('六个详情 tab 的门控齐全（联合源）', () => {
    const src = combined()
    for (const tab of TABS) {
      expect(src, `tab ${tab}`).toContain(`activeTab === '${tab}'`)
    }
  })

  it('五个弹窗门控齐全（联合源）', () => {
    const src = combined()
    for (const gate of ['installModalOpen', 'reportModalOpen', 'badgeModalOpen', 'auditModalOpen', 'studioModalOpen']) {
      expect(src, gate).toContain(gate)
    }
  })

  it('壳瘦身下限（拆分完成后 < 1150 行）', () => {
    const shell = overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    if (!existsSync(resolve(DIR, 'detail-tab-panels.tsx'))) return
    expect(shell.split('\n').length).toBeLessThan(1150)
  })

  it('面板/弹窗组件导出形态与页面接线', () => {
    if (!existsSync(resolve(DIR, 'detail-tab-panels.tsx'))) return
    const panels = readFileSync(resolve(DIR, 'detail-tab-panels.tsx'), 'utf8')
    const modals = readFileSync(resolve(DIR, 'detail-modals.tsx'), 'utf8')
    expect(panels).toMatch(/export function DetailTabPanels/)
    expect(modals).toMatch(/export function DetailModals/)
    const shell = overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(shell).toContain('DetailTabPanels')
    expect(shell).toContain('DetailModals')
  })

  it('路由仍从本视图渲染', () => {
    const page = overlayRead('src/app/marketplace/[slug]/page.tsx')
    expect(page).toContain('PluginDetailView')
  })
})
