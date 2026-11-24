import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { NavigationCard } from '../src/components/navigation-card'
import { TooltipProvider } from '../src/components/ui/tooltip'
import type { NavigationSubItem } from '../src/types/navigation'

/**
 * 出站守卫接线测试（W10）。
 *
 * 断言卡片主锚点（外链覆盖层，`data-prefetch-target="true"` 的那个 `<a>`）
 * 的 href 是否按 W4 守卫改写：
 * - lookalike → `/verify?brand=<规范域名>&domain=<host>`；
 * - official / unknown 原样放行（核实的官网零误拦）；
 * - 4 个候选域按守卫现有判定走（kimi.moonshot.cn 与 leetcode.com 改写，
 *   qwenwork.cn 与 notebook.google.com 原样）。
 *
 * 体例照抄 `navigation-card-health.test.ts`：renderToString + vi.mock，
 * 不跑 effect、不走真实网络；只覆盖本 lane 改的 `navigation-card.tsx`。
 */

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: () => {} }),
  toast: () => {},
}))

vi.mock('@/lib/modular/feature-mask-store', () => ({
  useFeatureMask: () => ({
    effectiveCardElements: {
      showDescription: true,
      showTags: true,
      showPinnedBadge: true,
      showQuickLookBadge: false,
    },
    isFeatureHidden: () => false,
    removeFeature: () => {},
  }),
}))

vi.mock('@/components/diy/diy-drag-context', () => ({
  useDiyDragHandleRef: () => null,
  useDiyDragActive: () => false,
}))

vi.mock('@/lib/user-preferences', () => ({
  useExternalLinkTarget: (fallback: '_blank' | '_self' = '_blank') => fallback,
}))

vi.mock('@/components/favorite-button', () => ({
  FavoriteButton: () => null,
}))

function cardItem(href: string): NavigationSubItem {
  return {
    id: 'nav-da02af4f6414',
    title: '示例站',
    href,
    description: '示例描述',
    enabled: true,
  }
}

function renderCard(
  item: NavigationSubItem,
  extraProps: { cardDisplayMode?: 'compact' | 'standard' | 'rich' } = {},
): string {
  return renderToString(
    createElement(TooltipProvider, null, createElement(NavigationCard, { item, ...extraProps })),
  )
}

/**
 * 取主锚点（外链覆盖层）的 href：卡片里唯一带 `data-prefetch-target="true"`
 * 的 `<a>`。React SSR 会把 href 里的 `&` 转义为 `&amp;`，比较前先还原。
 */
function overlayHref(html: string): string {
  const tags = html.match(/<a\b[^>]*>/g) ?? []
  const overlay = tags.filter((t) => t.includes('data-prefetch-target="true"'))
  expect(overlay, html).toHaveLength(1)
  const m = overlay[0].match(/href="([^"]*)"/)
  expect(m, overlay[0]).not.toBeNull()
  return (m?.[1] ?? '').replace(/&amp;/g, '&')
}

describe('出站守卫接线：lookalike 改跳 /verify，official/unknown 原样放行', () => {
  it('lookalike 域改写为 /verify?brand=<规范域名>&domain=<host>', () => {
    expect(overlayHref(renderCard(cardItem('https://chatgpt-login.example.com/')))).toBe(
      '/verify?brand=chatgpt.com&domain=chatgpt-login.example.com',
    )
    expect(overlayHref(renderCard(cardItem('https://chatgpt.com.evil.com/')))).toBe(
      '/verify?brand=chatgpt.com&domain=chatgpt.com.evil.com',
    )
    // 路径与查询不进 domain，只取 host
    expect(overlayHref(renderCard(cardItem('https://chatgpt-login.example.com/login?x=1')))).toBe(
      '/verify?brand=chatgpt.com&domain=chatgpt-login.example.com',
    )
  })

  it('official 官网原样放行（零误拦）：规范域名、www/裸域变体、备注确认入口', () => {
    expect(overlayHref(renderCard(cardItem('https://chatgpt.com/')))).toBe('https://chatgpt.com/')
    expect(overlayHref(renderCard(cardItem('https://www.python.org/')))).toBe(
      'https://www.python.org/',
    )
    expect(overlayHref(renderCard(cardItem('https://chat.deepseek.com/')))).toBe(
      'https://chat.deepseek.com/',
    )
    expect(overlayHref(renderCard(cardItem('https://github.com/')))).toBe('https://github.com/')
  })

  it('unknown 原样放行：无关域名与未确认子域', () => {
    expect(overlayHref(renderCard(cardItem('https://example.com/')))).toBe('https://example.com/')
    expect(overlayHref(renderCard(cardItem('https://api.claude.ai/')))).toBe(
      'https://api.claude.ai/',
    )
  })

  it('4 个候选域按守卫现有判定走（不改 navigation.json，不做人工裁决）', () => {
    // lookalike：改写
    expect(overlayHref(renderCard(cardItem('https://kimi.moonshot.cn/')))).toBe(
      '/verify?brand=www.kimi.com&domain=kimi.moonshot.cn',
    )
    expect(overlayHref(renderCard(cardItem('https://leetcode.com/')))).toBe(
      '/verify?brand=leetcode.cn&domain=leetcode.com',
    )
    // unknown：原样（qwenwork 的 qwen 未落词界；notebook.google.com 与
    // gemini.google.com 同注册域）
    expect(overlayHref(renderCard(cardItem('https://qwenwork.cn/')))).toBe(
      'https://qwenwork.cn/',
    )
    expect(overlayHref(renderCard(cardItem('https://notebook.google.com/')))).toBe(
      'https://notebook.google.com/',
    )
  })

  it('三形态（compact / standard / rich）都走同一接线', () => {
    const lookalike = 'https://chatgpt-login.example.com/'
    const expected = '/verify?brand=chatgpt.com&domain=chatgpt-login.example.com'
    expect(overlayHref(renderCard(cardItem(lookalike), { cardDisplayMode: 'compact' }))).toBe(
      expected,
    )
    expect(overlayHref(renderCard(cardItem(lookalike), { cardDisplayMode: 'standard' }))).toBe(
      expected,
    )
    expect(overlayHref(renderCard(cardItem(lookalike), { cardDisplayMode: 'rich' }))).toBe(
      expected,
    )
    // official 在三形态下也都不改写
    expect(overlayHref(renderCard(cardItem('https://chatgpt.com/'), { cardDisplayMode: 'rich' }))).toBe(
      'https://chatgpt.com/',
    )
  })

  it('不安全输入与相对路径原样走 safeHref 回落，不进 /verify', () => {
    expect(overlayHref(renderCard(cardItem('javascript:alert(1)')))).toBe('#')
    expect(overlayHref(renderCard(cardItem('/site/nav-da02af4f6414')))).toBe(
      '/site/nav-da02af4f6414',
    )
  })

  it('卡片外观不动：标题仍渲染；接线不新增记录、不写存储、不发请求', () => {
    const html = renderCard(cardItem('https://chatgpt-login.example.com/'))
    expect(html).toContain('示例站')
    expect(html).toContain('访问 示例站')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      renderCard(cardItem('https://chatgpt.com/'))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
