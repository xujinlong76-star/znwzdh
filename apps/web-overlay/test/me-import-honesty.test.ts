/**
 * F4 档 2：`/api/me/import` 的恢复台账必须在界面上说得出来，也要真能接着导完。
 *
 * 改之前的三处假话／死路（apps/api/src/routes/me.ts + apps/web-overlay/src/app/me/data/page.tsx）：
 *   1. 导入上限低于导出上限（folders 100 / favorites 2000 / history 1000，
 *      而 `EXPORT_HISTORY_LIMIT = 5000`）：用户拿一份**合法导出**的备份来恢复，
 *      会因为某个数组超长被整份 400，收藏、收藏夹、偏好设置一起导不进来；
 *   2. 搜索历史单次只写前 200 条，剩余条数不申报，界面写「恢复完成」——
 *      而且窗口起点写死 0，用户按提示「再导一次」永远重复同一批，尾巴根本导不进来；
 *   3. `favoritesSkipped` 把「站点已下架」与「你已经收藏过」混成一个数，
 *      `settings` 校验失败则完全静默（`settingsRestored` 只是 false，没有原因）。
 *
 * 现在服务端逐因回传（searchesTruncated / searchesSkippedDuplicate / nextHistoryOffset /
 * favoritesSkippedMissingSite / settingsError / backupHistoryTruncated / 两个上限）。
 * 本文件钉住的是**接线**：界面必须读这些字段、必须渲染出来、必须按它们切换语气，
 * 并且「继续导入剩余」真的把 offset 回填进请求——闸门代码不许没人调用。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function existsRead(p: string): boolean {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
}

/** overlay 真相文件（镜像 apps/web/** 由门禁保持同步，这里优先读 overlay） */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsRead(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** 仓库根视角的文件（服务端契约） */
function repoFile(rel: string): string {
  const p = resolve(HERE, '..', '..', '..', rel)
  if (!existsRead(p)) throw new Error('无法定位仓库文件 ' + rel + '（' + p + '）')
  return readFileSync(p, 'utf8')
}

/** 只留代码：注释里会引用「无损导入」当反面教材，全文断言会被自己顶穿 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const page = overlayFile('src/app/me/data/page.tsx')
const route = repoFile('apps/api/src/routes/me.ts')

/** 服务端为「恢复了多少 / 为什么没恢复全」回传的字段 */
const REPORT_FIELDS = [
  'foldersImported',
  'favoritesImported',
  'favoritesSkipped',
  'favoritesSkippedMissingSite',
  'searchesImported',
  'searchesSkippedDuplicate',
  'searchesTruncated',
  'settingsRestored',
  'settingsError',
  'backupHistoryTruncated',
  'historyExportLimit',
  'historyImportCap',
  'nextHistoryOffset',
] as const

describe('备份导入的服务端台账字段一个都不许留在响应里没人读', () => {
  it.each(REPORT_FIELDS)('响应确实回传 %s', (field) => {
    expect(new RegExp(`\\b${field}\\b`).test(route)).toBe(true)
  })

  it.each(REPORT_FIELDS)('界面把 %s 从响应里取出来', (field) => {
    expect(new RegExp(`data\\.${field}\\b`).test(page)).toBe(true)
  })

  it.each(REPORT_FIELDS)('界面把 %s 渲染给用户看', (field) => {
    expect(new RegExp(`importResult\\.${field}\\b`).test(page)).toBe(true)
  })
})

describe('「继续导入剩余」必须真的接着上一窗口往下导', () => {
  it('请求体带上服务端给的窗口起点', () => {
    expect(page).toContain('searchHistoryOffset: offset')
  })

  it('按钮用的就是响应里的 nextHistoryOffset，不自己算也不写死 200', () => {
    expect(/submitImport\(lastBackupRef\.current!, importResult\.nextHistoryOffset!\)/.test(page)).toBe(true)
    expect(page).toMatch(/importResult\.nextHistoryOffset !== null/)
  })

  it('备份原文留在 ref 里供续导复用（不进 state，免得几千克的数据触发重渲染）', () => {
    expect(/const lastBackupRef = useRef<Record<string, unknown> \| null>\(null\)/.test(page)).toBe(true)
    expect(/lastBackupRef\.current = parsedPayload/.test(page)).toBe(true)
  })

  it('服务端用 searchHistoryOffset 决定窗口，并 clamp 到备份长度', () => {
    expect(route).toContain('searchHistoryOffset: z.number().int().min(0)')
    expect(route).toContain('Math.min(parsed.data.searchHistoryOffset ?? 0, rawHistoryList.length)')
    expect(route).toContain('rawHistoryList.slice(windowStart, windowStart + HISTORY_IMPORT_CAP)')
  })
})

describe('语气随台账切换，不再保证无法验证的结果', () => {
  it('只要有任何没恢复的内容就用告警语气', () => {
    expect(page).toMatch(/variant: lost > 0 \? 'destructive' : 'default'/)
    expect(page).toMatch(/const lost =\s*result\.favoritesSkippedMissingSite \+ result\.searchesTruncated/)
  })

  it('站点已下架与已收藏分开说', () => {
    expect(route).toContain('favoritesSkippedMissingSite += 1')
    expect(page).toContain('importResult.favoritesSkipped - importResult.favoritesSkippedMissingSite')
  })

  it('0 条导入要能解释成「账户里已有」，而不是让人以为备份是空的', () => {
    expect(route).toContain('searchesSkippedDuplicate += 1')
    expect(page).toContain('importResult.searchesSkippedDuplicate')
  })

  it('导入这条链路上不再有「无损 / 全量 / 一键恢复」这类无法验证的断言', () => {
    const start = page.indexOf('从 JSON 备份导入与恢复')
    const scopes = {
      handler: codeOnly(page.slice(page.indexOf('const submitImport'), page.indexOf('const handlePruneDomain'))),
      panel: codeOnly(page.slice(start, page.indexOf('<h2', start))),
    }
    for (const [name, src] of Object.entries(scopes)) {
      expect(src, name).not.toContain('无损')
      expect(src, name).not.toContain('全量')
      expect(src, name).not.toContain('一键恢复')
      expect(src, name).toContain('没能恢复')
    }
    expect(route).not.toContain('无损导入')
  })

  it('备份本身被导出侧截断过时，界面把这句话带到', () => {
    expect(route).toContain('const backupHistoryTruncated =')
    expect(page).toContain('importResult.backupHistoryTruncated')
    expect(page).toContain('importResult.historyExportLimit')
  })

  it('非法 JSON 与非对象备份在发请求前就拦下，不静默吞掉', () => {
    const handler = page.slice(page.indexOf('const handleImportBackup'))
    expect(handler).toContain("备份文件不是合法的 JSON 格式，请检查文件内容")
    expect(handler).toContain('Array.isArray(parsedPayload)')
    expect(handler).toContain('setError(')
  })
})

describe('上限口径：导入侧必须容得下导出侧产出的备份', () => {
  it('历史导入上限不高于导出上限，且由服务端回传', () => {
    expect(route).toMatch(/const HISTORY_IMPORT_CAP = (\d+);/)
    const cap = Number(route.match(/const HISTORY_IMPORT_CAP = (\d+);/)![1])
    expect(cap).toBeGreaterThan(0)
    expect(route).toContain('historyImportCap: HISTORY_IMPORT_CAP')
    expect(route).toContain('.max(EXPORT_HISTORY_LIMIT)')
  })

  it('超条数的 400 点名是哪个字段，不再只说「格式无效」', () => {
    expect(route).toContain('i.code === "too_big"')
    expect(route).toContain('i.path.join(".")')
  })
})
