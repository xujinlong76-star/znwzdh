/**
 * P1 #9 视觉卡片：缩略图解析 + 卡片视觉槽。
 *
 * 密度控制那一半已经存在（见文件底部的守则测试），这里只钉缩略图：
 *   1. 解析优先级：服务端预签代理 > 自定义 icon 直链 > 既有 favicon 管线
 *      （本地品牌图标 / GitHub 头像）> /api/hub/assets/icon 代理兜底 > null；
 *   2. 不安全 URL 一律拒绝（伪协议、data:、http 远端、协议相对、userinfo、
 *      控制字符），绝不原样放进 <img src>；
 *   3. 没有真实图片时返回 null，卡片回落到现有图标渲染；
 *   4. 卡片源码守则：视觉槽只进 rich 横幅与标准卡大图标，紧凑单行条不动；
 *      图片懒加载；盒子尺寸固定（无布局偏移）；密度变量保持原样。
 *
 * 注意：站点记录里没有 og:image / 封面图字段，截图服务也在本轮范围外——
 * “缩略图”诚实地等于既有图标管线能给出的真实图片（见 lib/site-thumbnails.ts
 * 文件头），测试不虚构更丰富的来源。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveSiteThumbnail } from '@/lib/site-thumbnails'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('resolveSiteThumbnail：解析优先级', () => {
  it('服务端预签代理地址优先于一切（防盗链降级 URL 最可靠）', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      title: '示例站',
      icon: 'https://cdn.example.com/logo.png',
      mediaProxyIconUrl: 'https://proxy.example.com/signed/icon.png?sig=abc',
    })
    expect(thumb).toEqual({ src: 'https://proxy.example.com/signed/icon.png?sig=abc', kind: 'media-proxy' })
  })

  it('站内相对路径的预签代理地址同样放行', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      mediaProxyIconUrl: '/api/hub/assets/icon?url=https%3A%2F%2Fexample.com%2Fa',
    })
    expect(thumb?.kind).toBe('media-proxy')
    expect(thumb?.src.startsWith('/api/hub/assets/icon')).toBe(true)
  })

  it('无预签代理时，icon 字段的 https 直链次之', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      icon: 'https://cdn.example.com/logo.png',
    })
    expect(thumb).toEqual({ src: 'https://cdn.example.com/logo.png', kind: 'custom-icon' })
  })

  it('icon 字段的站内相对路径同样是合法图片地址', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      icon: '/icons/search.svg',
    })
    expect(thumb).toEqual({ src: '/icons/search.svg', kind: 'custom-icon' })
  })

  it('lucide 名字（如 star）不是图片：不被当成 src，落到 favicon 管线', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      title: '示例站',
      icon: 'star',
    })
    // resolveSiteIcon 会把 'star' 原样返回，解析器必须筛掉它，不能输出 <img src="star">
    expect(thumb).not.toBeNull()
    expect(thumb!.src).not.toBe('star')
    expect(thumb!.kind).toBe('favicon')
  })

  it('既有 favicon 管线的本地品牌图标被复用（chatgpt.com → 本地 webp）', () => {
    const thumb = resolveSiteThumbnail({ href: 'https://chatgpt.com/', title: 'ChatGPT' })
    expect(thumb).toEqual({ src: '/assets/images/logos/chatgpt.webp', kind: 'favicon' })
  })

  it('既有 favicon 管线的 GitHub 组织头像被复用', () => {
    const thumb = resolveSiteThumbnail({ href: 'https://github.com/facebook/react', title: 'React' })
    expect(thumb).toEqual({ src: 'https://github.com/facebook.png?size=64', kind: 'favicon' })
  })

  it('管线拿不到图标时落到 /api/hub/assets/icon 代理兜底（与 SiteFavicon 一致）', () => {
    const thumb = resolveSiteThumbnail({ href: 'https://some-unknown-site.example/', title: '未知站' })
    expect(thumb?.kind).toBe('favicon')
    expect(thumb?.src).toBe(
      '/api/hub/assets/icon?url=https%3A%2F%2Fsome-unknown-site.example%2F&title=%E6%9C%AA%E7%9F%A5%E7%AB%99',
    )
  })

  it('无标题时代理兜底不带 title 参数', () => {
    const thumb = resolveSiteThumbnail({ href: 'https://some-unknown-site.example/' })
    expect(thumb?.src).toBe('/api/hub/assets/icon?url=https%3A%2F%2Fsome-unknown-site.example%2F')
  })
})

describe('resolveSiteThumbnail：无真实图片时返回 null', () => {
  it('非 http(s) 链接：没有可代理的 favicon 来源', () => {
    expect(resolveSiteThumbnail({ href: '/internal/page', title: '站内页' })).toBeNull()
    expect(resolveSiteThumbnail({ href: '', title: '空链接' })).toBeNull()
  })

  it('显式要求默认图标：不拿占位图冒充缩略图', () => {
    expect(
      resolveSiteThumbnail({
        href: 'https://example.com/a',
        title: '示例站',
        icon: 'https://cdn.example.com/logo.png',
        useDefaultIcon: true,
      }),
    ).toBeNull()
  })
})

describe('resolveSiteThumbnail：不安全 URL 一律拒绝', () => {
  it('伪协议与 data: 的 icon 不被采用，落到代理兜底而非原样输出', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'vbscript:msgbox(1)']) {
      const thumb = resolveSiteThumbnail({ href: 'https://example.com/a', icon: bad })
      expect(thumb?.src).not.toContain('javascript:')
      expect(thumb?.src).not.toContain('data:image')
      expect(thumb?.src).not.toContain('vbscript:')
      expect(thumb?.kind).toBe('favicon')
    }
  })

  it('http 远端 icon 被 https-only 口径拒绝，降级到代理而不是直接加载', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      icon: 'http://cdn.example.com/logo.png',
    })
    expect(thumb?.src).not.toBe('http://cdn.example.com/logo.png')
    expect(thumb?.kind).toBe('favicon')
    expect(thumb?.src.startsWith('/api/hub/assets/icon')).toBe(true)
  })

  it('协议相对与反斜杠变体不被当成站内路径', () => {
    for (const bad of ['//evil.example/logo.png', '/\\evil.example/logo.png']) {
      const thumb = resolveSiteThumbnail({ href: 'https://example.com/a', icon: bad })
      expect(thumb?.src).not.toBe(bad)
      expect(thumb?.src.startsWith('/api/hub/assets/icon')).toBe(true)
    }
  })

  it('带 userinfo 的图片地址被拒绝（显示域名与真实域名不一致）', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      icon: 'https://example.com@evil.example/logo.png',
    })
    expect(thumb?.src).not.toContain('evil.example/logo.png')
    expect(thumb?.src.startsWith('/api/hub/assets/icon')).toBe(true)
  })

  it('含控制字符的 icon 被拒绝', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      icon: 'https://cdn.example.com/lo\tgo.png',
    })
    expect(thumb?.src).not.toContain('cdn.example.com')
    expect(thumb?.kind).toBe('favicon')
  })

  it('不安全的预签代理地址同样被拒绝，继续走后面的优先级', () => {
    const thumb = resolveSiteThumbnail({
      href: 'https://example.com/a',
      icon: 'https://cdn.example.com/logo.png',
      mediaProxyIconUrl: 'javascript:alert(1)',
    })
    expect(thumb).toEqual({ src: 'https://cdn.example.com/logo.png', kind: 'custom-icon' })
  })

  it('带 userinfo 的 href 不走代理兜底（代理会替它取站外地址）', () => {
    expect(
      resolveSiteThumbnail({ href: 'https://example.com@evil.example/', title: '钓鱼站' }),
    ).toBeNull()
  })
})

describe('navigation-card.tsx：视觉槽接线守则', () => {
  const cardSrc = readSrc('src/components/navigation-card.tsx')

  it('卡片引用缩略图解析器，而不是自己拼 URL', () => {
    expect(cardSrc).toContain("from '@/lib/site-thumbnails'")
    expect(cardSrc).toContain('resolveSiteThumbnail(item)')
  })

  it('视觉槽只进 rich 横幅与标准卡大图标，紧凑单行条不动', () => {
    const compactStart = cardSrc.indexOf("cardDisplayMode === 'compact'")
    const richStart = cardSrc.indexOf("cardDisplayMode === 'rich'")
    expect(compactStart).toBeGreaterThan(-1)
    expect(richStart).toBeGreaterThan(compactStart)
    expect(cardSrc.slice(compactStart, richStart)).not.toContain('CardThumbnailVisual')
    expect(cardSrc.match(/CardThumbnailVisual/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('rich 横幅固定高度、图片懒加载，加载失败有首字母回落（无布局偏移）', () => {
    expect(cardSrc).toContain('boxClassName="h-28 w-full shrink-0"')
    expect(cardSrc).toContain('loading="lazy"')
    expect(cardSrc).toContain('decoding="async"')
    expect(cardSrc).toContain('onError={() => setImgFailed(true)}')
    expect(cardSrc).toContain('extractFaviconMonogram(title')
  })

  it('rich 有横幅时不再重复放小图标，无缩略图时保持原有图标渲染', () => {
    expect(cardSrc).toContain('{!thumbnail && (')
    expect(cardSrc).toContain('boxClassName="flex-shrink-0 w-12 h-12 rounded-xl')
  })

  it('缩略图是装饰性的，不进读屏、不抢点击（外链覆盖层仍是唯一入口）', () => {
    expect(cardSrc).toContain('aria-hidden="true"')
    expect(cardSrc).toContain('alt=""')
  })
})

describe('密度控制已存在：本轮不重建，只钉住它还在', () => {
  it('三档密度映射、Provider、切换器与 CSS 变量都在', () => {
    expect(readSrc('src/lib/content-density.ts')).toContain('CARD_DENSITY_TO_CONTENT')
    expect(readSrc('src/components/density-provider.tsx')).toContain('DensityProvider')
    expect(readSrc('src/components/density-provider.tsx')).toContain("document.documentElement.setAttribute('data-density'")
    expect(readSrc('src/components/density-toggle.tsx')).toContain('useDensity()')
    const css = readSrc('src/styles/globals.css')
    expect(css).toContain('[data-density="dense"]')
    expect(css).toContain('[data-density="spacious"]')
    expect(css).toContain('--density-card-padding')
  })

  it('卡片仍消费密度变量（本轮改动没有动密度驱动的内边距）', () => {
    const cardSrc = readSrc('src/components/navigation-card.tsx')
    expect(cardSrc).toContain('p-[var(--density-card-padding,0.875rem)]')
  })
})
