import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeAnonymousFavoritesNote, describeSyncBanner, shouldOfferRetry } from '../src/lib/favorites-sync-copy'

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

/**
 * B15：匿名收藏只活在本机。匿名用户从不触发云端同步，同步状态条恒为 hidden，
 * 页面此前没有任何地方告诉他「收藏只保存在这台设备、清缓存会丢」。
 * 文案必须同时说清三件事：只存本机、怎么丢、登录能找回；缺任何一件都不算修好。
 */
describe('匿名收藏本机提示文案', () => {
  it('三件实事齐全：只存本机、丢失条件、登录找回', () => {
    const note = describeAnonymousFavoritesNote()
    expect(note).toContain('只保存在这台设备的浏览器里')
    expect(note).toContain('清除浏览器数据')
    expect(note).toContain('换设备会丢失')
    expect(note).toContain('登录后可同步到云端')
  })

  it('不承诺做不到的事：不说「已同步」「已备份」', () => {
    const note = describeAnonymousFavoritesNote()
    expect(note).not.toContain('已同步')
    expect(note).not.toContain('已备份')
  })
})

/**
 * B15 接线守卫：文案函数若没被收藏页真正渲染，等于没修。
 * 守卫只读源码不断言运行态——运行态由 identityReady 的就绪门控保证，
 * 这里钉死三件事：页面引用了该函数、提示只在身份就绪且确认为匿名时出现、
 * 登录入口带 callbackUrl 回收藏页（登录完不丢上下文）。
 */
describe('匿名提示接线守卫', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const ROOT = resolve(HERE, '..')
  const page = readFileSync(join(ROOT, 'src/app/favorites/page.tsx'), 'utf8')

  it('收藏页渲染该文案函数', () => {
    expect(page).toContain('describeAnonymousFavoritesNote()')
    expect(page).toContain('data-testid="anonymous-favorites-note"')
  })

  it('提示只在身份就绪且确认为匿名时出现，不闪登录用户', () => {
    expect(page).toContain('identityReady.ready')
    expect(page).toContain("identityReady.identity.startsWith('anon-')")
    expect(page).toContain('showAnonymousNote')
  })

  it('登录入口带 callbackUrl 回收藏页', () => {
    expect(page).toContain('/auth/signin?callbackUrl=/favorites')
    expect(page).toContain('登录同步收藏')
  })
})
