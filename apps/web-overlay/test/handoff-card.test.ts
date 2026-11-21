/**
 * 接力卡守卫测试（Batch 3 第 9 项，C 组 UI + D 组接线）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 import-persist-failure.test.ts 同款说明），接线与空态纪律
 * 走源码守卫体例（仿 pwa-offline.test.ts / offline-banner.test.ts）：
 *  - 两处入口都挂同一云端外壳；
 *  - 空态 / 未登录 / 拉取失败时整块不渲染（return null 分支钉死）；
 *  - 匿名不请求云端：组件内没有任何云端请求与 CRDT 同步调用；
 *  - 不读 lastOpenedAt、不动 CRDT / 播放器 / 收藏 / 场景文件。
 * 纯规则（合并取舍 / 首次上传去重 / payload 整形）见 handoff-sync.test.ts。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const card = overlaySource('src/components/handoff-card.tsx')
const wrapper = overlaySource('src/components/handoff-card-with-cloud.tsx')
const cloudHook = overlaySource('src/hooks/use-handoff-cloud-sync.ts')
const playerPage = overlaySource('src/components/video-player-page.tsx')
const handoffLib = overlaySource('src/lib/handoff.ts')
const homePage = overlaySource('src/app/page.tsx')
const historyPage = overlaySource('src/app/me/history/page.tsx')

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

/** import 语句的引号在不同文件里是单引号或双引号，两种都接受 */
function hasImport(src: string, path: string): boolean {
  return src.includes(`from '${path}'`) || src.includes(`from "${path}"`)
}

describe('接线：首页与 /me/history 复用同一云端外壳', () => {
  // U-358：接力卡不再经服务端 todaySlots 注入——它只在「今日中心」小窗打开时才需要，
  // 现由 NavigationContent 以 dynamic(ssr:false) 按需加载（HandoffCardWithCloudContent），
  // 与简报条同一顺序挂进小窗（简报之后、连胜条之前由 handoffContent 内的 fragment 保证）。
  it('首页由导航中心 dynamic(ssr:false) 将 <HandoffCardWithCloud /> 挂载于今日中心小窗', () => {
    expect(hasImport(homePage, '@/components/handoff-card-with-cloud')).toBe(false)
    expect(homePage).not.toContain('<HandoffCardWithCloud />')
    expect(homePage).not.toContain('todaySlots')
    const nav = overlaySource('src/components/navigation-content.tsx')
    expect(nav).toContain("() => import('@/components/handoff-card-with-cloud')")
    expect(nav).toContain('{ ssr: false')
    expect(nav).toContain('<HandoffCardWithCloudContent />')
    const briefAt = nav.indexOf('BriefStripContent')
    const cardAt = nav.indexOf('HandoffCardWithCloudContent')
    expect(briefAt).toBeGreaterThan(-1)
    expect(cardAt).toBeGreaterThan(briefAt)
  })

  it('/me/history 页顶部复用同一外壳，且不展示「还有 N 条」回链', () => {
    expect(hasImport(historyPage, '@/components/handoff-card-with-cloud')).toBe(true)
    expect(historyPage).toContain('<HandoffCardWithCloud showMoreLink={false} />')
    const cardAt = historyPage.indexOf('<HandoffCardWithCloud showMoreLink={false} />')
    const tabsAt = historyPage.indexOf('role="tablist"')
    expect(cardAt).toBeGreaterThan(-1)
    expect(tabsAt).toBeGreaterThan(cardAt)
  })

  it('组件是客户端岛（SSR 壳 + 挂载后读数）', () => {
    expect(card.startsWith("'use client'")).toBe(true)
    expect(card).toContain('useEffect')
    expect(card).toContain('getPlaybackHistory()')
  })
})

