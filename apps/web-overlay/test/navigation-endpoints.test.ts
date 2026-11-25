import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 2026-11-25 端点漂移守卫：管理端三个此前调用但未注册的端点必须有真实
 * route.ts 落地。历史事故——按钮全部 404 却无人察觉（move-to-top/bottom
 * 全仓仅调用点、export 被 [id] 动态路由吞掉）。
 */
const ROOT = join(import.meta.dirname, '../src')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('管理端导航端点落地（2026-11-25 修复 404 死按钮）', () => {
  const ROUTES = [
    'app/api/navigation/[id]/move-to-top/route.ts',
    'app/api/navigation/[id]/move-to-bottom/route.ts',
    'app/api/navigation/export/route.ts',
  ]

  it.each(ROUTES)('%s 存在且导出 POST/GET', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(true)
    const src = read(rel)
    if (rel.includes('export')) {
      expect(src).toContain('export async function GET')
      expect(src).toContain('Content-Disposition')
    } else {
      expect(src).toContain('export async function POST')
      expect(src).toContain('verifyAdminSession')
      expect(src).toContain('getFileContent')
      expect(src).toContain('commitFile')
    }
  })

  it('move 端点按 id 定位而不是数组下标（filteredItems 与全量下标不一致）', () => {
    for (const rel of ROUTES.slice(0, 2)) {
      const src = read(rel)
      expect(src).toContain('findIndex')
      expect(src).toContain('data.navigationItems')
    }
  })

  it('export 是静态段（优先于 [id] 动态段，不会被吞成 id=export）', () => {
    expect(existsSync(join(ROOT, 'app/api/navigation/export/route.ts'))).toBe(true)
  })
})
