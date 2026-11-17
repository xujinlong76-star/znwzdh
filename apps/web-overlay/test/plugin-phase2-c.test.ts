import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 插件市场 Phase 2 批 C 结构守卫（2026-11-17）：
 * 详情页 remix 传值 + 工坊静默反馈 + Taps 反馈/确认 + 复制反馈 + 沙箱样例按钮。
 *
 * 锁的是接线本身（state 是否保留、prop 是否补传、失败分支是否存在），
 * 真机行为由批 C 探针锁定（remix 弹窗见 -remix 清单、ok:false 拦截见 toast、
 * Taps 400 见行内错误、删除两步确认、复制按钮文案同步变、样例按钮禁用）。
 * 断言只可按新行为改写并在此写明原因，绝不删除。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRead(rel: string): string {
  const p = resolve(HERE, '..', '..', 'web-overlay', rel)
  if (!existsSync(p)) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(p, 'utf8')
}

describe('Phase 2 批 C：详情页 remix 传值（U-23）', () => {
  it('remix 清单 state 值不再丢弃（以前只留 setter，值被丢弃）', () => {
    const view = overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(view).toContain('const [studioInitialManifest, setStudioInitialManifest]')
    expect(view).not.toContain('const [, setStudioInitialManifest]')
  })

  it('DetailModals 调用处补传 studioInitialManifest', () => {
    const view = overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(view).toContain('studioInitialManifest={studioInitialManifest}')
  })

  it('「AI 工坊升级」打开前先清掉 remix 清单（防 stale remix 泄漏进升级）', () => {
    const view = overlayRead('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(view).toContain('setStudioInitialManifest(undefined)')
  })

  it('接收端仍按 remix/升级区分 slug（未动接收逻辑）', () => {
    const modals = overlayRead('src/app/marketplace/[slug]/detail-modals.tsx')
    expect(modals).toContain('studioInitialManifest')
    expect(modals).toContain('initialManifest={studioInitialManifest || plugin.manifest}')
  })
})

describe('Phase 2 批 C：工坊预检/自动修复 ok:false 反馈', () => {
  it('预检 ok:false 有失败文案 + 重试入口（以前无 else、静默）', () => {
    const modal = overlayRead('src/components/plugins/ai-plugin-studio-modal.tsx')
    expect(modal).toContain('AI 预检未通过')
    expect(modal).toContain("action: { label: '重试', onClick: () => void handlePreAudit() }")
  })

  it('自动修复 ok:false 有失败文案 + 重试入口（以前无 else、静默）', () => {
    const modal = overlayRead('src/components/plugins/ai-plugin-studio-modal.tsx')
    expect(modal).toContain('自动修复未完成')
    expect(modal).toContain("action: { label: '重试', onClick: () => void handleAutoFix() }")
  })

  it('ok:false 原因取自响应体 error/message 字段，无则给通用文案', () => {
    const modal = overlayRead('src/components/plugins/ai-plugin-studio-modal.tsx')
    expect(modal).toContain('function failedResultReason')
  })
})

describe('Phase 2 批 C：工坊体检面板自动修复加载态', () => {
  it('修复中转圈 + 文案变（以前只有 disabled，文案/图标静态）', () => {
    const panel = overlayRead('src/components/plugins/studio-health-panel.tsx')
    expect(panel).toContain('智能优化中...')
    expect(panel).toContain('animate-spin')
  })
})

describe('Phase 2 批 C：工坊 JSON 复制反馈', () => {
  it('复制复用 use-copy-feedback，按钮文案同步变（以前返回值丢弃、全程静默）', () => {
    const panel = overlayRead('src/components/plugins/studio-json-panel.tsx')
    expect(panel).toContain('useCopyFeedback')
    expect(panel).toContain('jsonCopy.reportCopy(result)')
    expect(panel).toContain('已复制')
    expect(panel).toContain('复制失败')
  })
})

describe('Phase 2 批 C：Taps 添加/移除反馈', () => {
  it('添加失败进弹窗内持久行内错误（toast 约 4 秒就消失，弹窗内必须留痕）', () => {
    const modal = overlayRead('src/components/plugins/plugin-taps-modal.tsx')
    expect(modal).toContain('setAddError')
    expect(modal).toContain('role="alert"')
    expect(modal).toContain('添加失败：')
  })

  it('移除两步确认 + 删除中禁用（以前一点即删、无确认、可重复点）', () => {
    const modal = overlayRead('src/components/plugins/plugin-taps-modal.tsx')
    expect(modal).toContain('confirmDeleteId')
    expect(modal).toContain('确认移除')
    expect(modal).toContain('deletingId')
    expect(modal).toContain('移除中...')
  })
})

describe('Phase 2 批 C：沙箱样例按钮定性', () => {
  it('样例按钮禁用（定性为装饰性样例，以前无 onClick 也可点）', () => {
    const panel = overlayRead('src/components/plugins/studio-sandbox-panel.tsx')
    expect(panel).toContain('主题按钮样式预览（样例，不可点击）')
  })
})
