/**
 * 详情页同类对比入口守卫测试（Batch 4 Phase 1 第 3 项）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 handoff-card.test.ts 同款说明），接线与空态纪律走源码守卫体例。
 * pick 上限的纯函数行为见 compare-logic.test.ts（toggleComparePick）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const detail = overlaySource('src/components/site-detail-view.tsx')
const api = overlaySource('src/lib/navhub-api.ts')
const compareLib = overlaySource('src/lib/compare.ts')

describe('同类文案可点击', () => {
  it('“可横向对比”是按钮，点击滚动到相关站点区', () => {
    const code = stripComments(detail)
    expect(code).toContain('可横向对比')
    expect(code).toContain('onClick={scrollToRelated}')
    expect(code).toContain("document.getElementById('related-sites-heading')")
    // 不再是纯文本句子的一部分
    expect(code).not.toContain('个同类条目可横向对比`')
  })
})

describe('候选来源：共享标签 /similar + alternative 关系边，不用 KNN', () => {
  it('navhub-api 有 fetchSimilarByTags，走 GET /api/sites/:id/similar', () => {
    const code = stripComments(api)
    expect(code).toContain('export async function fetchSimilarByTags')
    expect(code).toContain("'/api/sites/' + encodeURIComponent(siteId) + '/similar?limit='")
  })

  it('详情页用 fetchSimilarByTags 取候选，并与服务端相关区合并去重', () => {
    const code = stripComments(detail)
    expect(code).toContain('fetchSimilarByTags')
    expect(code).toContain('mergeCompareCandidates(id, initialRelated, similarByTags)')
  })

  it('候选合并里不用 KNN：merge 调用不含 KNN 的 similar 状态', () => {
    const code = stripComments(detail)
    const mergeAt = code.indexOf('mergeCompareCandidates(id, initialRelated, similarByTags)')
    expect(mergeAt).toBeGreaterThan(-1)
    expect(code.slice(mergeAt, mergeAt + 80)).not.toContain('fetchSimilar(')
    // KNN 仍只供它自己的“向量图谱相似推荐”区用，不进候选
    expect(code).toContain('fetchSimilar(id, 6')
  })

  it('alternative 关系边进候选：平替卡片按 targetSiteId 参与点选', () => {
    const code = stripComments(detail)
    expect(code).toContain("relations.filter((r) => r.relationType === 'alternative')")
    expect(code).toContain('alt.targetSiteId')
  })
})

describe('pick-state：先过 isFavorite 过滤，上限 4 个（含本站）', () => {
  it('候选先过 useFavorites().isFavorite 过滤', () => {
    const code = stripComments(detail)
    expect(code).toContain('useFavorites')
    expect(code).toContain('favorites.isFavorite(s.id)')
    expect(code).toContain('favorites.isFavorite(alt.targetSiteId)')
  })

  it('非收藏不可勾：显示“收藏后可加入对比”，而不是勾选按钮', () => {
    const code = stripComments(detail)
    expect(code).toContain('收藏后可加入对比')
    // 勾选按钮只在 isFavorite 分支里（相关区、平替区、兜底平替区各一处）
    const occurrences = code.split('aria-label={`加入对比：').length - 1
    expect(occurrences).toBe(3)
  })

  it('上限 4 个：本站占 1 席，候选最多再选 3 个，超限提示可见', () => {
    const code = stripComments(detail)
    expect(code).toContain('MAX_COMPARE_PICKS = 3')
    expect(code).toContain('toggleComparePick(comparePicked, candidateId, MAX_COMPARE_PICKS)')
    expect(code).toContain('已选 {comparePicked.length + 1}/4')
    expect(code).toContain('comparePickNote')
    expect(stripComments(compareLib)).toContain('一次最多对比')
  })

  it('卡片点选复用收藏夹批量模式：点标题链接 = 切换选中、拦截导航', () => {
    const code = stripComments(detail)
    // 相关区与平替区各一处 preventDefault + 切换
    const intercepts = code.split('e.preventDefault()\n').length - 1
    expect(intercepts).toBeGreaterThanOrEqual(2)
    expect(code).toContain('handleToggleComparePick(s.id)')
    expect(code).toContain('handleToggleComparePick(alt.targetSiteId as string)')
    // 外链图标仍是真外链（safeHref），不被拦截
    expect(code).toContain("aria-label={`访问 ${s.title} 官网`}")
  })

  it('勾选后跳 /compare?siteIds=：本站在首位 + 已选候选', () => {
    const code = stripComments(detail)
    expect(code).toContain('router.push(buildCompareHref([id, ...comparePicked]))')
    expect(code).toContain('disabled={comparePicked.length === 0}')
  })
})

describe('N5：pick 栏共享，平替区就地可见出口', () => {
  it('pick 栏抽成共享渲染函数，三处共用同一份', () => {
    const code = stripComments(detail)
    expect(code).toContain('const renderComparePickBar = () => (')
    expect(code).toContain('已选 {comparePicked.length + 1}/4')
    // 定义不带 ()，调用点恰好 3 处：平替区、兜底平替区、相关区
    const calls = code.split('renderComparePickBar()').length - 1
    expect(calls).toBe(3)
  })

  it('平替区顶部挂 pick 栏，选完就地可见出口', () => {
    const code = stripComments(detail)
    const start = code.indexOf('id="alternatives-section"')
    const end = code.indexOf('alternativesFallback.length > 0', start)
    expect(start).toBeGreaterThan(-1)
    expect(code.slice(start, end)).toContain('renderComparePickBar()')
  })

  it('死链兜底平替区与主平替区一致：顶部 pick 栏 + 卡片 pick-state', () => {
    const code = stripComments(detail)
    const start = code.indexOf('alternativesFallback.length > 0')
    const end = code.indexOf('ecosystemRelations.length > 0', start)
    expect(start).toBeGreaterThan(-1)
    const section = code.slice(start, end)
    expect(section).toContain('renderComparePickBar()')
    expect(section).toContain('handleToggleComparePick(alt.id)')
    expect(section).toContain('favorites.isFavorite(alt.id)')
    expect(section).toContain('收藏后可加入对比')
    expect(section).toContain('aria-label={`加入对比：${alt.title}`}')
  })

  it('相关区仍用同一份 pick 栏', () => {
    const code = stripComments(detail)
    const start = code.indexOf('id="related-sites-heading"')
    expect(start).toBeGreaterThan(-1)
    expect(code.slice(start)).toContain('renderComparePickBar()')
  })
})

describe('N7：对比入口按钮只在相关区实际存在时出现', () => {
  it('hasRelatedSection 与相关区渲染条件同源', () => {
    const code = stripComments(detail)
    expect(code).toContain(
      'const hasRelatedSection = relatedCandidates.length > 0 || Boolean(category && canLinkCategory)',
    )
    expect(code).toContain('(relatedCandidates.length > 0 || (category && canLinkCategory)) && (')
  })

  it('按钮由 hasRelatedSection 门控，不再只看 categoryCount > 1', () => {
    const code = stripComments(detail)
    const btnAt = code.indexOf('可横向对比')
    expect(btnAt).toBeGreaterThan(-1)
    // 按钮前的最近门控是 hasRelatedSection，且 categoryCount 的计数句已在其前闭合
    const gateAt = code.lastIndexOf('hasRelatedSection && (', btnAt)
    const countAt = code.lastIndexOf('categoryCount > 1', btnAt)
    expect(gateAt).toBeGreaterThan(-1)
    expect(countAt).toBeGreaterThan(-1)
    expect(countAt).toBeLessThan(gateAt)
  })

  it('档案句只陈述同类条目数，不暗示 N 个全部可比', () => {
    const code = stripComments(detail)
    expect(code).toContain('该分类下另有 {categoryCount - 1} 个同类条目')
    // 按钮 title 讲明只有已收藏的候选才能勾选
    expect(code).toContain('去相关站点区勾选已收藏的同类站点，横向对比')
  })
})
