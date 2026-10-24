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

/** 只留代码，注释里的「旧版为什么是错的」不算字面量命中 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const CODE = codeOnly(SRC)
const API = readFileSync(
  fileURLToPath(new URL('../../../apps/api/src/routes/sites.ts', import.meta.url)),
  'utf8',
)

describe('书签导入的条数台账', () => {
  /**
   * 服务端回三个计数，客户端读不到就必须记成「未确认」。
   * 旧写法是 `data.created ?? chunk.length`：一旦代理回了 HTML 异常页，
   * 整块 50 条会被当成成功收录，用户看到「导入完成」而库里一条没有。
   */
  it('2xx 但读不出条数时计入未确认，而不是当成成功', () => {
    expect(CODE).toContain("if (data && typeof data.created === 'number')")
    expect(CODE).toContain('unconfirmedCount += chunk.length')
    expect(CODE).not.toMatch(/created\s*\?\?\s*chunk\.length/)
    expect(CODE).not.toMatch(/successCount\s*\+=\s*chunk\.length/)
  })

  it('未确认既进结果对象也进渲染', () => {
    expect(CODE).toContain('unconfirmed: number')
    expect(CODE).toContain('unconfirmed: unconfirmedCount')
    expect(CODE).toContain('importResult.unconfirmed > 0')
    expect(CODE).toContain('未能确认')
  })

  it('有失败或有未确认就不能用成功配色与成功措辞', () => {
    expect(CODE).toContain('importResult.failed + importResult.unconfirmed > 0')
    expect(CODE).toContain('没确认收录')
    // 「导入完成！」只允许出现在三元的是分支里，不能作为无条件标题
    expect(CODE.match(/导入完成！/g)).toHaveLength(1)
  })

  it('读的计数字段与服务端返回的键逐一对应', () => {
    // 只看 batch 处理器之后的文本：返回对象用的是简写键（created, / duplicates,）。
    const batch = API.slice(API.indexOf('app.post("/api/sites/batch"'))
    expect(batch.length).toBeGreaterThan(0)
    for (const field of ['created', 'duplicates', 'categoryDegraded']) {
      expect(batch, `服务端不再回传 ${field}`).toContain(`${field}`)
      expect(CODE, `客户端没读 ${field}`).toContain(`data.${field}`)
    }
  })

  it('分块大小不超过中枢的单次上限', () => {
    // 形如 `})).min(1).max(200)`：数组里每项是对象，所以闭合是双括号。
    const cap = API.match(/\)\)\.min\(1\)\.max\((\d+)\)/)
    expect(cap, '找不到 /api/sites/batch 的 sites 上限').not.toBeNull()
    const chunk = CODE.match(/const chunkSize = (\d+)/)
    expect(chunk, '找不到分块大小').not.toBeNull()
    expect(Number(chunk![1])).toBeLessThanOrEqual(Number(cap![1]))
  })
})
