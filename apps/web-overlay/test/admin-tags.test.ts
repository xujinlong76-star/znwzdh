import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRead(rel: string): string {
  // 测试可能位于 overlay/test 或镜像 apps/web/test 两种位置，两处都试
  const candidates = [
    resolve(HERE, '..', rel),
    resolve(HERE, '..', '..', 'web-overlay', rel),
    resolve(HERE, '..', '..', '..', 'apps', 'web-overlay', rel),
  ]
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/**
 * 管理端标签治理页的分页守卫（2026-11-10）。
 *
 * 真实缺陷：/admin/tags 此前把 **全部 2418 个标签**一次性渲染成表格，
 * 实测产生 43,950 个 DOM 节点 / 12,103 个按钮，首屏加载 6.2 秒。
 * 管理端操作本来就靠筛选定位，一次铺开全部没有任何收益。
 *
 * 改为每页 50 行后：1,260 节点 / 50 行 / 4.0 秒（-97% DOM）。
 * 本守卫锁住「分页必须真的生效」，防止以后改回全量 .map。
 */
describe('admin/tags 分页：不许一次性渲染全部标签', () => {
  const src = overlayRead('src/app/admin/tags/page.tsx')

  it('定义了每页行数常量且渲染的是 paged 而非 filtered', () => {
    expect(src).toContain('const PAGE_SIZE = 50')
    expect(src).toContain('const paged = filtered.slice(')
    // 表格 tbody 里必须只迭代 paged
    expect(src).toContain('{paged.map((t) => (')
    // 不能出现全量渲染（回归防线）
    expect(src).not.toContain('{filtered.map((t) => (')
  })

  it('页码越界有钳制，筛选/分组变化会回到第 1 页', () => {
    expect(src).toContain('const safePage = Math.min(page, totalPages)')
    expect(src).toContain('setPage(1) }, [filter, selectedGroup])')
    expect(src).toContain('Math.ceil(filtered.length / PAGE_SIZE)')
  })

  it('分页控件存在且带上一页/下一页与总数信息', () => {
    expect(src).toContain('上一页')
    expect(src).toContain('下一页')
    expect(src).toContain('个标签 · 第')
    expect(src).toContain('disabled={safePage <= 1}')
    expect(src).toContain('disabled={safePage >= totalPages}')
  })
})
