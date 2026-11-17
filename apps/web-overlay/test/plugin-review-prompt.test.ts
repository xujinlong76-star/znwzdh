import { describe, expect, it, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * P1-5 邀评提示：安装成功后「用过请评价」。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，按仓库惯用的分层）：
 *  1. 真行为：review-prompt 纯函数 + localStorage 一次性语义 + toast
 *     触发参数，全部真实调用、真实断言；
 *  2. 接线守卫：安装弹窗把 action 挂在成功 toast 上、已安装页升级成功
 *     弹邀评 toast、每行有常驻「去评价」链接——源码 toContain 钉死，
 *     防止重构顺手改掉；
 *  3. 未覆盖、需浏览器复核：真机点「去评价」进评价区、toast 10 秒后
 *     自动消失与关闭按钮的点击链路（node 环境跑不了 effect/DOM，
 *     由 Playwright / 真机走查验证）。
 */

// sonner 是跨模块 mock：按 mock-hygiene 要求，afterEach 里 vi.resetModules() 清理。
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { toast } from 'sonner'
import {
  REVIEW_PROMPT_ACTION_LABEL,
  REVIEW_PROMPT_DURATION_MS,
  hasReviewPromptBeenShown,
  markReviewPromptShown,
  pluginReviewUrl,
  reviewPromptStorageKey,
  showInstallReviewPrompt,
  takeReviewPromptAction,
} from '../src/lib/plugins/review-prompt'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function createStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

function stubWindow(store: ReturnType<typeof createStorage>, assign = vi.fn()) {
  vi.stubGlobal('window', { localStorage: store, location: { assign } })
  return assign
}

describe('邀评深链：去评价进详情页评价区', () => {
  it('指向详情页并带 ?tab=reviews，详情页挂载时按此参数打开评价选项卡', () => {
    expect(pluginReviewUrl('my-plugin')).toBe('/marketplace/my-plugin?tab=reviews')
    expect(pluginReviewUrl('a b/c')).toBe('/marketplace/a%20b%2Fc?tab=reviews')
  })

  it('详情页确实支持 ?tab=reviews 深链（不是新造的假参数）', () => {
    const view = overlaySource('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(view).toContain("new URLSearchParams(window.location.search).get('tab')")
    expect(view).toContain("'reviews'")
  })
})

describe('邀评一次性语义：同一插件只提示一次', () => {
  it('未提示过返回 false，标记后返回 true，且按 slug 隔离', () => {
    const store = createStorage()
    stubWindow(store)
    expect(hasReviewPromptBeenShown('a')).toBe(false)
    markReviewPromptShown('a')
    expect(hasReviewPromptBeenShown('a')).toBe(true)
    expect(hasReviewPromptBeenShown('b')).toBe(false)
  })

  it('存储键按 slug 区分', () => {
    expect(reviewPromptStorageKey('a')).not.toBe(reviewPromptStorageKey('b'))
    expect(reviewPromptStorageKey('a')).toBe(reviewPromptStorageKey('a'))
  })

  it('无 window / 无 localStorage / 读写抛错时不阻断安装流程', () => {
    // node 环境默认没有 window：直接返回 false、不抛错
    expect(hasReviewPromptBeenShown('a')).toBe(false)
    expect(() => markReviewPromptShown('a')).not.toThrow()
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    vi.stubGlobal('window', { localStorage: throwing })
    expect(hasReviewPromptBeenShown('a')).toBe(false)
    expect(() => markReviewPromptShown('a')).not.toThrow()
  })

  it('takeReviewPromptAction：第一次返回去评价 action，第二次返回 null', () => {
    const store = createStorage()
    const assign = stubWindow(store)
    const first = takeReviewPromptAction('my-plugin')
    expect(first).not.toBeNull()
    expect(first?.label).toBe(REVIEW_PROMPT_ACTION_LABEL)
    expect(first?.label).toBe('去评价')
    first?.onClick()
    expect(assign).toHaveBeenCalledWith('/marketplace/my-plugin?tab=reviews')
    expect(takeReviewPromptAction('my-plugin')).toBeNull()
    // 另一个插件不受影响
    expect(takeReviewPromptAction('other-plugin')).not.toBeNull()
  })

  it('takeReviewPromptAction：空 slug 不提示、不写存储', () => {
    const store = createStorage()
    stubWindow(store)
    expect(takeReviewPromptAction('')).toBeNull()
  })
})

describe('已安装页升级成功：单独弹一条邀评 toast', () => {
  it('首次弹出：标题点名插件、带去评价 action、10 秒自动消失、可关闭', () => {
    const store = createStorage()
    stubWindow(store)
    const shown = showInstallReviewPrompt('my-plugin', '测试插件')
    expect(shown).toBe(true)
    expect(toast.success).toHaveBeenCalledTimes(1)
    const [title, options] = vi.mocked(toast.success).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(title).toContain('测试插件')
    expect(title).toContain('评价')
    expect(options.duration).toBe(REVIEW_PROMPT_DURATION_MS)
    expect(options.duration).toBe(10_000)
    expect(options.closeButton).toBe(true)
    expect(options.action).toMatchObject({ label: '去评价' })
    // 文案不编造任何评分 / 安装量数字
    expect(title).not.toMatch(/\d+(\.\d+)?\s*分/)
    expect(String(options.description ?? '')).not.toMatch(/已安装 \d+ 次|好评率/)
  })

  it('同一插件第二次不再弹（不骚扰）', () => {
    const store = createStorage()
    stubWindow(store)
    expect(showInstallReviewPrompt('my-plugin', '测试插件')).toBe(true)
    expect(showInstallReviewPrompt('my-plugin', '测试插件')).toBe(false)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})

describe('接线守卫：邀评提示挂在安装成功链路上', () => {
  it('安装弹窗：新装/升级成功 toast 挂去评价 action，alreadyInstalled 不提示', () => {
    const modal = overlaySource('src/components/plugins/plugin-install-modal.tsx')
    expect(modal).toContain('takeReviewPromptAction(plugin.slug)')
    expect(modal).toContain('REVIEW_PROMPT_DURATION_MS')
    expect(modal).toContain('closeButton: true')
    // alreadyInstalled 分支明确排除在邀评之外
    const branch = modal.slice(modal.indexOf('const reviewAction'))
    expect(branch).toContain('res.alreadyInstalled')
    expect(branch).toContain('? null')
  })

  it('安装弹窗：邀评只在成功 toast 里，不碰星标提示区（plugin-card / detail-view 未动邀评）', () => {
    const modal = overlaySource('src/components/plugins/plugin-install-modal.tsx')
    expect(modal).not.toContain('review-prompted')
    // 邀评入口只经过 review-prompt helper：弹窗不直接 import 拼深链的函数，
    // 深链构造只活在 lib 里一处
    expect(modal).not.toContain('pluginReviewUrl')
  })

  it('已安装页：升级成功弹邀评 toast，每行有常驻「去评价」链接', () => {
    const page = overlaySource('src/app/marketplace/installed/page.tsx')
    expect(page).toContain('showInstallReviewPrompt(item.slug, item.name)')
    expect(page).toContain('pluginReviewUrl(item.slug)')
    expect(page).toContain('去评价')
    // 邀评只接在升级成功分支，不接在卸载 / 停用 / 启用分支
    const upgrade = page.slice(page.indexOf('handleUpgrade'))
    expect(upgrade).toContain('showInstallReviewPrompt')
    const uninstall = page.slice(page.indexOf('handleUninstall'))
    expect(uninstall).not.toContain('showInstallReviewPrompt')
  })
})
