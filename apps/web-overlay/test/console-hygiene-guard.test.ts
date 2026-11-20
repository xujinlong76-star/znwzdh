/**
 * 控制台噪音与资源报错回归守卫（2026-11-19）：
 *  1. 站点缩略图与接力卡不得把远端裸 /favicon.ico 直接塞进 <img src>，
 *     也不得在 site-favicon.tsx 的内置映射/标题兜底里残留远端 favicon.ico；
 *  2. GrowthTracker 不得在全站根布局里无条件 preventDefault beforeinstallprompt，
 *     InstallPrompt 仅在首页按条件接管，避免 /marketplace/* 与 /submit 刷
 *     "Banner not shown: beforeinstallpromptevent.preventDefault() called" 告警；
 *  3. not-found 与 /me/settings 的动态边界开启 ssr: false，避免 Next 16 PreloadChunks
 *     向文档头注入未消费的 <link rel="preload" as="script">。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveSiteIcon } from '@/components/site-favicon'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const hit = candidates.find((p) => {
    const s = p.replace(/\\/g, '/')
    return (s.includes('/web-overlay/') || s.endsWith('/web-overlay')) && existsSync(p)
  })
  if (!hit) throw new Error('无法定位 web-overlay 根目录')
  return hit
}

const ROOT = overlayRoot()
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

describe('控制台洁净守卫：远端裸 favicon.ico 阻断', () => {
  it('site-thumbnails.ts 拒绝远端裸 favicon.ico 直出', () => {
    const src = stripComments(readSrc('src/lib/site-thumbnails.ts'))
    expect(src).toContain('isRemoteRawFavicon')
    expect(src).toContain('!isRemoteRawFavicon(icon)')
  })

  it('site-favicon.tsx 代码里不再残留远端 https://.../favicon.ico 映射值', () => {
    const code = stripComments(readSrc('src/components/site-favicon.tsx'))
    expect(code).not.toMatch(/['"]https?:\/\/[^'"]+\/favicon\.ico['"]/)
  })

  it('通义千问新旧域名、混元、Tome、Midjourney 均不会解析成远端裸 favicon.ico', () => {
    expect(resolveSiteIcon('https://qianwen.aliyun.com', '通义千问', 'https://qianwen.aliyun.com/favicon.ico')).toBe(
      '/brand-icons/qwen.svg',
    )
    expect(resolveSiteIcon('https://www.qianwen.com', '通义千问', 'https://www.qianwen.com/favicon.ico')).toBe(
      '/brand-icons/qwen.svg',
    )
    expect(
      resolveSiteIcon('https://video.hunyuan.tencent.com', '混元视频大模型', 'https://video.hunyuan.tencent.com/favicon.ico'),
    ).toBe('')
    expect(resolveSiteIcon('https://tome.app', 'Tome', 'https://tome.app/favicon.ico')).toBe('')
    expect(resolveSiteIcon('https://midjourney.com', 'Midjourney', 'https://midjourney.com/favicon.ico')).toBe(
      '/brand-icons/midjourney.png',
    )
  })

  it('handoff-card.tsx 的站点访问记录改走 SiteFavicon，不裸渲染 item.icon', () => {
    const code = stripComments(readSrc('src/components/handoff-card.tsx'))
    expect(code).toContain("from '@/components/site-favicon'")
    expect(code).toContain('<SiteFavicon')
    expect(code).not.toContain('src={item.icon}')
  })
})

describe('控制台洁净守卫：PWA beforeinstallprompt 不在子页无条件拦截', () => {
  it('GrowthTracker 不在根布局监听 beforeinstallprompt', () => {
    const code = stripComments(readSrc('src/components/growth/growth-tracker.tsx'))
    expect(code).not.toContain('beforeinstallprompt')
  })

  it('InstallPrompt 仅在首页按条件接管 beforeinstallprompt', () => {
    const code = stripComments(readSrc('src/components/install-prompt.tsx'))
    expect(code).toContain('pathname === "/"')
    expect(code).toContain('if (!isHomeRoute) return')
  })
})

describe('控制台洁净守卫：非 SEO 懒边界关闭 SSR 预加载注入', () => {
  it('not-found.tsx 的 SearchPalette 与 me/settings 的 MeSettingsViewLazy 均设 ssr: false', () => {
    const notFound = stripComments(readSrc('src/app/not-found.tsx'))
    expect(notFound).toMatch(/dynamic\([\s\S]*ssr:\s*false/)
    const settingsLazy = stripComments(readSrc('src/app/me/settings/me-settings-view-lazy.tsx'))
    expect(settingsLazy).toMatch(/dynamic\([\s\S]*ssr:\s*false/)
  })
})
