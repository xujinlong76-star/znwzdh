import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PluginDetailUpdated } from '../src/components/plugins/plugin-detail-updated'
import { formatPackDate } from '../src/lib/link-pack'

/**
 * P3-4：插件详情头展示更新日期。
 *
 * updatedAt/publishedAt 字段存在且可排序，但详情页此前均不显示
 * 「更新于/发布于某日」，只有新作榜文案与版本时间轴间接体现时间。
 * 本项只做详情头部分（plugin-card.tsx 是另一 worker 的，不碰）：
 * 详情头徽章行在版本号后展示「更新于 YYYY-MM-DD」，取运行时 updatedAt，
 * 日期格式复用仓内已有 helper formatPackDate（本地日期，与链接包快照
 * 「发布于某日」同款）。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，按 board 第 2 批同款分层）：
 *  1. 真渲染（renderToString）：组件真的输出「更新于 <日期>」，且日期
 *     与 formatPackDate(同一时间戳) 完全一致；缺失/非法 updatedAt 渲染为空。
 *  2. 接线守卫（源码断言）：壳真的引入并挂载了该组件，取的是
 *     plugin.updatedAt；壳仍在 <1150 行瘦身下限内（本项净 +1 行）。
 *
 * 本文件不用 vi.mock（纯渲染 + 纯函数 + 源码断言），无需 resetModules。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const SHELL = 'src/app/marketplace/[slug]/plugin-detail-view.tsx'

// 本地正午时间戳：formatPackDate 按本地日期取年月日，正午不受任何时区
// 的日期边界影响，断言在任何 TZ 下都稳定。
const NOON_2026_11_17 = new Date(2026, 10, 17, 12, 0, 0).getTime()

describe('P3-4 详情头展示更新日期', () => {
  it('渲染「更新于 YYYY-MM-DD」，日期与 formatPackDate 同款', () => {
    const html = renderToString(createElement(PluginDetailUpdated, { updatedAt: NOON_2026_11_17 }))
    // renderToString 在文本与表达式之间插入 <!-- -->，故分开断言两段
    expect(html).toContain('更新于')
    expect(html).toContain(formatPackDate(NOON_2026_11_17))
    expect(html).toContain('2026-11-17')
  })

  it('updatedAt 缺失/非法时不渲染任何内容', () => {
    expect(renderToString(createElement(PluginDetailUpdated, { updatedAt: undefined }))).toBe('')
    expect(renderToString(createElement(PluginDetailUpdated, { updatedAt: null }))).toBe('')
    expect(renderToString(createElement(PluginDetailUpdated, { updatedAt: Number.NaN }))).toBe('')
  })

  it('壳在详情头徽章行挂载组件，取运行时 plugin.updatedAt', () => {
    const shell = overlayFile(SHELL)
    expect(shell).toContain("import { PluginDetailUpdated } from '@/components/plugins/plugin-detail-updated'")
    expect(shell).toContain('<PluginDetailUpdated updatedAt={plugin.updatedAt} />')
  })

  it('壳仍在瘦身下限内（< 1150 行）', () => {
    const shell = overlayFile(SHELL)
    expect(shell.split('\n').length).toBeLessThan(1150)
  })
})
