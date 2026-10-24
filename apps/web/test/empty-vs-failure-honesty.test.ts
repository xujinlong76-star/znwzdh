/**
 * 「失败」与「空」必须是两个状态（2026-10-23 全站排查收口）。
 *
 * 反复出现的同一类缺陷：请求失败被折叠成空数组，页面于是渲染「暂无数据 / 共收录 0 个 /
 * 队列已处理完毕」——用户和管理员读到的结论是「数据没了」，而事实只是「这一次没拉到」。
 * 本文件按页面钉住三条规则：
 *   1. 取数函数把「失败」与「截断」分开返回（`failed` / `truncated`）；
 *   2. 渲染顺序上，失败分支必须在「暂无」分支之前（否则永远走不到）；
 *   3. 失败分支的文案不许出现「共收录 N 个 / 已处理完毕」这类结论，且必须给重试出口。
 *
 * 另含两条同源约束：分页深度（超出中枢 offset 上限的页码不该链过去）与
 * 管理台「只 import 不调用」的死代码回归锁（预警/漏斗/评价治理都必须真的渲染）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_PAGE_SEARCH_MAX_OFFSET,
  categoryPageOffsetIsReachable,
  maxReachableCategoryPage,
} from '../src/lib/seo/category-pagination'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/** 剥注释但保留行列位置：注释里正当地写着「以前会说共收录 N 个」这类反例 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith('//') ? ' '.repeat(line.length) : line))
    .join('\n')
}

describe('/sites 站点目录：失败 ≠ 截断 ≠ 空', () => {
  const FILE = 'src/app/sites/sites-directory.tsx'
  const src = stripComments(read(FILE))

  it('取数结果同时带 truncated 与 failed 两个独立标记', () => {
    expect(src).toContain('truncated: boolean')
    expect(src).toContain('failed: boolean')
    expect(src).toContain('truncated: catalog.truncated')
    expect(src).toContain('failed: catalog.failed')
  })

  it('头部计数：失败时不报「共收录 N 个」，截断时也不报总数', () => {
    const headerAt = src.indexOf('{failed')
    expect(headerAt).toBeGreaterThan(-1)
    const headerBlock = src.slice(headerAt, src.indexOf(': truncated'))
    expect(headerBlock).toContain('目录数据这次没能从 NavHub 中枢取回')
    expect(headerBlock).not.toContain('共收录')
    expect(src).toContain('已列出前')
  })

  it('失败态排在「暂无可展示的站点」之前，并给出重新加载入口', () => {
    const failureAt = src.indexOf('{failed ? (')
    const emptyAt = src.indexOf('暂无可展示的站点')
    expect(failureAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(failureAt).toBeLessThan(emptyAt)
    const failureBlock = src.slice(failureAt, emptyAt)
    expect(failureBlock).toContain('不是本站没有收录')
    expect(failureBlock).toContain('重新加载目录')
    expect(failureBlock).not.toContain('暂无')
  })

  it('失败时不渲染分页器（半截数据算不出真实页数）', () => {
    expect(src).toContain('{!failed && totalPages > 1 ? (')
  })
})

describe('标签结果页：一次最多 100 条要说出来', () => {
  it('SSR 把 hasMore 作为 initialTruncated 下发给岛', () => {
    const page = stripComments(read('src/app/tags/[slug]/page.tsx'))
    const board = stripComments(read('src/components/tag-results-board.tsx'))
    expect(page).toContain('initialTruncated={Boolean(res?.hasMore)}')
    expect(board).toContain('initialTruncated = false')
    expect(board).toContain('setTruncated(Boolean(res.hasMore))')
    // 上限内还有余量时不许写「共 N 个站点」
    expect(board).toContain('本页列出 ${sites.length} 个站点（可能还有更多）')
  })
})

describe('插件市场「加载更多」：失败不许改写总数', () => {
  const src = stripComments(read('src/components/plugin-market-board.tsx'))

  it('追加分页失败时保留原有 items 与 total', () => {
    expect(src).toContain('if (!(append && failed))')
    const guardAt = src.indexOf('if (!(append && failed))')
    const totalAt = src.indexOf('setTotal(res.total)', guardAt)
    expect(guardAt).toBeGreaterThan(-1)
    expect(totalAt).toBeGreaterThan(guardAt)
  })

  it('失败通过 onDegraded 记下来，而不是静默返回空块', () => {
    expect(src).toContain('const onDegraded = (error: unknown) => {')
    expect(src).toContain('failed = true')
  })
})

describe('管理台插件页：预警 / 漏斗 / 评价治理必须真的接上', () => {
  const FILE = 'src/app/admin/plugins/page.tsx'
  const raw = read(FILE)
  const src = stripComments(raw)

  it('三个已导入的管理端 API 不再是死代码（曾被 import 却从未调用）', () => {
    expect(src).toContain('fetchAdminPluginReviews({')
    expect(src).toContain('moderatePluginReview(review.id,')
    expect(src).toContain('setPluginFeatured(plugin.slug, next, rank)')
    expect(src).toContain('<FunnelPanel funnel={funnel} />')
    expect(src).toContain('alerts={governance}')
  })

  it('治理预警用 generatedAt===0 区分「没取回」与「没有预警」', () => {
    expect(src).toContain('failed={governanceGeneratedAt === 0}')
    expect(src).toContain('setGovernanceGeneratedAt(governanceRes.generatedAt)')
    const failedCopy = src.indexOf('预警聚合这次没能从中枢取回')
    const emptyCopy = src.indexOf('当前没有触发阈值的预警')
    expect(failedCopy).toBeGreaterThan(-1)
    expect(emptyCopy).toBeGreaterThan(failedCopy)
  })

  it('主列表失败态在「队列已处理完毕」之前', () => {
    const failureAt = src.indexOf(') : listFailed ? (')
    const emptyAt = src.indexOf('所有插件已处理完毕')
    expect(failureAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(failureAt)
    const failureBlock = src.slice(failureAt, emptyAt)
    expect(failureBlock).toContain('不代表待审插件已被处理完')
    expect(failureBlock).toContain('重新加载队列')
    expect(failureBlock).not.toContain('已处理完毕')
  })

  it('评价列表单独记失败，不复用主列表的降级横幅', () => {
    expect(src).toContain('setReviewsFailed(true)')
    const failureAt = src.indexOf('reviewsFailed ? (')
    expect(src.slice(failureAt, src.indexOf('当前没有展示中的评价'))).toContain('不代表评价被清空')
  })

  it('精选位次输入按服务端同一钳制范围（0..9999）', () => {
    expect(raw).toContain('max={9999}')
    expect(raw).toContain('min={0}')
  })
})

describe('管理台：类目根选项与前端错误卡片不许静默变空', () => {
  it('一级类目拉取失败给出原因 + 重试，而不是 .catch(() => setRoots([]))', () => {
    const src = stripComments(read('src/app/admin/taxonomy/page.tsx'))
    expect(src).toContain("describeLoadFailure(err, '一级类目')")
    expect(src).toContain('setRootsError(describeLoadFailure')
    expect(src).toContain('setRootsRetryToken((n) => n + 1)')
    expect(src).not.toContain('catch(() => setRoots([]))')
  })

  it('前端错误聚合用 loadFailed 标记，而不是把 undefined 当失败哨兵', () => {
    const src = stripComments(read('src/app/admin/AdminDashboardClient.tsx'))
    expect(src).toContain('loadFailed: true')
    expect(src).toContain('clientErrors?.loadFailed')
    expect(src).toContain('这里不能读成「没有崩溃被捕获」')
  })
})

describe('分页深度与可达性同口径', () => {
  it('下一页链接不会链向必然越界的深页', () => {
    const src = stripComments(read('src/app/category/[slug]/category-board.tsx'))
    expect(src).toContain('maxReachableCategoryPage(PAGE_SIZE)')
    expect(src).toContain('res?.hasMore && requested < deepestPage')
    expect(src).toContain('翻页最深只到第')
  })

  it('路由在取数之前先按 offset 可达性判 404', () => {
    const src = stripComments(read('src/app/category/[slug]/p/[n]/page.tsx'))
    const reachableAt = src.indexOf('categoryPageOffsetIsReachable(n, PAGE_SIZE)')
    const loadAt = src.indexOf('loadCategoryPage(safeRef, n)')
    expect(reachableAt).toBeGreaterThan(-1)
    expect(loadAt).toBeGreaterThan(reachableAt)
    expect(src.slice(reachableAt, loadAt)).toContain('notFound()')
  })

  it('最深可达页与可达性判定一致（上限 1000）', () => {
    expect(CATEGORY_PAGE_SEARCH_MAX_OFFSET).toBe(1000)
    for (const pageSize of [12, 24, 60, 100]) {
      const deepest = maxReachableCategoryPage(pageSize)
      expect(categoryPageOffsetIsReachable(deepest, pageSize)).toBe(true)
      expect(categoryPageOffsetIsReachable(deepest + 1, pageSize)).toBe(false)
    }
  })
})
