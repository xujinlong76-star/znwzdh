import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 插件详情首屏预算守卫。
 *
 * 版本差异面板只在用户展开某个版本后渲染，却曾以静态 import 进 /marketplace/[slug]
 * 的初始 chunk；加入相似插件的错误态后 CI 实测 1067 KB > 1065 KB（预算硬门禁）。
 * 这里钉住「差异面板按需加载」这一事实，避免有人改回静态引入把首屏再顶爆。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 详情页家族联合源（A3.1 拆分后守卫锁的是整个特性的源码意图，不单壳文件） */
function detailFamily(): string {
  const parts = [overlaySource('src/app/marketplace/[slug]/plugin-detail-view.tsx')]
  for (const extra of ['detail-tab-panels.tsx', 'detail-modals.tsx']) {
    try { parts.push(overlaySource(`src/app/marketplace/[slug]/${extra}`)) } catch { /* 拆分前文件不存在时忽略 */ }
  }
  return parts.join(String.fromCharCode(10))
}

describe('插件版本差异面板按需加载', () => {
  const src = overlaySource('src/components/plugins/plugin-version-timeline.tsx')

  it('不同步引入 plugin-diff-view', () => {
    expect(src).not.toMatch(/import\s*\{\s*PluginDiffView\s*\}\s*from/)
    expect(src).toContain("import('@/components/plugins/plugin-diff-view')")
  })

  it('经 next/dynamic 且仅在客户端加载', () => {
    expect(src).toContain("from 'next/dynamic'")
    expect(src).toContain('dynamic(')
    expect(src).toContain('ssr: false')
  })

  it('加载占位有固定高度与读屏播报，避免 CLS 与静默', () => {
    const start = src.indexOf('loading: () =>')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, start + 400)
    expect(block).toContain('aria-busy="true"')
    expect(block).toContain('sr-only')
    expect(block).toMatch(/h-16/)
  })
})

/**
 * 2026-10-24 实测：详情页静态引入 useModularLayout，经 registry 把全部 widget
 * 组件带进首屏（约 110 KB，时钟/天气/番茄/RSS…），是 1123 KB 超预算的主因。
 * 预设安装只在用户点「应用预设」时发生，注册表必须留在异步块里。
 */
describe('详情页预设安装不再把模块注册表拉进首屏', () => {
  const view = detailFamily()
  const direct = overlaySource('src/lib/modular/install-preset-direct.ts')

  it('详情页不静态引入 useModularLayout', () => {
    expect(view).not.toMatch(/from\s+'@\/lib\/modular\/use-modular-layout'/)
    expect(view).toContain("import('@/lib/modular/install-preset-direct')")
  })

  it('注册表只在点击安装后的异步块里加载', () => {
    expect(direct).not.toMatch(/^import\s+\{[^}]*WIDGET_REGISTRY[^}]*\}\s+from\s+'\.\/registry'/m)
    expect(direct).toContain("await import('./registry')")
  })

  it('沿用 planPresetInstall 的台账，并在覆盖损坏布局前留现场', () => {
    expect(direct).toContain('planPresetInstall')
    expect(direct).toContain('backupCorruptPayload')
    expect(direct).toContain('persisted')
  })
})
