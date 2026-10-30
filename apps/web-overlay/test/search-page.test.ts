/**
 * /search 结果页：URL 状态、服务端取数与入口接线。
 *
 * 这一页补的是真实缺陷——搜索此前只有客户端浮层，结果不可分享、不可回退；
 * /me/history 的「再次搜索」链到 `/?q=`，而没有任何页面消费这个参数。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SEARCH_MAX_OFFSET,
  SEARCH_PAGE_SIZE,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_TAG_MAX_LENGTH,
  inferredConditionLabels,
  normalizeSearchPage,
  normalizeSearchQuery,
  normalizeSearchTag,
  searchApiPath,
  searchHref,
  searchMaxPage,
  searchPageWindow,
} from '../src/lib/search-page'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

function repoFile(rel: string): string {
  // apps/web/test 与 apps/web-overlay/test 都是仓库根往下三层
  return readFileSync(resolve(HERE, '..', '..', '..', rel), 'utf8')
}

describe('/search 的 URL 状态', () => {
  it('查询词去控制字符、折叠空白并截断到中枢上限', () => {
    expect(normalizeSearchQuery('  ai\u0000   工具  ')).toBe('ai 工具')
    expect(normalizeSearchQuery('x'.repeat(SEARCH_QUERY_MAX_LENGTH + 50))).toHaveLength(SEARCH_QUERY_MAX_LENGTH)
    // Next 对重复 query 传数组形态：取第一个，而不是渲染成 "a,b"
    expect(normalizeSearchQuery(['react', 'vue'])).toBe('react')
    expect(normalizeSearchQuery(undefined)).toBe('')
  })

  it('页码夹在 [1, 中枢 offset 上限] 之间', () => {
    expect(normalizeSearchPage(undefined)).toBe(1)
    expect(normalizeSearchPage('0')).toBe(1)
    expect(normalizeSearchPage('-3')).toBe(1)
    expect(normalizeSearchPage('abc')).toBe(1)
    expect(normalizeSearchPage('2')).toBe(2)
    expect(normalizeSearchPage('9999')).toBe(searchMaxPage())
    expect(searchMaxPage()).toBe(Math.floor(SEARCH_MAX_OFFSET / SEARCH_PAGE_SIZE) + 1)
  })

  it('可分享的 URL：第 1 页省略 page，查询词按 URL 编码', () => {
    expect(searchHref({ q: 'AI 工具' })).toBe('/search?q=AI+%E5%B7%A5%E5%85%B7')
    expect(searchHref({ q: 'AI 工具', page: 1 })).toBe('/search?q=AI+%E5%B7%A5%E5%85%B7')
    expect(searchHref({ q: 'AI 工具', page: 3 })).toBe('/search?q=AI+%E5%B7%A5%E5%85%B7&page=3')
    expect(searchHref({ q: 'react', page: 9999 })).toBe(`/search?q=react&page=${searchMaxPage()}`)
    expect(searchHref()).toBe('/search')
    expect(searchHref({ q: '   ' })).toBe('/search')
  })

  it('中枢取数路径：status=active 且 offset 由页码推出', () => {
    const params = new URLSearchParams(searchApiPath('react', 3).split('?')[1])
    expect(params.get('q')).toBe('react')
    expect(params.get('status')).toBe('active')
    expect(params.get('limit')).toBe(String(SEARCH_PAGE_SIZE))
    expect(params.get('offset')).toBe(String(2 * SEARCH_PAGE_SIZE))
  })

  it('巡检异常的补取只换 status，其余参数与主查询同口径', () => {
    const broken = new URLSearchParams(searchApiPath('ChatGPT', 1, 'ai', { status: 'broken' }).split('?')[1])
    expect(broken.get('status')).toBe('broken')
    expect(broken.get('q')).toBe('ChatGPT')
    expect(broken.get('tag')).toBe('ai')
    expect(broken.get('offset')).toBe('0')
    // 不传 opts 时仍是 active：正常检索不该把巡检打不开的站点混进来
    expect(new URLSearchParams(searchApiPath('ChatGPT', 1).split('?')[1]).get('status')).toBe('active')
  })

  it('offset 上限与中枢 zod 契约同值（改一处必须改另一处）', () => {
    const api = repoFile('apps/api/src/routes/search.ts')
    expect(api).toContain(`offset: z.coerce.number().int().min(0).max(${SEARCH_MAX_OFFSET})`)
  })

  it('查询词上限与 core 常量同值（web 不依赖 core，只能同构一份）', () => {
    const core = repoFile('packages/core/src/search-limits.ts')
    expect(core).toContain(`MAX_SEARCH_QUERY_LENGTH = ${SEARCH_QUERY_MAX_LENGTH}`)
  })

  it('页码窗口不发明没验证过的页：hasMore 时最多多看一格', () => {
    expect(searchPageWindow(1, true)).toEqual([1, 2])
    expect(searchPageWindow(10, true)).toEqual([7, 8, 9, 10, 11])
    expect(searchPageWindow(10, false)).toEqual([6, 7, 8, 9, 10])
    expect(searchPageWindow(1, false)).toEqual([1])
  })

  it('标签归一：与查询词同一套去噪，空串表示「没有标签筛选」', () => {
    expect(normalizeSearchTag(' ai\u0000  工具 ')).toBe('ai 工具')
    expect(normalizeSearchTag('x'.repeat(SEARCH_TAG_MAX_LENGTH + 10))).toHaveLength(SEARCH_TAG_MAX_LENGTH)
    // 中枢按 slug/名称/别名三路匹配，名称里的空格必须原样保留，不能 slug 化
    expect(normalizeSearchTag('开发工具')).toBe('开发工具')
    expect(normalizeSearchTag(['ai', 'web'])).toBe('ai')
    expect(normalizeSearchTag(undefined)).toBeNull()
    expect(normalizeSearchTag('   ')).toBeNull()
  })

  it('标签进 URL 与取数路径：只浏览某个标签也是合法查询', () => {
    expect(searchHref({ tag: 'ai' })).toBe('/search?tag=ai')
    expect(searchHref({ q: 'react', tag: 'ai' })).toBe('/search?q=react&tag=ai')
    expect(searchHref({ q: 'react', tag: 'ai', page: 3 })).toBe('/search?q=react&tag=ai&page=3')
    // 换标签时调用点不传 page，页码自然回到第 1 页
    expect(searchHref({ tag: 'ai' })).not.toContain('page=')
    const tagged = new URLSearchParams(searchApiPath('', 1, 'ai').split('?')[1])
    expect(tagged.get('q')).toBe('')
    expect(tagged.get('tag')).toBe('ai')
    const untagged = new URLSearchParams(searchApiPath('react', 1).split('?')[1])
    expect(untagged.get('tag')).toBeNull()
  })

  it('标签上限与中枢 zod 契约同值', () => {
    const api = repoFile('apps/api/src/routes/search.ts')
    expect(api).toContain(`tag: z.string().max(${SEARCH_TAG_MAX_LENGTH})`)
  })

  it('中枢从查询里理解出的 #标签 / @分类 / 分面要说出来（生效与放宽共用一套措辞）', () => {
    expect(inferredConditionLabels({})).toEqual([])
    expect(inferredConditionLabels({ inferredTag: 'ai' })).toEqual(['标签「ai」'])
    expect(inferredConditionLabels({ inferredCategory: 'design' })).toEqual(['分类「design」'])
    expect(
      inferredConditionLabels({ inferredFacets: { pricing: ['free'], scene: ['dev', 'ai'], unknownKey: ['x'] } }),
    ).toEqual(['付费模式「free」', '场景「dev / ai」', 'unknownKey「x」'])
    // 空数组的分面轴不产出条件，否则会渲染成「平台「」」这种空话
    expect(inferredConditionLabels({ inferredFacets: { platform: [] } })).toEqual([])
  })
})

describe('/search 页面契约', () => {
  it('声明 noindex,follow，并带自己的标题与描述（route-titles 的口径）', () => {
    const src = overlaySource('src/app/search/page.tsx')
    expect(src).toContain('robots: { index: false, follow: true }')
    // 显式 `title:` / `description:`：route-titles.test.ts 靠这个识别标题来源
    expect(src).toMatch(/title:\s*title/)
    expect(src).toMatch(/description:\s*description/)
  })

  it('服务端直出：hubGet 走 /api/search 契约，视图不是客户端组件', () => {
    expect(overlaySource('src/lib/server/search.ts')).toContain('hubGet<HubSearchResult>(searchApiPath(')
    const view = overlaySource('src/app/search/search-results.tsx')
    expect(view).not.toContain("'use client'")
    expect(view).toContain('href={`/site/${encodeURIComponent(site.id)}`}')
  })

  it('整页只剩语义近似命中时如实标注（语义 KNN 对乱码也给最近邻）', () => {
    const view = overlaySource('src/app/search/search-results.tsx')
    expect(view).toContain('semanticOnly')
    expect(view).toContain('均为语义近似，无关键词命中')
    // 标签筛选/兜底路径的 contributions 是 {}，空对象 every() 恒真，必须要求通道非空
    expect(view).toContain("channels.length > 0 && channels.every((channel) => channel === 'semantic')")
  })

  it('标签筛选贯通：解析 → 取数 → 视图，提交关键词时保留筛选', () => {
    const page = overlaySource('src/app/search/page.tsx')
    expect(page).toContain('normalizeSearchTag(sp.tag)')
    expect(page).toContain('q || tag ?')
    expect(page).toContain('loadSearchPage(q, page, tag)')
    expect(page).toContain('tag={tag}')

    expect(overlaySource('src/lib/server/search.ts')).toContain('searchApiPath(q, page, tag)')

    const view = overlaySource('src/app/search/search-results.tsx')
    // 结果行的标签是筛选入口：点标签看该标签下的全部站点
    expect(view).toContain('href={searchHref({ tag })}')
    expect(view).toContain('标签：{tag}')
    expect(view).toContain('去掉筛选')
    // 隐藏域不进无障碍树，标成装饰性控件（field-names 门禁同口径）
    expect(view).toContain('<input type="hidden" name="tag" value={tag} aria-hidden="true" />')
    // 分页与重试不得丢标签
    expect(view).toContain('searchHref({ q, page: page - 1, tag })')
    expect(view).toContain('searchHref({ q, page, tag })')
  })

  it('中枢放宽筛选时必须如实说明：全站结果不能冒充「在标签下」', () => {
    const view = overlaySource('src/app/search/search-results.tsx')
    // 中枢零命中会带 fallback=filter 重试（结果已不满足筛选条件）
    expect(view).toContain("result?.fallback === 'filter'")
    expect(view).toContain('const tagApplied = tag !== null && !filterRelaxed')
    expect(view).toContain('已放宽为更宽的结果')
    expect(view).toContain('不保证符合该标签')
    // 查询里的 #/@ 算子也会被放宽：放宽时要点名是哪些条件没命中
    expect(view).toContain('查询里的条件')
    expect(view).toContain('inferredConditionLabels(result)')
    // 条件真的生效时同样留痕，否则用户不知道结果为什么变少
    expect(view).toContain('已理解查询条件')
    // 放宽后不再显示生效中的标签筛选条，也不再随分页传递标签
    expect(view).toContain('{tagApplied ? <input type="hidden" name="tag"')
    // 模糊放宽（前缀→包含/逐词 OR）同样留痕
    expect(view).toContain("result?.fallback === 'fuzzy'")
    expect(view).toContain('已放宽匹配范围')
  })

  it('检索算子自带用法提示：不写出来没人会试 #标签 / @分类', () => {
    const view = overlaySource('src/app/search/search-results.tsx')
    expect(view).toContain('#标签')
    expect(view).toContain('@分类')
    // 示例必须真实可用（hub 实测 #开源 react、@开发工具 编辑器都有命中）
    expect(view).toContain('#开源 react')
    expect(view).toContain('@开发工具 编辑器')
  })

  it('负向过滤（-词）会悄悄缩小结果：用法要写出来，生效时要点名排除了什么', () => {
    const view = overlaySource('src/app/search/search-results.tsx')
    // 算子提示里补上 -词 与一个真实可用的示例
    expect(view).toContain('-词')
    expect(view).toContain('排除关键词')
    expect(view).toContain('笔记 -广告')
    // 中枢在 excludedTerms 里回报被排除的词；视图必须取出来并如实说明
    expect(view).toContain('result?.excludedTerms')
    expect(view).toContain('已排除关键词：{excluded.join')
  })

  it('巡检打不开的站点不静默消失：第 1 页补取 broken，按字面命中过滤并如实分区展示', () => {
    const server = overlaySource('src/lib/server/search.ts')
    expect(server).toContain("searchApiPath(q, page, tag, { status: 'broken' })")
    expect(server).toContain('isLexicalHit')
    // 只有第 1 页非空查询才补取（翻页语义与空检索不该多打一次中枢）
    expect(server).toContain('page === 1 && q')
    // 只在 broken 池里挑字面命中：语义近邻不算
    expect(server).toContain('hit.site && isLexicalHit(hit)')
    // 主结果已经展示过的同名站点不再重复出现（Cursor 有两条记录）
    expect(server).toContain('shownTitles')
    // 补取失败保持空列表：整页的「服务没响应」只由主查询决定
    expect(server).toContain('broken?.hits')

    const page = overlaySource('src/app/search/page.tsx')
    expect(page).toContain('unavailable')

    const view = overlaySource('src/app/search/search-results.tsx')
    expect(view).toContain('巡检打不开')
    expect(view).toContain('401/403')
    expect(view).toContain('不代表站点已下线')
    // 有匹配的不可用站点时不得同时渲染「没有找到」空态，否则自相矛盾
    expect(view).toContain('hits.length === 0 && unavailable.length === 0')
    expect(view).toContain('<UnavailableSection hits={unavailable} q={q} />')
  })

  it('/me/history 的「再次搜索」指向真实存在的 /search，而不是无人消费的 /?q=', () => {
    const src = overlaySource('src/app/me/history/page.tsx')
    expect(src).not.toContain('/?q=')
    expect(src).toContain('/search?q=')
  })

  it('两个搜索入口都提供通往结果页的链接', () => {
    for (const rel of ['src/components/search-palette.tsx', 'src/components/search/spotlight-modal.tsx']) {
      const src = overlaySource(rel)
      expect(src, rel).toContain('searchHref({ q: query })')
      expect(src, rel).toContain('查看全部')
    }
  })
})
