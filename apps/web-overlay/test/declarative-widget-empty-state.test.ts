import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * U-38（N1）：8 个预设里 17 个声明式微组件无数据时为空白 KPI 网格。
 * 修复方向：种子不填值、前端补空态引导；status-badge 无数据时不出现「系统运行正常」假断言。
 * 仓库 vitest 是 node 环境、无 jsdom，按惯例锁源码意图（见 a11y-contrast.test.ts）。
 * R7 证伪：先在旧代码上跑红，再改代码跑绿。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const widget = () => overlayFile('src/components/modular/modules/declarative-widget.tsx')
const registry = () => overlayFile('src/lib/modular/registry.ts')
const item = () => overlayFile('src/components/modular/modular-item.tsx')

describe('声明式微组件空态（U-38）', () => {
  it('无数据时渲染空态三件套：文案 + 说明 + 配置数据源按钮（接 onConfigure）', () => {
    const src = widget()
    expect(src).toContain('暂无数据')
    expect(src).toContain('此卡片尚未连接数据源')
    expect(src).toContain('不会显示示例数字')
    expect(src).toContain('配置数据源')
    expect(src).toContain('onClick={onConfigure}')
  })

  it('空态只在非 loading、非错误时出现', () => {
    const src = widget()
    // 空态门控：loading 与 errorMsg 时不渲染空态，避免取数中闪烁
    expect(src).toContain('!loading')
    expect(src).toContain('!errorMsg')
  })

  it('status-badge 的「系统运行正常」断言只出现在有数据门控的分支内', () => {
    const src = widget()
    const okIdx = src.indexOf('系统运行正常')
    expect(okIdx).toBeGreaterThan(-1)
    const readyIdx = src.indexOf('所有核心中枢与数据流完全就绪')
    expect(readyIdx).toBeGreaterThan(-1)
    // 门控必须出现在断言之前：数据长度门控
    const gateIdx = src.lastIndexOf('dataList.length > 0', okIdx)
    expect(gateIdx).toBeGreaterThan(-1)
    // 空态文案里不得出现该断言
    const emptyStart = src.indexOf('暂无数据')
    const emptyEnd = src.indexOf('配置数据源', emptyStart)
    expect(src.slice(emptyStart, emptyEnd)).not.toContain('系统运行正常')
  })

  it('registry 给 declarative-widget 配 configSchema：endpoint / layout / refreshIntervalSeconds', () => {
    const src = registry()
    const start = src.indexOf("'declarative-widget'")
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('WIDGET_COMPONENTS', start)
    const block = src.slice(start, end)
    expect(block).toContain('configSchema')
    expect(block).toContain("key: 'endpoint'")
    expect(block).toContain("type: 'text'")
    expect(block).toContain("key: 'layout'")
    expect(block).toContain("type: 'select'")
    for (const layout of ['kpi-grid', 'key-value', 'progress-bar', 'feed-list', 'status-badge']) {
      expect(block).toContain(layout)
    }
    expect(block).toContain("key: 'refreshIntervalSeconds'")
    expect(block).toContain("type: 'number'")
  })

  it('modular-item 透传 title 与 onConfigure 给 LazyWidget', () => {
    const src = item()
    const line = src.split('\n').find((l) => l.includes('<LazyWidget'))
    expect(line).toBeTruthy()
    expect(line).toContain('title={widget.customTitle || def.title}')
    expect(line).toContain('onConfigure')
    expect(line).toContain('onOpenConfig(widget)')
  })
})
