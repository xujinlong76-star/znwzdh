/**
 * 批量固定 toast 如实计数（2026-11-15 小时轮，05:05 轮次评审遗留）。
 *
 * 背景：pinSiteToWorkbench 对已固定过的站也返回 ok（只不新加），
 * 旧的 handleBatchPinToWorkbench 把每个 ok 都计入 pinned——选两条
 * 同站不同写法（www / utm / 尾斜杠）会报「已固定 2 个站点」，
 * 实际只新增 1 条。本轮把新增与已在分开计数，toast 按实情报。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBatchPinToast } from '../src/lib/batch-pin-toast'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.includes('web-overlay') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('buildBatchPinToast：新增与已在分开报', () => {
  it('全部新增：只报新增数，文案与旧版一致', () => {
    expect(buildBatchPinToast(2, 0)).toEqual({
      title: '📌 已固定 2 个站点',
      description: '已加入收藏与工作台启动坞。',
    })
  })

  it('部分已在：新增数照实报，已在数另起一句', () => {
    expect(buildBatchPinToast(1, 1)).toEqual({
      title: '📌 已固定 1 个站点',
      description: '已加入收藏与工作台启动坞；另有 1 个已在收藏中。',
    })
    expect(buildBatchPinToast(1, 2).description).toContain('另有 2 个已在收藏中')
  })

  it('全部已在：不报「已固定」，也不掉进「固定失败」', () => {
    const t = buildBatchPinToast(0, 2)
    expect(t.title).toBe('📌 2 个站点已在收藏中')
    expect(t.title).not.toContain('已固定 2')
    expect(t.title).not.toContain('固定失败')
    expect(t.description).toContain('未新增')
    // 只敢说收藏未变：pin 时 dock 补位仍可能新建启动坞 widget，
    // 不能写「工作台启动坞未变」。
    expect(t.description).toBe('未新增任何站点，收藏未变。')
  })

  it('一个都没 ok：仍是旧版固定失败文案', () => {
    expect(buildBatchPinToast(0, 0)).toEqual({
      title: '⚠️ 固定失败',
      description: '浏览器本地存储不可用，或网址不合法。',
    })
  })
})

describe('源码守卫：handleBatchPinToWorkbench 按 addedSiteIds 分流计数', () => {
  const nav = overlaySource('src/components/navigation-content.tsx')

  it('新增计数只在收据含新建站时加，不再按每个 ok 加', () => {
    // 旧写法 `pinned++` 紧跟 `if (!res.ok) continue`，已删除。
    expect(nav).not.toMatch(/if \(!res\.ok\) continue\n\s*pinned\+\+/)
    expect(nav).toContain('if (res.receipt.addedSiteIds.length > 0) {')
    expect(nav).toContain('newlyPinned++')
    expect(nav).toContain('alreadyPinned++')
  })

  it('新增计数必须长在新建分支里，不能移到分支外', () => {
    // newlyPinned++ 只能出现在 addedSiteIds.length > 0 分支内（该分支无嵌套
    // 大括号，可用 [^}]* 截断）；alreadyPinned++ 只能出现在 else 分支内。
    // 否则「每个 ok 都算新增」的旧 bug 换个写法就能绕过上一条守卫。
    expect(nav).toMatch(/if \(res\.receipt\.addedSiteIds\.length > 0\) \{[^}]*newlyPinned\+\+/)
    expect(nav).toMatch(/\} else \{\n\s*alreadyPinned\+\+/)
    expect(nav).not.toMatch(/if \(res\.receipt\.addedSiteIds\.length > 0\) \{[^}]*alreadyPinned\+\+/)
  })

  it('toast 走 buildBatchPinToast，不再内联拼 ok 数', () => {
    expect(nav).toContain("toast(buildBatchPinToast(newlyPinned, alreadyPinned))")
    expect(nav).not.toContain("'📌 已固定 ' + pinned + ' 个站点'")
  })

  it('撤销收据的 pinnedCount 仍是 ok 总数（收据约定不变）', () => {
    expect(nav).toContain('pinnedCount: newlyPinned + alreadyPinned,')
  })
})
