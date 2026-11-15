/**
 * 对照页接线守卫测试（Batch 4 Phase 1 第 2 项）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 handoff-card.test.ts 同款说明），接线与空态纪律走源码守卫体例：
 *   - 对照表经 next/dynamic + { ssr: false } 懒加载，不进首屏 chunk；
 *   - 对照页 noindex, nofollow，不进 sitemap、不进底栏导航；
 *   - 收藏夹“横向对比”按钮的数量校验与 URL 传参；
 *   - 对照表渲染纪律：移动端卡片堆叠断点、差异高亮复用现有色板、
 *     缺失格“未验证”、无 winner、结论不写进任何站点 note。
 * 行为逻辑见 compare-logic.test.ts。
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

const page = overlaySource('src/app/compare/page.tsx')
const layout = overlaySource('src/app/compare/layout.tsx')
const view = overlaySource('src/components/compare-view.tsx')
const compareLib = overlaySource('src/lib/compare.ts')
const favoritesPage = overlaySource('src/app/favorites/page.tsx')
const sitemap = overlaySource('src/app/sitemap.ts')
const footer = overlaySource('src/components/footer.tsx')

describe('对照页壳：懒加载 + searchParams 传参', () => {
  it('对照表经 next/dynamic + { ssr: false } 懒加载（照抄 favorites 范式）', () => {
    const code = stripComments(page)
    expect(code).toContain('next/dynamic')
    expect(code).toContain("import('@/components/compare-view')")
    expect(code).toContain('ssr: false')
  })

  it('读 searchParams.siteIds 并校验 2–4 个，不合规不取数', () => {
    const code = stripComments(page)
    expect(code).toContain('useSearchParams')
    expect(code).toContain("searchParams.get('siteIds')")
    expect(code).toContain('validateCompareSiteIds')
    expect(code).toContain('Suspense')
  })
})

describe('对照页不被收录', () => {
  it('layout 下发 robots noindex, nofollow', () => {
    const code = stripComments(layout)
    expect(code).toContain('robots')
    expect(code).toContain('index: false')
    expect(code).toContain('follow: false')
  })

  it('不进 sitemap、不进底栏导航', () => {
    expect(sitemap).not.toContain('/compare')
    expect(sitemap).not.toContain('compare')
    expect(footer).not.toContain('/compare')
    expect(footer).not.toContain('横向对比')
  })
})

describe('对照表渲染纪律', () => {
  it('移动端卡片堆叠：grid-cols-1 md:grid-cols-2 xl:grid-cols-4（4 列只在 xl 1280px+ 展开，md/lg 保持 2 列）', () => {
    expect(view).toContain('grid-cols-1 md:grid-cols-2 xl:grid-cols-4')
    expect(view).not.toContain('lg:grid-cols-3')
  })

  it('差异高亮复用现有色板 border-primary/40 + bg-primary/5，不新造色板', () => {
    const code = stripComments(view)
    expect(code).toContain('border-primary/40')
    expect(code).toContain('bg-primary/5')
  })

  it('缺失格显式“未验证”，不设 winner、不排名', () => {
    const code = stripComments(view)
    expect(code).toContain('未验证')
    expect(code).not.toMatch(/\bwinner\b/)
    expect(stripComments(compareLib)).not.toMatch(/\bwinner\s*[:=]/)
  })

  it('取数走 /api/compare，401/404 报诚实错误，不渲染空表', () => {
    const code = stripComments(view)
    expect(code).toContain("hubUrl('/api/compare?siteIds='")
    expect(code).toContain('401')
    expect(code).toContain('404')
    expect(code).toContain('没有返回任何站点')
  })

  it('站点外链过 safeHref 安全闸（url-hygiene 门禁：裸 href 会红）', () => {
    const code = stripComments(view)
    expect(code).toContain('safeHref(item.url)')
    expect(code).not.toContain('href={item.url')
  })

  it('分流结论区与已保存结论区真实存在，结论保存走本机键', () => {
    const code = stripComments(view)
    expect(code).toContain('分流结论')
    expect(code).toContain('已保存的对照结论')
    expect(code).toContain('saveCompareNote')
    expect(code).toContain('deleteCompareNote')
    expect(compareLib).toContain("COMPARE_NOTES_KEY = 'navhub.compare.notes.v1'")
  })

  it('结论绝不塞进任何站点的 note：对照视图不写收藏备注', () => {
    const code = stripComments(view)
    expect(code).not.toContain('updateFavoriteMeta')
    expect(code).not.toMatch(/\.note\s*=/)
    expect(code).not.toContain('/api/favorites')
  })
})

describe('评审 BLOCK 修复守卫（Batch 4 Phase 1 收尾）', () => {
  it('B2：预览与保存都把被选站点的依据格传进结论，任一未验证即拒绝', () => {
    const code = stripComments(view)
    expect(code).toContain('basisCells')
    expect(code).toContain('basisCells,')
    expect(stripComments(compareLib)).toContain('依据格子中有未验证项，请换依据或先补数据。')
  })

  it('N2：非服务端错误一律映射为中文网络错误，不贴英文 Failed to fetch', () => {
    const code = stripComments(view)
    expect(code).toContain('网络出了问题，请检查连接后重试。')
    expect(code).toContain('err instanceof CompareFetchError ? err.message')
    expect(code).not.toContain('err instanceof Error ? err.message')
  })

  it('N3：副行日期加定语——维护格“核实于”，其余格“更新于”', () => {
    const code = stripComments(view)
    expect(code).toContain('核实于')
    expect(code).toContain('更新于')
  })

  it('N6：结论区控件达 44px 移动触控基线（min-h-11），长标题有 title', () => {
    const code = stripComments(view)
    expect(code).toContain('min-h-11')
    expect(code).not.toContain('h-8 ')
    expect(code).toContain('title={chosenItem?.title}')
    expect(code).toContain('title={item.title}')
  })
})

describe('P2-6 四站对照（Batch 4 Phase 2）', () => {
  it('上限 4：MAX_COMPARE_SITES = 4，超限文案写清“一次最多对比 4 个站点”', () => {
    const code = stripComments(compareLib)
    expect(code).toContain('MAX_COMPARE_SITES = 4')
    expect(code).toContain('一次最多对比 4 个站点，请先取消多余的勾选。')
    expect(code).toContain('请勾选 2–4 个已收藏站点进行对比')
  })

  it('4 列只在 xl 展开：骨架与卡片两处网格同款，无横向滚动大表', () => {
    const code = stripComments(view)
    const occurrences = code.split('grid-cols-1 md:grid-cols-2 xl:grid-cols-4').length - 1
    expect(occurrences).toBe(2)
    expect(code).not.toContain('overflow-x-auto')
    expect(code).not.toContain('overflow-x-scroll')
  })

  it('400 与空态文案写 2–4，不留旧上限', () => {
    const code = stripComments(view)
    expect(code).toContain('请勾选 2–4 个已收藏站点进行对比。')
    expect(code).toContain('请回到收藏夹重新勾选 2–4 个站点。')
    expect(code).not.toContain('2–3 个')
  })

  it('对照页壳文案 2–4：头注释与收藏夹链接', () => {
    expect(page).toContain('校验 2–4 个')
    expect(page).toContain('去收藏夹勾选 2–4 个站点')
    expect(page).not.toContain('2–3 个')
  })
})

describe('收藏夹入口：批量栏“横向对比”按钮', () => {
  it('按钮与“导出 MD”并列，数量校验 disabled={size<2||size>4}，title 写清规则', () => {
    const code = stripComments(favoritesPage)
    const exportAt = code.indexOf('导出 MD')
    const compareAt = code.indexOf('横向对比')
    expect(exportAt).toBeGreaterThan(-1)
    expect(compareAt).toBeGreaterThan(exportAt)
    expect(code).toContain('disabled={selectedSiteIds.size < 2 || selectedSiteIds.size > 4}')
    expect(code).toContain('横向对比需要选 2–4 个收藏')
    expect(code).toContain('横向对比一次最多 4 个收藏')
  })

  it('点击走 URL 传参跳 /compare?siteIds=（选中态是页内 state，切页即丢）', () => {
    const code = stripComments(favoritesPage)
    expect(code).toContain('buildCompareHref')
    expect(code).toContain('router.push(buildCompareHref([...selectedSiteIds]))')
  })

  it('对比不绑快捷键：按钮 title 里没有“快捷键”', () => {
    const code = stripComments(favoritesPage)
    const compareAt = code.indexOf('横向对比')
    const titleSlice = code.slice(code.lastIndexOf('title={', compareAt), compareAt + 200)
    expect(titleSlice).not.toContain('快捷键')
  })
})
