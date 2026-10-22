import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 用户中心「降级语义」守卫：故障 ≠ 匿名 ≠ 空。
 *
 * 历史事故：会话端点非 2xx 被渲染成「你是匿名，登录后可同步」；历史取数失败被
 * 渲染成「还没有搜索记录」。两者都是把故障说成事实，用户会据此做出错误判断
 * （以为账号掉了 / 历史被清空）。本文件把修复锁死。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('/me：会话探测失败必须落 error，不得落 anonymous', () => {
  // M5 起概览页 = 服务端壳（page.tsx）+ 客户端岛（me-view.tsx）。四态机整体搬到
  // 岛里，所以这里读联合文本：断言原意不变，代码在哪一半都能被看见。
  const src = ['src/app/me/page.tsx', 'src/app/me/me-view.tsx'].map(read).join('\n')

  it('非 2xx 与解析失败各有 error 分支', () => {
    expect(src).toContain('if (!sessionRes.ok)')
    expect(src).toContain('登录状态暂时无法确认')
    // 解析失败也不能当匿名：catch(() => ({})) 会把失败吞成"无 user"
    expect(src).not.toContain('json().catch(() => ({}))')
    expect(src).toContain('session === null')
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

  it('error 分支有说明与重试按钮', () => {
    expect(src).toMatch(/state === 'error'[\s\S]{0,500}重试/)
    expect(src).toContain('loadSession')
  })
})

describe('/me/history：降级必须落 error，不得渲染成空历史', () => {
  const src = read('src/app/me/history/page.tsx')

  it('load 传入 onDegraded 并在降级时提前返回', () => {
    expect(src).toContain('fetchSearchHistoryPage(id, { limit: PAGE_SIZE, offset: 0 }, () => {')
    expect(src).toMatch(/if \(degraded\) \{[\s\S]{0,80}setState\('error'\)/)
  })

  it('error 分支文案明确"不代表历史被清空"', () => {
    expect(src).toMatch(/state === 'error'[\s\S]{0,600}不代表历史被清空/)
  })
})
