/**
 * 影院区 SSR（升级第 1 条：影院区 LCP）。
 *
 * 断言服务端渲染输出本身，而不是源码字符串：
 *  - 有 initial 时首张海报 <img> 直接在 SSR HTML 里（eager + fetchpriority
 *    high），榜单与翻页按钮也在；
 *  - 导航数据拉取失败 / 拿到但 0 站时都如实显示「暂时拉不到」，不再写「加载中」；
 *  - 没给 initial 时走老路：SSR 输出无海报、写「加载中」。
 * 另有两层源码守卫（本仓库无 jsdom、按惯例补源码断言）：navigation-content
 * 不再对影院区用 ssr: false、page.tsx 真的在服务端算 cinemaInitial。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：用 react-dom/server 的 renderToString
 * 做服务端渲染断言（不挂载，effect 不跑，正好对应 SSR 输出）。next/link 与
 * useWatchlist 用 vi.mock 隔离——本文件测影院区的 SSR 数据路径，不测 Link
 * 与追剧清单钩子本身（它们的覆盖在其余测试里）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { HomeDramaCinema, type CinemaInitialData } from '../src/components/home-drama-cinema'
import { getFirstDramaPoster } from '../src/lib/server/cinema-media'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, '..')
const OVERLAY_ROOT = join(HERE, '..', '..', 'apps', 'web-overlay')
const readSrc = (rel: string): string | null => {
  for (const root of [WEB_ROOT, OVERLAY_ROOT]) {
    try {
      return readFileSync(join(root, rel), 'utf8')
    } catch {
      // 镜像与 overlay 双份并存时优先读镜像
    }
  }
  return null
}

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

// useWatchlist：SSR 输出里「继续追」行只在 ready 且有条目时才渲染；这里固定
// ready:false，让输出只取决于 initial，不依赖本机 localStorage。
// WatchlistAddButton 在渲染期会调 findByPlatformAndTitle 并读 storageBlocked，
// 一并给桩（它本身的覆盖在其余测试里）。
vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({
    ready: false,
    entries: [],
    storageBlocked: null,
    findByPlatformAndTitle: () => undefined,
    isWatching: () => false,
    add: () => null,
    remove: () => undefined,
  }),
}))

const POSTER = {
  key: 'poster-urban',
  title: '都市情感短剧',
  width: 440,
  height: 784,
  data: 'data:image/webp;base64,AAAA',
}

const SITES = [
  { id: 's1', title: '红果短剧', href: 'https://www.hongguo.com' },
  { id: 's2', title: '抖音短剧', href: 'https://www.douyin.com' },
]

function render(initial?: CinemaInitialData): string {
  return renderToString(createElement(HomeDramaCinema, { initial }))
}

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe('SSR 输出：有 initial 时首张海报直接在首屏 HTML 里', () => {
  it('首张海报 <img> 在 SSR HTML 内，eager + fetchpriority high', () => {
    const html = render({
      poster: POSTER,
      dramaSites: SITES,
      aiToolsCount: 12,
      navStatus: 'done',
    })
    expect(html).toContain('alt="都市情感短剧"')
    expect(html).toContain('loading="eager"')
    // React 19 在 SSR HTML 里把 fetchPriority 原样写成驼峰 fetchPriority="high"
    //（HTML 属性名大小写不敏感，浏览器照常认作高优先级）。
    expect(html).toContain('fetchPriority="high"')
    expect(html).toContain('src="data:image/webp;base64,AAAA"')
  })

  it('榜单站点与翻页按钮都在 SSR HTML 里', () => {
    const html = render({
      poster: POSTER,
      dramaSites: SITES,
      aiToolsCount: 12,
      navStatus: 'done',
    })
    expect(html).toContain('红果短剧')
    expect(html).toContain('抖音短剧')
    expect(html).toContain('aria-label="向左翻页"')
    expect(html).toContain('aria-label="向右翻页"')
  })

  it('只有一张海报进 SSR：第二张海报标题不在首屏 HTML 里', () => {
    const html = render({
      poster: POSTER,
      dramaSites: SITES,
      aiToolsCount: 12,
      navStatus: 'done',
    })
    expect(html).not.toContain('古装甜宠短剧')
  })
})

describe('SSR 输出：导航数据拿不到时如实说「暂时拉不到」', () => {
  it('navStatus failed → 显示「暂时拉不到」，不写「加载中」', () => {
    const html = render({ poster: null, dramaSites: [], aiToolsCount: null, navStatus: 'failed' })
    expect(html).toContain('榜单暂时拉不到')
    expect(html).not.toContain('榜单加载中')
  })

  it('done 但 0 站 → 同样显示「暂时拉不到」，不再谎称「加载中」', () => {
    const html = render({ poster: null, dramaSites: [], aiToolsCount: null, navStatus: 'done' })
    expect(html).toContain('榜单暂时拉不到')
    expect(html).not.toContain('榜单加载中')
  })
})

describe('SSR 输出：没给 initial 时走老路', () => {
  it('无海报、无榜单时显示「加载中」，且没有任何 <img>', () => {
    const html = render()
    expect(html).toContain('榜单加载中')
    expect(html).not.toContain('<img')
  })
})

describe('服务端读取：getFirstDramaPoster 真读到 public/drama-media.json 的首张', () => {
  it('返回 posters[0]（都市情感短剧），data 是 WebP data URI', async () => {
    const poster = await getFirstDramaPoster()
    expect(poster).not.toBeNull()
    expect(poster?.key).toBe('poster-urban')
    expect(poster?.title).toBe('都市情感短剧')
    expect(poster?.data.startsWith('data:image/webp;base64,')).toBe(true)
  })

  it('用真实首张海报渲染，SSR HTML 含该海报 <img>', async () => {
    const poster = await getFirstDramaPoster()
    expect(poster).not.toBeNull()
    const html = render({
      poster,
      dramaSites: SITES,
      aiToolsCount: 12,
      navStatus: 'done',
    })
    expect(html).toContain('alt="都市情感短剧"')
    expect(html).toContain('fetchPriority="high"')
  })
})

describe('接线守卫：SSR 开关与服务端传参真的在代码里', () => {
  it('首页极简胶囊与迷你剧场小窗保留 cinemaInitial 服务端直传，避免首帧闪空', () => {
    const navSrc = readSrc('src/components/navigation-content.tsx')
    const stripSrc = readSrc('src/components/home-micro-strip.tsx')
    const dialogSrc = readSrc('src/components/home-windows/drama-mini-dialog.tsx')
    expect(navSrc).not.toBeNull()
    expect(stripSrc).not.toBeNull()
    expect(dialogSrc).not.toBeNull()
    expect(navSrc).toContain('cinemaInitial?: CinemaInitialData')
    expect(navSrc).toContain('cinemaInitial={cinemaInitial}')
    expect(stripSrc).toContain('cinemaInitial?: CinemaInitialData')
    expect(stripSrc).toContain('initial={cinemaInitial}')
    expect(dialogSrc).toContain('<HomeDramaCinema initial={initial} />')
  })

  it('page.tsx 在服务端算 cinemaInitial（读首张海报 + 算榜单），并传给 NavigationContent', () => {
    const src = readSrc('src/app/page.tsx')
    expect(src, 'page.tsx 读不到').not.toBeNull()
    expect(src).toContain('getFirstDramaPoster()')
    expect(src).toContain('collectDramaSites(navigationItems)')
    expect(src).toContain('cinemaInitial={cinemaInitial}')
  })

  it('影院组件有 initial 时不再请求 /api/home/navigation（同一份数据不拉两次）', () => {
    const src = readSrc('src/components/home-drama-cinema.tsx')
    expect(src, 'home-drama-cinema.tsx 读不到').not.toBeNull()
    expect(src).toContain('hasServerNav')
    expect(src).toContain("if (hasServerNav) {")
  })
})
