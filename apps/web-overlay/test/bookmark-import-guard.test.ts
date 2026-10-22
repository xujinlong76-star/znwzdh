import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isRegistryLeaf } from '../../../packages/core/src/category-registry.ts'

/**
 * 书签导入器的类目建议表锁（方案 P4-5）。
 *
 * 这个组件是纯客户端，拿不到权威树的类型，只能靠字符串读源码来钉三件事：
 * 1. 建议表里每个 slug 都是**可挂的叶子**——写成一級根不会报错，只会在中枢
 *    被静默降级成「未分类」（`/api/sites/batch` 的 attachable 集合不含根），
 *    用户看到「导入成功」但站点全堆在未分类里；
 * 2. 旧版那 5 个 `cat-*` 根 id 字面量不许回来（同样的静默降级）；
 * 3. 降级数必须被消费——不读 `categoryDegraded` 就等于把假成功留给运营去猜。
 */

const SRC = readFileSync(
  fileURLToPath(new URL('../src/components/bookmark-importer.tsx', import.meta.url)),
  'utf8',
)

function hintSlugs(): string[] {
  const start = SRC.indexOf('const CATEGORY_HINTS')
  if (start === -1) throw new Error('找不到 CATEGORY_HINTS 建议表')
  const end = SRC.indexOf('\n]', start)
  expect(end, '建议表必须以独立一行的 ] 结尾').toBeGreaterThan(start)
  return [...SRC.slice(start, end).matchAll(/slug: '([a-z0-9-]+)'/g)].map((m) => m[1]!)
}

describe('书签导入器的类目建议', () => {
  it('每个建议分类都是权威树的可挂叶子', () => {
    const slugs = hintSlugs()
    expect(slugs.length).toBeGreaterThanOrEqual(20)
    expect(slugs.filter((s) => !isRegistryLeaf(s))).toEqual([])
  })

  it('同一个 slug 不重复声明（重复意味着两条规则抢同一个叶子）', () => {
    const slugs = hintSlugs()
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('旧树的 5 个根 id 字面量已经清零', () => {
    // 只查字符串字面量：文件头注释里要解释「旧版为什么写死 cat-ai 是错的」，
    // 那些提及是文档而不是提交值。
    for (const dead of ['cat-ai', 'cat-dev', 'cat-design', 'cat-learn', 'cat-life']) {
      expect(SRC, dead).not.toContain(`'${dead}'`)
      expect(SRC, dead).not.toContain(`"${dead}"`)
    }
  })

  it('提交用 slug，且没建议出来就省略 categoryId', () => {
    expect(SRC).toContain("...(b.suggestedCategorySlug ? { categoryId: b.suggestedCategorySlug } : {})")
    expect(SRC).toContain('data.categoryDegraded ?? 0')
    expect(SRC).toContain('importResult.degraded > 0')
  })

  it('下拉有「暂不分类」，且建议表补齐中枢缺的 slug（否则 select 显示空白）', () => {
    expect(SRC).toContain("slug: UNCLASSIFIED, label: '暂不分类（导入后再归类）'")
    expect(SRC).toContain('CATEGORY_HINTS.filter((h) => !seen.has(h.slug))')
    expect(SRC).toContain('value={opt.slug}')
  })
})
