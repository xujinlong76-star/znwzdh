/**
 * F4 档 3：订阅源同步的条数台账必须一路带到管理员眼前。
 *
 * 改之前（apps/api/src/routes/plugins.ts 的 POST /api/plugins/taps/:id/sync）：
 *   - `if (!validated.ok) continue` / `if (existingNames.has(...)) continue` 什么都不留，
 *     管理员只看到 toast「发现 40 个条目，成功导入/更新 3 个」——剩下 37 个是重名、
 *     清单不合规、写库失败，还是被上限截断？无从判断，也谈不上修订阅源；
 *   - `targetTap.pluginCount = fetchedCount` 把「抓到多少条」当成「本源有几个插件」
 *     写进订阅源记录，列表徽标于是长期虚高；
 *   - 更早修好的 `truncated` 字段其实没人读：客户端类型里连声明都没有。
 *
 * 现在服务端逐因回传，界面必须一个不落地渲染，并且不许再写「导入/更新」
 * （本源从来没有更新已存在插件的路径，只有跳过）。
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

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsRead(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function repoFile(rel: string): string {
  const p = resolve(HERE, '..', '..', '..', rel)
  if (!existsRead(p)) throw new Error('无法定位仓库文件 ' + rel + '（' + p + '）')
  return readFileSync(p, 'utf8')
}

/** 只留代码：注释里会引用「导入/更新」当反面教材，全文断言会被自己顶穿 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const route = repoFile('apps/api/src/routes/plugins.ts')
const client = overlayFile('src/lib/navhub-api.ts')
const modal = overlayFile('src/components/plugins/plugin-taps-modal.tsx')

/** 服务端在 sync 响应里回传的台账字段 */
const LEDGER_FIELDS = [
  'fetchedCount',
  'processedCount',
  'importedCount',
  'skippedDuplicate',
  'rejectedInvalid',
  'failedWrite',
  'truncated',
  'importCap',
] as const

describe('订阅源同步台账：服务端报了，客户端与界面都得接着', () => {
  it.each(LEDGER_FIELDS)('sync 响应回传 %s', (field) => {
    expect(new RegExp(`\\b${field}[,:]`).test(route)).toBe(true)
  })

  it.each(LEDGER_FIELDS)('客户端类型声明 %s（漏了就会被 hub 代理静默吃掉）', (field) => {
    const block = client.slice(client.indexOf('interface PluginTapSyncResult'))
    expect(new RegExp(`\\b${field}:`).test(block)).toBe(true)
  })

  it('界面把每一个非零去向都渲染出来，而不是只报导入数', () => {
    const handler = modal.slice(modal.indexOf('const handleSync'))
    for (const field of ['skippedDuplicate', 'rejectedInvalid', 'failedWrite', 'truncated', 'importCap', 'processedCount']) {
      expect(new RegExp(`res\\.${field}\\b`).test(handler)).toBe(true)
    }
    // 上限截断的尾巴要给出「还剩多少条没处理」和「请再次同步」，不能只说 truncated=true
    expect(handler).toContain('请再次同步')
  })

  it('有任何没导入的内容就用告警语气，不再一律 success', () => {
    const handler = modal.slice(modal.indexOf('const handleSync'))
    expect(handler).toMatch(/toast\.warning\(message\)/)
    expect(handler).toMatch(/res\.rejectedInvalid > 0 \|\| res\.failedWrite > 0 \|\| res\.truncated/)
  })

  it('不再声称会「更新」已存在的插件（这条路径根本不存在）', () => {
    expect(codeOnly(modal)).not.toContain('导入/更新')
    // 已存在同名只是跳过：市场里的旧条目内容不会被本源覆盖
    expect(route).toContain('skippedDuplicate += 1')
    expect(route).not.toContain('updatePlugin(manifest')
  })

  it('徽标的 N 是「本源在市场里可见的条数」，不是抓到的条数', () => {
    expect(route).toContain('targetTap.pluginCount = importedCount + skippedDuplicate')
    expect(route).not.toContain('targetTap.pluginCount = fetchedCount')
    expect(modal).toContain('市场内 {tap.pluginCount ?? 0} 个插件')
  })
})