describe('接线：外壳把云端数据传进卡片，未登录不启动云端', () => {
  it('外壳是客户端组件，接 useHandoffCloudSync 并把云端断点/状态传进卡片', () => {
    expect(wrapper.startsWith("'use client'")).toBe(true)
    expect(hasImport(wrapper, '@/hooks/use-handoff-cloud-sync')).toBe(true)
    expect(hasImport(wrapper, '@/components/handoff-card')).toBe(true)
    expect(wrapper).toContain('cloudProgress={cloud.cloudProgress}')
    expect(wrapper).toContain('cloudStatus={cloud.cloudStatus}')
    expect(wrapper).toContain('isLoggedIn')
    expect(wrapper).toContain('onClear={handleClear}')
  })

  it('未登录时外壳只渲染裸卡片，不传任何云端 props', () => {
    expect(wrapper).toContain('if (!cloud.isLoggedIn) {')
    expect(wrapper).toContain('<HandoffCard showMoreLink={showMoreLink} />')
  })

  it('「清除」只对视频类补发云端删除（站点/追剧类没有云端断点可删）', () => {
    expect(wrapper).toContain("if (item.kind === 'video') cloud.deleteCloudProgress(item.id)")
  })

  it('接线 Hook 只在已登录时启用漫游同步；派发与删除都以登录为闸', () => {
    expect(hasImport(cloudHook, '@/hooks/use-crdt-roaming')).toBe(true)
    expect(cloudHook).toContain('enabled: isLoggedIn')
    expect(cloudHook).toContain('if (!isLoggedIn) return')
    expect(cloudHook).toContain("dispatchOp('UPSERT_VIDEO_PROGRESS'")
    expect(cloudHook).toContain("dispatchOp('DELETE_VIDEO_PROGRESS'")
    expect(cloudHook).toContain('selectRemoteProgressToMerge')
    expect(cloudHook).toContain('selectLocalProgressToUpload')
  })

  it('播放器两处本机写点都同时发往云端（节流写与 flush 写，共两处）', () => {
    expect(hasImport(playerPage, '@/hooks/use-handoff-cloud-sync')).toBe(true)
    const calls = playerPage.split('cloudDispatchRef.current({').length - 1
    expect(calls).toBe(2)
    // 两处都在本机 savePlaybackPosition 之后、同一快照同一时间戳发往云端
    expect(playerPage).toContain('updatedAt: nowMs,')
  })
})

describe('守卫：空态 / 未登录 / 拉取失败时整块不渲染', () => {
  it('挂载前、身份未就绪前返回 null（不占位、不放假数据）', () => {
    expect(card).toContain('if (localHistory === null || !identityReady.ready) return null')
  })

  it('无进度时返回 null（登录态与匿名态都有该分支）', () => {
    expect(card).toContain('if (!current) return null')
  })

  it('云端拉取中 / 拉取失败时整块不渲染', () => {
    expect(card).toContain(
      "if (cloudStatus === 'idle' || cloudStatus === 'loading' || cloudStatus === 'error') return null",
    )
  })

  it('匿名且无本机进度时返回 null；有本机进度时给登录引导而不是静默失效', () => {
    expect(card).toContain('if (!isLoggedIn) {')
    expect(card).toContain('登录后可跨设备继续')
    expect(card).toContain('href="/auth/signin"')
  })
})

describe('守卫：匿名不请求云端、不自己写 CRDT 同步', () => {
  it('组件内没有任何 fetch / 云端端点调用（云端接线是 D 组 props 插口）', () => {
    expect(card).not.toContain('fetch(')
    expect(card).not.toContain('/api/crdt')
    expect(card).not.toContain('/api/me/')
    expect(card).not.toContain('dispatchOp')
    expect(card).not.toContain('createCRDTOperation')
  })

  it('云端数据只以 props 接收，留好插口', () => {
    expect(card).toContain('cloudProgress?: HandoffVideoProgress[]')
    expect(card).toContain('visits?: HandoffVisit[]')
    expect(card).toContain('watchlist?: HandoffWatchlistEntry[]')
    expect(card).toContain("cloudStatus?: HandoffCloudStatus")
  })

  it('本机播放历史只读现成的 video-playback-storage 读函数', () => {
    expect(card).toContain("from '@/lib/video-playback-storage'")
    expect(card).toContain('getPlaybackHistory')
    expect(card).toContain('removePlaybackItem')
  })
})

describe('守卫：不碰禁区、不编造设备名', () => {
  it('接力规则层与组件都不读 lastOpenedAt（本机-only，不碰）', () => {
    expect(stripComments(handoffLib)).not.toContain('lastOpenedAt')
    expect(stripComments(card)).not.toContain('lastOpenedAt')
  })

  it('不 import CRDT / 播放器页 / 收藏 / 冬眠 / 场景模块', () => {
    for (const src of [stripComments(card), stripComments(handoffLib)]) {
      expect(src).not.toContain('crdt-sync')
      expect(src).not.toContain('video-player-page')
      expect(src).not.toContain('favorites-hibernation')
      expect(src).not.toContain('useFavorites')
      expect(src).not.toContain('scene-switcher')
      expect(src).not.toContain('resurface')
    }
  })

  it('卡面文案不写设备名：源码里没有「来自手机 / 来自电脑 / iPhone」类表述', () => {
    expect(card).not.toContain('来自手机')
    expect(card).not.toContain('来自电脑')
    expect(card).not.toContain('iPhone')
    expect(handoffLib).not.toContain('来自手机')
    expect(handoffLib).not.toContain('来自电脑')
  })

  it('视频主按钮走已有的 /videos/player?id=…&t=… 链路', () => {
    expect(handoffLib).toContain("`/videos/player?id=${encodeURIComponent(item.id)}`")
    expect(handoffLib).toContain('&t=${item.timestampSec}')
    expect(card).toContain('handoffVideoHref(current)')
  })

  it('「还有 N 条」进 /me/history', () => {
    expect(card).toContain('还有 {remaining} 条')
    expect(card).toContain('href="/me/history"')
  })
})
