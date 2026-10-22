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
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('/me：会话探测失败必须落 error，不得落 anonymous', () => {
  // M5 起概览页 = 服务端壳（page.tsx）+ 客户端岛（me-view.tsx）。四态机整体搬到
  // 岛里，所以这里读联合文本：断言原意不变，代码在哪一半都能被看见。
  const src = ['src/app/me/page.tsx', 'src/app/me/me-view.tsx'].map(read).join('\n')

  it('非 2xx 与解析失败各有 error 分支', () => {
    expect(src).toContain('if (!sessionRes.ok)')
    expect(src).toMatch(/setState\('error'\)/)
    // 解析失败也不能当匿名：catch(() => ({})) 会把失败吞成"无 user"
    expect(src).not.toContain('json().catch(() => ({}))')
  })

  it('未登录返回的字面量 null 是「没有会话」，不是故障', () => {
    // 回归锁（2026-10-22 E2E 抓到）：NextAuth 未登录时 /api/auth/session 返回
    // body 为字面量 null 的 200。把它当解析失败，会让每一个匿名访客都看到
    // 「登录状态暂时无法确认」——那是把事实说成故障，比原来的反向错误更糟。
    // 因此只用「解析抛错」当故障：body 为 null / {} 一律走匿名分支。
    expect(src).not.toContain('session === null')
    expect(src).toMatch(/parsed === undefined/)
    expect(src).toMatch(/parsed \?\? \{\}/)
  })

  it('error 态提供重试入口', () => {
    expect(src).toMatch(/state === 'error'[\s\S]{0,800}重试/)
  })
})

describe('/me/data：会话探测失败必须落 error（可重试）', () => {
  const src = read('src/app/me/data/page.tsx')

  it("ViewState 包含 'error' 且不复用 anonymous", () => {
    expect(src).toMatch(/type ViewState = .*'error'/)
    expect(src).toContain('if (!res.ok)')
    expect(src).toContain('setState(\'error\')')
  })

  it('未登录返回的字面量 null 走 anonymous，不是 error', () => {
    expect(src).not.toContain("session === null ? 'error'")
    expect(src).toMatch(/parsed === undefined/)
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
    expect(src).toMatch(/if \(degraded\) \{[\s\S]{0,80}setState\('error'\)/)
  })

  it('降级与「确实为空」是两个互斥分支，不会共用同一段渲染', () => {
    expect(src).toMatch(/if \(degraded\) \{[\s\S]{0,80}setState\('error'\)/)
    expect(src).toContain("state === 'ready' && items.length === 0")
    expect(src).toContain("state === 'error'")
  })
})
