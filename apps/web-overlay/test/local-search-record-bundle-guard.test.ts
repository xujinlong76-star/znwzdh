import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * /sites 首屏预算守卫：页内筛选的查询记录必须走轻量模块，不能再把
 * 134KB 的 navhub-api.ts 值 import 进 /sites 首屏 chunk。
 *
 * 背景：CI /sites 与 /sites/p/[n] 各超预算 57KB（预算 747KB），根因是
 * lib/local-search-record.ts 从 navhub-api 值 import recordLocalSearchHistory，
 * 首屏因此拖入整个中枢客户端。拆法：函数原样平移到
 * lib/search-history-record.ts（仅依赖 fetch + 轻量开关读取），hook 改
 * import 源；navhub-api.ts 只留薄 re-export 兼容旧调用方。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..', '..', 'web-overlay')

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel)
  if (!existsSync(p)) throw new Error('overlay 缺少文件 ' + rel)
  return readFileSync(p, 'utf8')
}

describe('/sites 包体积：搜索记录走轻量模块', () => {
  it('记录 hook 不再 import navhub-api', () => {
    const s = overlayFile('src/lib/local-search-record.ts')
    expect(s).not.toContain("from '@/lib/navhub-api'")
    expect(s).not.toContain('from "./navhub-api"')
    expect(s).not.toContain("from './navhub-api'")
    expect(s).toContain("from '@/lib/search-history-record'")
  })

  it('轻量模块只依赖 fetch 与轻量开关读取，不回指 navhub-api', () => {
    const s = overlayFile('src/lib/search-history-record.ts')
    // 只锁 import 形式：头注释合理提及 navhub-api.ts 这一拆出源，不算依赖。
    expect(s).not.toContain("from './navhub-api'")
    expect(s).not.toContain("from '@/lib/navhub-api'")
    expect(s).toContain("from './user-settings'")
    expect(s).toContain("from './degrade'")
    const imports = [...s.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    for (const mod of imports) {
      expect(['./degrade', './user-settings'], mod).toContain(mod)
    }
  })

  it('记录入口语义一致：POST /api/search-history，带真实命中数与本机开关，失败静默', () => {
    const s = overlayFile('src/lib/search-history-record.ts')
    expect(s).toContain('export async function recordLocalSearchHistory(')
    expect(s).toContain("'/api/search-history'")
    expect(s).toContain('resultCount: Math.max(0, Math.trunc(resultCount))')
    expect(s).toContain('searchHistoryEnabled: readLocalUserSettings().searchHistoryEnabled')
    expect(s).toContain('anonHeaders(identity)')
    expect(s).toContain('if (!q || !identity) return false')
    expect(s).toContain('res?.ok === true && res?.recorded === true')
  })

  it('navhub-api 不再定义该函数，只留薄 re-export', () => {
    const s = overlayFile('src/lib/navhub-api.ts')
    expect(s).not.toContain('export async function recordLocalSearchHistory(')
    expect(s).toContain("export { recordLocalSearchHistory } from './search-history-record'")
  })

  it('目录页筛选框仍在：筛选输入与记录接线都在', () => {
    const s = overlayFile('src/components/sites-directory-filterable-grid.tsx')
    expect(s).toContain('placeholder="在全部站点中筛选（标题 / 链接 / 描述）..."')
    expect(s).toContain('aria-label="在全部站点中筛选"')
    expect(s).toContain("import { useLocalSearchRecorder } from '@/lib/local-search-record'")
    expect(s).toContain('useLocalSearchRecorder(filterQuery, (matches ?? []).length)')
  })
})
