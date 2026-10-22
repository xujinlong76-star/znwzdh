import { describe, expect, it } from 'vitest'
import { describeSyncBanner, shouldOfferRetry } from '../src/lib/favorites-sync-copy'

/**
 * 同步状态条的五种分支（P1）。
 *
 * 这段文案此前是 JSX 里的三层嵌套三元，没有任何测试。它承担的是"向用户解释
 * 数据同步成功了没有"的唯一职责，因此每一条分支都被钉死：
 *  - 失败必须带原因（说不出原因时也要说明"原因未知"，不能静默）；
 *  - 墓碑删除必须优先告知（用户需要知道有东西被另一台设备删了）；
 *  - 没有信息时 hidden（不占位）。
 */
describe('同步状态条文案', () => {
  it('同步中', () => {
    expect(describeSyncBanner({ syncing: true })).toEqual({ tone: 'syncing', text: '正在与云端同步收藏…' })
  })

  it('成功且推了条目：报出推送数与云端总数', () => {
    const banner = describeSyncBanner({ syncing: false, ok: true, pushed: 3, cloudCount: 12 })
    expect(banner).toEqual({ tone: 'success', text: '已把本机 3 条收藏合并到云端（云端共 12 条）' })
  })

  it('成功但纯拉取：不说"合并"，避免误导用户以为推了东西', () => {
    expect(describeSyncBanner({ syncing: false, ok: true, pushed: 0, cloudCount: 5 }).text).toBe(
      '云端同步正常（云端共 5 条）',
    )
  })

  it('另一台设备删了条目：墓碑提示优先于普通成功文案', () => {
    const banner = describeSyncBanner({ syncing: false, ok: true, pushed: 0, remoteRemoved: 2 })
    expect(banner.text).toBe('另一台设备删除了 2 条收藏，已与云端保持一致')
  })

  it('失败必须带原因', () => {
    const banner = describeSyncBanner({ syncing: false, ok: false, error: '登录已过期，请重新登录后同步收藏' })
    expect(banner.tone).toBe('error')
    expect(banner.text).toContain('登录已过期')
    expect(banner.text).toContain('换设备登录可能看不到')
  })

  it('失败但没有原因：明说"原因未知"，不静默', () => {
    const banner = describeSyncBanner({ syncing: false, ok: false })
    expect(banner.tone).toBe('error')
    expect(banner.text).toContain('原因未知')
  })

  it('没有输入时不占位', () => {
    expect(describeSyncBanner(null)).toEqual({ tone: 'hidden', text: '' })
  })
})

describe('重试按钮', () => {
  it('只在失败且可重试时出现', () => {
    expect(shouldOfferRetry({ syncing: false, ok: false, retryable: true })).toBe(true)
    expect(shouldOfferRetry({ syncing: false, ok: false, retryable: false })).toBe(false)
    expect(shouldOfferRetry({ syncing: false, ok: true })).toBe(false)
    expect(shouldOfferRetry({ syncing: true })).toBe(false)
    expect(shouldOfferRetry(null)).toBe(false)
  })
})
