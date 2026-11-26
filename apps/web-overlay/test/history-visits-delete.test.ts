/**
 * U-375：访问历史 tab 矮一截——无单条删除、清空删画像、断网直接 error。
 *
 * 复现（纯 main be8fb8c5）：
 *  - 无单条 DELETE 端点/UI：apps/api/src/routes/me.ts 只有 GET /api/me/visits；
 *    page.tsx 访问列表行里无删除按钮（只有搜索 tab 有 removeItem）。
 *  - clearVisits 仍走 clearProfileSignals(identity, 'click')，即删画像信号并
 *    立即重建画像；toast 还写「画像已按剩余行为重建」。
 *  - 20 条离线快照只在搜索 tab：访问 tab loadVisits 降级直接落 error，
 *    无快照读写、无快照横幅。
 *
 * 体例：源码文本断言（vitest 无 jsdom）+ 中枢路由注册断言。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function repoSource(rel: string): string {
  // 本文件经 mirror:web 同步到 apps/web/test 运行：HERE=apps/web/test，
  // 三级 .. 才到仓库根。
  return readFileSync(resolve(HERE, '..', '..', '..', rel), 'utf8')
}

const PAGE = overlaySource('src/app/me/history/page.tsx')
const API = overlaySource('src/lib/navhub-api.ts')
const ME_ROUTES = repoSource('apps/api/src/routes/me.ts')
const POLICY = overlaySource('src/lib/hub-route-policy.generated.ts')

describe('U-375：单条删除端点（中枢 + BFF 透传 + 客户端）', () => {
  it('中枢有 DELETE /api/me/visits/:id，只删本身份的一条 click 事件', () => {
    expect(ME_ROUTES).toMatch(/app\.delete\(\s*"\/api\/me\/visits\/:id"/)
  })

  it('路由策略表已重新生成，含该 DELETE 路由', () => {
    expect(POLICY).toContain('{ method: "DELETE", path: "/api/me/visits/:id"')
  })

  it('客户端有 deleteVisitItem，走 /api/me/visits/:id', () => {
    expect(API).toContain('export async function deleteVisitItem')
    expect(API).toContain("'/api/me/visits/' + id")
  })

  it('访问列表每行有两步确认删除按钮（与搜索 tab 同口径）', () => {
    const visitIdx = PAGE.indexOf("{tab === 'visits' && (")
    const visitBlock = PAGE.slice(visitIdx)
    expect(visitBlock).toContain('confirmDeleteVisitId')
    expect(visitBlock).toContain('确认删除')
    expect(visitBlock).toContain('onClick={() => void removeVisit(v.id)}')
    // 删除调用在 removeVisit 回调里（JSX 之前定义），不在 visits JSX 块内。
    const cbStart = PAGE.indexOf('const removeVisit = useCallback')
    expect(cbStart).toBeGreaterThanOrEqual(0)
    const cbBody = PAGE.slice(cbStart, PAGE.indexOf('}, [', cbStart))
    expect(cbBody).toContain('deleteVisitItem(identity,')
  })
})

describe('U-375：清空与画像清理分离', () => {
  it('中枢有 DELETE /api/me/visits（只清访问流水，不动画像行）', () => {
    expect(ME_ROUTES).toMatch(/app\.delete\(\s*"\/api\/me\/visits"/)
    // 集合 DELETE 不得调画像重建/信号清理。
    const start = ME_ROUTES.search(/app\.delete\(\s*"\/api\/me\/visits"/)
    const block = ME_ROUTES.slice(start, start + 3000)
    expect(block).not.toContain('refreshUserProfile')
    expect(block).not.toContain('resetUserProfile')
  })

  it('路由策略表含集合 DELETE 路由', () => {
    expect(POLICY).toContain('{ method: "DELETE", path: "/api/me/visits"')
  })

  it('客户端 clearVisits 走新端点，不再走 clearProfileSignals', () => {
    expect(API).toContain('export async function clearVisits')
    expect(API).toContain("'/api/me/visits'")
    const start = PAGE.indexOf('const clearVisits = useCallback')
    const body = PAGE.slice(start, PAGE.indexOf('}, [', start))
    expect(body).toContain('clearCloudVisits(identity)')
    expect(body).not.toContain("clearProfileSignals(identity, 'click')")
  })

  it('清空 toast 不再声称「画像已重建」', () => {
    expect(PAGE).not.toContain('画像已按剩余行为重建')
  })
})

describe('U-375：访问 tab 复用 20 条离线快照', () => {
  it('loadVisits 降级时读快照展示，而不是直接落 error', () => {
    const start = PAGE.indexOf('const loadVisits = useCallback')
    const body = PAGE.slice(start, PAGE.indexOf('}, [', start))
    expect(body).toContain('readVisitSnapshot()')
    expect(body).toContain('setVisitOfflineSnapshotAt(')
  })

  it('成功取回后写快照（只存最近 20 条）', () => {
    const start = PAGE.indexOf('const loadVisits = useCallback')
    const body = PAGE.slice(start, PAGE.indexOf('}, [', start))
    expect(body).toContain('writeVisitSnapshot(')
    expect(PAGE).toContain('HISTORY_VISIT_SNAPSHOT_MAX = 20')
  })

  it('快照态有如实标注横幅（与搜索 tab 同口径）', () => {
    const visitIdx = PAGE.indexOf("{tab === 'visits' && (")
    const visitBlock = PAGE.slice(visitIdx)
    expect(visitBlock).toContain('visitOfflineSnapshotAt')
    expect(visitBlock).toContain('正在展示本机离线快照')
  })

  it('清空成功后同步删快照键，否则已清空的历史会被快照「复活」', () => {
    const start = PAGE.indexOf('const clearVisits = useCallback')
    const body = PAGE.slice(start, PAGE.indexOf('}, [', start))
    expect(body).toContain('clearVisitHistorySnapshot()')
  })
})
