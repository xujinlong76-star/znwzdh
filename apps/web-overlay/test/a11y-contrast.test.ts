import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 对比度回归（Lighthouse 2026-10-23 /custom：color-contrast 0 分）。
 *
 * 两处 12px 小字在浅色模式下低于 WCAG AA 4.5:1：
 * - 看板切换条的未选中项：muted 前景色再叠 opacity-75 → 2.91:1；
 * - 页脚「模块化工作台」：emerald-600 → 3.62:1（emerald-700 达标）。
 *
 * 这类退化不会被单元测试自然覆盖（纯样式），所以按仓库惯例锁源码意图。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('浅色模式对比度', () => {
  it('看板计数不再叠 opacity，避免 12px muted 文本跌破 AA', () => {
    const canvas = overlayFile('src/components/modular/modular-canvas.tsx')
    const line = canvas.split('\n').find((l) => l.includes('({b.widgets.length})'))
    expect(line).toBeTruthy()
    expect(line).not.toContain('opacity-75')
  })

  it('页脚强调色与版权行都达到 AA', () => {
    const footer = overlayFile('src/components/footer.tsx')
    const custom = footer.split('\n').find((l) => l.includes('href="/custom"'))
    const market = footer.split('\n').find((l) => l.includes('href="/marketplace"'))
    expect(custom).toContain('text-emerald-700')
    expect(custom).not.toContain('text-emerald-600')
    // rose-600 实测 4.48:1，差 0.02 也是不达标
    expect(market).toContain('text-rose-700')
    expect(market).not.toContain('text-rose-600')
    // 版权行再叠 /80 透明度只有 3.63:1
    expect(footer).not.toContain('text-muted-foreground/80')
  })
})
