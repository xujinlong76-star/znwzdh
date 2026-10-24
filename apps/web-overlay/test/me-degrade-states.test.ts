import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 用户中心「降级语义」守卫：故障 ≠ 匿名 ≠ 空。
 *
 * 历史事故：会话端点非 2xx 被渲染成「你是匿名，登录后可同步」；历史取数失败被
 * 渲染成「还没有搜索记录」。两者都是把故障说成事实，用户会据此做出错误判断
 * （以为账号掉了 / 历史被清空）。本文件把修复锁死。
 *
 * P1-1 分层：本文件只保留**分支与接线**断言（哪条路径落哪个 state、重试接到哪个
 * 函数）。渲染出来的文案由 `e2e/user-center.spec.ts` 断言——那里跑的是真实页面，
 * 改文案但改错分支会红在 E2E，改分支但文案没跟上也会红在 E2E。
 *
 * 会话探测后来收敛成唯一入口 `src/lib/client-session.ts`（同一次页面加载里
 * `/api/auth/session` 原来被打三次，「非 2xx / 解析失败 / 断网」的判据各写一份，
 * 改一处漏两处）。四态语义一个字没改，只是判据搬到了探测器、页面只把 `kind`
 * 落到 state。所以这里的守卫也连着读探测器：把判据改回压成一个 null 会红，
 * 页面把 error 排到 anonymous 后面同样会红。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('/me：会话探测失败必须落 error，不得落 anonymous', () => {
  const probe = read('src/lib/client-session.ts')
  // T1 起四态取数状态机唯一实现是 useMeOverview（me-view 只消费不再自带一份），守卫跟着搬到 hook
  const island = read('src/hooks/use-me-overview.ts')
  // M5 起概览页 = 服务端壳（page.tsx）+ 客户端岛（me-view.tsx）。四态机整体搬到
  // 岛里，所以这里读联合文本：断言原意不变，代码在哪一半都能被看见。
  const src = ['src/app/me/page.tsx', 'src/app/me/me-view.tsx'].map(read).join('\n')

  it('非 2xx 与解析失败各有独立故障类别（不压成同一个 null）', () => {
    expect(probe).toContain("if (!res.ok) return { kind: 'http' }")
    expect(probe).toContain("return { kind: 'parse' }")
    // 解析失败也不能当匿名：catch(() => ({})) 会把失败吞成"无 user"
    expect(probe).not.toContain('json().catch(() => ({}))')
  })

  it('岛把任何非 ok 探测落 error，且排在匿名判定之前', () => {
    expect(island).toMatch(/if \(probe\.kind !== 'ok'\) \{[\s\S]{0,400}setState\('error'\)\s*\n\s*return/)
    expect(island).toMatch(/if \(!probe\.session\.user\?\.id\) \{[\s\S]{0,300}setState\('anonymous'\)/)
    // 顺序即语义：先判故障再判「有没有 user」。反过来写，断网就会被说成「你是匿名」。
    expect(island.indexOf("probe.kind !== 'ok'")).toBeLessThan(island.indexOf('!probe.session.user?.id'))
  })

  it('未登录返回的字面量 null 是「没有会话」，不是故障', () => {
    // 回归锁（2026-10-22 E2E 抓到）：NextAuth 未登录时 /api/auth/session 返回
    // body 为字面量 null 的 200。把它当解析失败，会让每一个匿名访客都看到
    // 「登录状态暂时无法确认」——那是把事实说成故障，比原来的反向错误更糟。
    // 因此只用「解析抛错」当故障：body 为 null / {} 一律走匿名分支。
    expect(probe).toContain("session: parsed ?? {}")
    expect(probe).not.toContain('session === null')
    expect(island).toContain('!probe.session.user?.id')
  })

  it('解析失败与断网是两条可分的文案（故障种类不丢）', () => {
    expect(island).toContain('isNetworkSessionFailure(probe)')
    expect(island).toContain('网络不可用，未能加载用户中心')
    expect(island).toContain('登录状态暂时无法确认，请稍后重试')
  })

  it('error 态提供重试入口', () => {
    expect(src).toMatch(/state === 'error'[\s\S]{0,800}重试/)
  })
})

describe('/me/data：会话探测失败必须落 error（可重试）', () => {
  const src = read('src/app/me/data/page.tsx')

  it("ViewState 包含 'error' 且不复用 anonymous", () => {
    expect(src).toMatch(/type ViewState = .*'error'/)
    expect(src).toContain("if (probe.kind !== 'ok') {")
    expect(src).toContain('setState(\'error\')')
  })

  it('未登录返回的字面量 null 走 anonymous，不是 error', () => {
    expect(src).not.toContain("session === null ? 'error'")
    // 「有没有 user」由探测器归成 ok 之后才判：null body 落这一支，不落 error
    expect(src).toMatch(/if \(probe\.session\.user\?\.id\) \{[\s\S]{0,120}setState\('ready'\)/)
    expect(src).toMatch(/setState\('anonymous'\)/)
  })

  it('error 分支独立，重试接回 loadSession（文案由 E2E 断言）', () => {
    expect(src).toContain("state === 'error'")
    expect(src).toMatch(/state === 'error'[\s\S]{0,800}void loadSession\(\)/)
    expect(src).toContain('loadSession')
  })
})

describe('/me/history：降级必须落 error，不得渲染成空历史', () => {
  const src = read('src/app/me/history/page.tsx')

  it('load 传入 onDegraded 并在降级时提前返回', () => {
    expect(src).toContain('fetchSearchHistoryPage(id, { limit: PAGE_SIZE, offset: 0 }, () => {')
    // T24 起降级分支先试离线快照：快照态必须可分辨（offlineSnapshotAt 置位），
    // 没有快照才落纯 error——两条出口都不允许把故障渲染成「没有记录」
    expect(src).toMatch(/if \(degraded\) \{[\s\S]{0,900}readHistorySnapshot\(\)/)
    expect(src).toMatch(/if \(degraded\) \{[\s\S]{0,900}setState\('error'\)/)
  })

  it('降级与「确实为空」是两个互斥分支，不会共用同一段渲染', () => {
    expect(src).toMatch(/if \(snapshot\) \{[\s\S]{0,300}setOfflineSnapshotAt\(snapshot.at\)/)
    expect(src).toContain("state === 'ready' && items.length === 0")
    expect(src).toContain("state === 'error'")
    // 快照态明确标注「不是实时数据」，且写操作在快照态被禁用（快照不可作为写基础）
    expect(src).toContain('正在展示本机离线快照')
    expect(src).toMatch(/if \(!identity \|\| offlineSnapshotAt\) return/)
  })
})
