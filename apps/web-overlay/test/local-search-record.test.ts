import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 页内搜索进搜索历史的接线锁。
 *
 * 走查发现：分类/热榜/标签/目录/合集页的筛选框是本机即时过滤，没有「提交」
 * 动作，用户在里面搜「考研」「微信」永远进不了搜索历史；全局搜索走
 * /api/search 记历史，两边用的不是同一条记录。
 *
 * 本测试钉住三件事：
 * 1. 记录入口：useLocalSearchRecorder（停手 800ms 记一次）+ 轻量模块
 *    search-history-record 的 recordLocalSearchHistory（POST
 *    /api/search-history，只记历史不跑检索）；
 * 2. 五处页内筛选框都接上同一条记录，计数取当时实际展示的匹配数；
 * 3. 点击历史条目能重搜：历史页条目链到 /search?q=<编码后的查询词>。
 *
 * 去重口径在服务端（recordSearch 5 分钟窗口内同一查询只刷新、不新增行），
 * 行为断言见 apps/api/test/api.test.ts 与 packages/store/test/store.test.ts；
 * 这里只锁前端接线：同一词多次搜索只应调一次记录入口，靠停手防抖 + 服务端
 * 窗口共同保证，不在组件里做第二道去重。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const HOOK = 'src/lib/local-search-record.ts'
const API = 'src/lib/search-history-record.ts'
const HISTORY_PAGE = 'src/app/me/history/page.tsx'

/** 五处页内筛选框：文件 → 调用时传的计数字段（当时实际展示的匹配数） */
const CALL_SITES: ReadonlyArray<{ file: string; count: string }> = [
  { file: 'src/components/category-site-filter-bar.tsx', count: 'matchedCount' },
  { file: 'src/components/sites-directory-filterable-grid.tsx', count: '(matches ?? []).length' },
  { file: 'src/components/tag-results-board.tsx', count: 'filteredSites.length' },
  { file: 'src/app/hot/hot-view.tsx', count: "tab === 'trending' ? filteredTrending.length : tab === 'new' ? filteredFresh.length : filteredPluginTotal" },
  { file: 'src/app/collections/[slug]/collection-detail-view.tsx', count: 'filteredSites.length' },
]

describe('页内搜索进搜索历史', () => {
  it('记录 hook 存在：停手 800ms 记一次，身份未就绪 / 空查询不记', () => {
    const src = overlayFile(HOOK)
    expect(src).toContain('export const LOCAL_SEARCH_RECORD_DEBOUNCE_MS = 800')
    expect(src).toContain('export function useLocalSearchRecorder(query: string, resultCount: number): void')
    expect(src).toContain('const q = query.trim()')
    expect(src).toContain('if (!ready || !identity || !q) return')
    expect(src).toContain('clearTimeout(timerRef.current)')
    expect(src).toContain('setTimeout(() => {')
    expect(src).toContain('LOCAL_SEARCH_RECORD_DEBOUNCE_MS')
    expect(src).toContain('void recordLocalSearchHistory(identity, q, capturedCount)')
    expect(src).toContain('Math.max(0, Math.trunc(resultCount))')
  })

  it('记录入口发 POST /api/search-history：只记历史，带真实命中数与本机开关', () => {
    const src = overlayFile(API)
    expect(src).toContain('export async function recordLocalSearchHistory(')
    expect(src).toContain("'/api/search-history'")
    expect(src).toContain('resultCount: Math.max(0, Math.trunc(resultCount))')
    expect(src).toContain('searchHistoryEnabled: readLocalUserSettings().searchHistoryEnabled')
    expect(src).toContain('anonHeaders(identity)')
    expect(src).toContain('if (!q || !identity) return false')
    expect(src).toContain('res?.ok === true && res?.recorded === true')
  })

  it('五处页内筛选框都调用同一条记录，计数取当前匹配数', () => {
    for (const site of CALL_SITES) {
      const src = overlayFile(site.file)
      expect(src, site.file).toContain("import { useLocalSearchRecorder } from '@/lib/local-search-record'")
      expect(src, site.file).toContain(`useLocalSearchRecorder(`)
      expect(src, site.file).toContain(site.count)
    }
  })

  it('点击历史条目可重搜：条目与再次搜索按钮都链到 /search?q=<编码查询词>', () => {
    const src = overlayFile(HISTORY_PAGE)
    expect(src).toContain('href={`/search?q=${encodeURIComponent(item.query)}`}')
    expect(src).toContain('aria-label={`再次搜索 ${item.query}`}')
  })
})
