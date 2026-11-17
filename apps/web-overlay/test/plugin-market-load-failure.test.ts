/**
 * P1-2 故障冒充空态：loading / error / empty 三态严格区分。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，组件 effect 跑不起来，
 * 所以“行为级”按能真实跑到的层次分三层钉死，不拿源码 toContain 充数）：
 *
 *  1. 真行为（纯函数 / 真取数）：describeDegrade 的英文翻译、
 *     applyMarketplaceListLoad 的三态转移、fetch* 在 fetch 抛错时的
 *     onDegraded + 空兜底契约——全部是真实调用、真实断言返回值。
 *  2. 真渲染（renderToString）：共用的 MarketplaceLoadError 面板、
 *     board 的空态 / 加载态 / 有数据态——断言渲染出的 HTML 文本。
 *  3. 接线顺序守卫（补充）：失败分支必须排在空态分支之前（三页）、
 *     load() 真的走 applyMarketplaceListLoad——只钉顺序与接线，
 *     行为本身由上面两层覆盖；与 empty-vs-failure-honesty.test.ts
 *     对 /sites 的写法同款。
 *
 * 未覆盖、需浏览器复核的缺口（见 A6）：DOM 里点“重试”→ effect 重取→
 * 列表恢复的端到端点击链路，node 环境跑不了 effect，只能由
 * Playwright / 真机走查验证；这里覆盖到：面板真的渲染出可点的重试
 * 按钮、重试触发的 load 与首载是同一条路（reloadToken / loadData）、
 * 重取成功恢复列表的状态转移（状态机“重试恢复”用例）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeDegrade } from '../src/lib/degrade'
import {
  fetchInstalledPlugins,
  fetchMyPlugins,
  fetchPlugins,
  type HubPluginItem,
} from '../src/lib/navhub-api'
import {
  applyMarketplaceListLoad,
  type MarketplaceListSnapshot,
} from '../src/lib/plugins/marketplace-load-state'
import { MarketplaceLoadError } from '../src/components/marketplace-load-error'
import { PluginMarketBoard } from '../src/components/plugin-market-board'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
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

// next/dynamic 的弹窗在 SSR 输出里不渲染：替成空组件（与 home-drama-cinema-ssr
// 隔离 Link / hook 的做法同款；弹窗本身的覆盖在其余测试里）。
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

// PluginCard 只测 board 的分支路由（空态 / 列表态），不测卡片本身：
// 卡片只渲染插件名，卡片自身的覆盖在其余测试里。
vi.mock('@/components/plugins/plugin-card', async () => {
  const React = await import('react')
  return {
    PluginCard: ({ plugin }: { plugin: { name: string } }) =>
      React.createElement('div', { 'data-testid': 'plugin-card-stub' }, plugin.name),
  }
})

const ENGLISH_TOKENS = /failed to fetch|fetch failed|networkerror|network request failed|load failed|typeerror/i

function pluginItem(slug: string, name: string): HubPluginItem {
  return {
    id: `id-${slug}`,
    slug,
    kind: 'theme',
    name,
    description: `${name} 的描述`,
    version: '1.0.0',
    manifest: {},
    source: 'test',
    status: 'published',
    installCount: 0,
    starCount: 0,
    reportCount: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  // mock 卫生：本文件 mock 了 next/link、next/dynamic、@/components/plugins/plugin-card
  // 三个跨模块目标，清理模块缓存，避免驻留同 worker 的后续文件。
  vi.resetModules()
})

/** fetch 直接抛错（abort / 断网时浏览器的行为） */
function stubFetchThrows(message = 'Failed to fetch') {
  globalThis.fetch = (async () => {
    throw new TypeError(message)
  }) as typeof fetch
}

/** fetch 成功返回 JSON */
function stubFetchOk(body: unknown) {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
}

/* ------------------------------------------------------------------ *
 * A5 — 失败文案全中文：describeDegrade 不许原样透传英文
 * ------------------------------------------------------------------ */

describe('A5 describeDegrade：网络层英文一律翻成中文', () => {
  it.each([
    ['Failed to fetch', 'TypeError'],
    ['TypeError: Failed to fetch', '字符串里的 TypeError 前缀'],
    ['NetworkError when attempting to fetch resource.', 'Firefox'],
    ['Network request failed', 'React Native / Node'],
    ['Load failed', 'Safari'],
    ['fetch failed', 'Node undici'],
  ])('%s（%s）→ 中文、可重试、无英文残留', (raw) => {
    const notice = describeDegrade(new TypeError(raw), '插件市场')
    expect(notice.retryable).toBe(true)
    expect(notice.message).not.toMatch(ENGLISH_TOKENS)
    expect(notice.message).toContain('插件市场')
    expect(notice.message).toMatch(/无法连接|网络|重试/)
  })

  it('超时 → 中文超时文案、可重试', () => {
    const notice = describeDegrade(new Error('Request timed out'), '插件市场')
    expect(notice.retryable).toBe(true)
    expect(notice.message).toContain('超时')
    expect(notice.message).not.toMatch(/timed? ?out|timeout/i)
  })

  it('AbortError → 中文超时文案、可重试', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const notice = describeDegrade(abort, '插件市场')
    expect(notice.retryable).toBe(true)
    expect(notice.message).toContain('超时')
  })

  it('502 / 503 服务端中文原因原样透出、可重试', () => {
    const err = Object.assign(new Error('山羊胡中枢暂时不可用，请稍后再试'), { status: 503 })
    const notice = describeDegrade(err, '插件市场')
    expect(notice.retryable).toBe(true)
    expect(notice.message).toBe('山羊胡中枢暂时不可用，请稍后再试')
  })

  it('404 / 401 不可重试（重试按钮不该出现），且文案仍是中文', () => {
    for (const status of [404, 401]) {
      const err = Object.assign(new Error(''), { status })
      const notice = describeDegrade(err, '插件市场')
      expect(notice.retryable).toBe(false)
      expect(notice.message).not.toMatch(ENGLISH_TOKENS)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 取数层契约：失败 → onDegraded + 空兜底（页面三态的输入）；成功 → 真数据
 * ------------------------------------------------------------------ */

describe('取数层：fetch 抛错时调 onDegraded 并返回空兜底，恢复后返回真数据', () => {
  it('fetchPlugins 失败：onDegraded 拿到 TypeError，返回空兜底，中文 notice 可重试', async () => {
    stubFetchThrows()
    const seen: unknown[] = []
    const res = await fetchPlugins({}, (err) => seen.push(err))
    expect(res).toEqual({ items: [], total: 0, limit: 24, offset: 0 })
    expect(seen).toHaveLength(1)
    const notice = describeDegrade(seen[0], '插件市场')
    expect(notice.retryable).toBe(true)
    expect(notice.message).not.toMatch(ENGLISH_TOKENS)
    expect(notice.message).toContain('插件市场')
  })

  it('fetchMyPlugins / fetchInstalledPlugins 失败：同样调 onDegraded 并返回空兜底', async () => {
    stubFetchThrows()
    const seenMine: unknown[] = []
    const mine = await fetchMyPlugins({ identity: 'anon-test' }, (err) => seenMine.push(err))
    expect(mine.items).toEqual([])
    expect(mine.total).toBe(0)
    expect(seenMine).toHaveLength(1)

    const seenInstalled: unknown[] = []
    const installed = await fetchInstalledPlugins('anon-test', (err) => seenInstalled.push(err))
    expect(installed.items).toEqual([])
    expect(installed.total).toBe(0)
    expect(seenInstalled).toHaveLength(1)
  })

  it('重试恢复：mock 恢复成功后三路都返回真数据（A6 的取数层一半）', async () => {
    const one = pluginItem('demo-theme', '演示主题')
    stubFetchOk({ items: [one], total: 1, limit: 24, offset: 0 })
    const res = await fetchPlugins({})
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.name).toBe('演示主题')

    stubFetchOk({ items: [one], total: 1, limit: 100, offset: 0 })
    const mine = await fetchMyPlugins({ identity: 'anon-test' })
    expect(mine.items).toHaveLength(1)

    stubFetchOk({ items: [one], total: 1 })
    const installed = await fetchInstalledPlugins('anon-test')
    expect(installed.items).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * A1 / A2 / A4 — 状态机：首屏失败立 loadFailed 不写空兜底；
 * 追加 / 静默失败保持原样；成功（含重试恢复）写回并清失败态
 * ------------------------------------------------------------------ */

describe('applyMarketplaceListLoad：失败 ≠ 空', () => {
  type Item = { slug: string }
  const empty: MarketplaceListSnapshot<Item> = { items: [], total: 0, loadFailed: false }
  const loaded: MarketplaceListSnapshot<Item> = {
    items: [{ slug: 'a' }, { slug: 'b' }],
    total: 2,
    loadFailed: false,
  }

  it('A1 首载失败（空初态）：不写空兜底，立 loadFailed', () => {
    const next = applyMarketplaceListLoad(empty, { items: [], total: 0 }, { failed: true, append: false, silent: false })
    expect(next.loadFailed).toBe(true)
    expect(next.items).toEqual([])
    expect(next.total).toBe(0)
    expect(next).not.toBe(empty)
  })

  it('A1 首载失败（筛选变化、已有旧列表）：旧列表与总数原样保留，不清空成空态', () => {
    const next = applyMarketplaceListLoad(loaded, { items: [], total: 0 }, { failed: true, append: false, silent: false })
    expect(next.loadFailed).toBe(true)
    expect(next.items).toEqual([{ slug: 'a' }, { slug: 'b' }])
    expect(next.total).toBe(2)
  })

  it('A2 追加失败：原样返回（旧列表、总数、失败态全不动）', () => {
    const next = applyMarketplaceListLoad(loaded, { items: [], total: 0 }, { failed: true, append: true, silent: false })
    expect(next).toBe(loaded)
  })

  it('A2 静默同步失败：原样返回（SSR 首帧不被抹掉、不立失败态）', () => {
    const next = applyMarketplaceListLoad(loaded, { items: [], total: 0 }, { failed: true, append: false, silent: true })
    expect(next).toBe(loaded)
  })

  it('首载成功：替换列表与总数，清失败态', () => {
    const next = applyMarketplaceListLoad(
      { ...empty, loadFailed: true },
      { items: [{ slug: 'c' }], total: 1 },
      { failed: false, append: false, silent: false },
    )
    expect(next).toEqual({ items: [{ slug: 'c' }], total: 1, loadFailed: false })
  })

  it('A2 追加成功：追加条目；默认取服务端 total，mine 用 Math.max 防总数回落', () => {
    const appended = applyMarketplaceListLoad(loaded, { items: [{ slug: 'c' }], total: 3 }, { failed: false, append: true, silent: false })
    expect(appended.items).toEqual([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }])
    expect(appended.total).toBe(3)
    expect(appended.loadFailed).toBe(false)

    const maxed = applyMarketplaceListLoad(
      loaded,
      { items: [{ slug: 'c' }], total: 1 },
      { failed: false, append: true, silent: false, mergeAppendTotal: (p, n) => Math.max(p, n) },
    )
    expect(maxed.total).toBe(2)
  })

  it('A6 重试恢复：失败 → 成功，列表恢复、失败态消失', () => {
    const failed = applyMarketplaceListLoad(empty, { items: [], total: 0 }, { failed: true, append: false, silent: false })
    expect(failed.loadFailed).toBe(true)
    const recovered = applyMarketplaceListLoad(failed, { items: [{ slug: 'a' }], total: 1 }, { failed: false, append: false, silent: false })
    expect(recovered).toEqual({ items: [{ slug: 'a' }], total: 1, loadFailed: false })
  })
})

/* ------------------------------------------------------------------ *
 * 真渲染：共用失败面板 + board 的空态 / 加载态 / 有数据态（A7 反向）
 * ------------------------------------------------------------------ */

describe('MarketplaceLoadError 真渲染：只显失败文案 + 重试', () => {
  it('网络失败：标题 + 中文原因 + 重试按钮，无英文、无空态断言、无“下方内容可能不完整”', () => {
    const html = renderToString(
      createElement(MarketplaceLoadError, {
        title: '插件市场加载失败',
        notice: { message: '无法连接 插件市场：服务未启动或网络不可达。', retryable: true },
        onRetry: () => {},
      }),
    )
    expect(html).toContain('插件市场加载失败')
    expect(html).toContain('无法连接')
    expect(html).toContain('重试')
    expect(html).toContain('marketplace-load-error')
    expect(html).not.toMatch(ENGLISH_TOKENS)
    expect(html).not.toContain('下方内容可能不完整')
    expect(html).not.toContain('你还没有星标任何插件')
    expect(html).not.toContain('你尚未安装任何插件')
    expect(html).not.toContain('你还没有提交过插件')
  })

  it('401/403（retryable=false）：不渲染死重试按钮，但保留可读原因', () => {
    const html = renderToString(
      createElement(MarketplaceLoadError, {
        title: '插件市场加载失败',
        notice: { message: '未授权：请先在「偏好设置」填入有效的 API Token', retryable: false },
        onRetry: () => {},
      }),
    )
    expect(html).toContain('API Token')
    expect(html).not.toContain('重试')
  })

  it('notice 为 null：给默认中文网络文案 + 重试', () => {
    const html = renderToString(
      createElement(MarketplaceLoadError, {
        title: '我的插件加载失败',
        notice: null,
        onRetry: () => {},
      }),
    )
    expect(html).toContain('网络请求失败')
    expect(html).toContain('重试')
    expect(html).not.toMatch(ENGLISH_TOKENS)
  })
})

describe('PluginMarketBoard 真渲染：空态 / 加载态 / 有数据态', () => {
  const boardProps = {
    initialTotal: 0,
    initialFeatured: null,
    initialRankings: null,
  } as const

  it('A7 取数成功 0 条：空态文案出现，失败态与重试不出现', () => {
    const html = renderToString(
      createElement(PluginMarketBoard, { ...boardProps, initialItems: [] }),
    )
    expect(html).toContain('市场还空着')
    expect(html).not.toContain('marketplace-load-error')
    expect(html).not.toContain('加载失败')
    expect(html).not.toContain('重试')
  })

  it('initialItems 为 null：骨架加载态，不渲染空态断言', () => {
    const html = renderToString(
      createElement(PluginMarketBoard, { ...boardProps, initialItems: null }),
    )
    expect(html).toContain('正在加载插件市场')
    expect(html).not.toContain('市场还空着')
    expect(html).not.toContain('你还没有星标任何插件')
  })

  it('A7 取数成功有数据：列表渲染，失败态与空态均不出现', () => {
    const html = renderToString(
      createElement(PluginMarketBoard, {
        ...boardProps,
        initialItems: [pluginItem('demo-theme', '演示主题')],
        initialTotal: 1,
      }),
    )
    expect(html).toContain('演示主题')
    expect(html).not.toContain('marketplace-load-error')
    expect(html).not.toContain('市场还空着')
    expect(html).not.toContain('你还没有星标任何插件')
  })
})

/* ------------------------------------------------------------------ *
 * 接线顺序守卫（补充）：失败分支排在空态分支之前；load() 走状态机
 * ------------------------------------------------------------------ */

describe('接线顺序守卫（补充：行为由上层覆盖，这里只钉顺序）', () => {
  it('board：失败分支在空态分支之前，且 load() 走 applyMarketplaceListLoad', () => {
    const src = overlayFile('src/components/plugin-market-board.tsx')
    const failureAt = src.indexOf('list.loadFailed ? (')
    const emptyAt = src.indexOf('list.items.length === 0 ? (')
    expect(failureAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(failureAt).toBeLessThan(emptyAt)
    expect(src).toContain('applyMarketplaceListLoad(prev, res, { failed, append, silent })')
    expect(src).toContain('<MarketplaceLoadError title="插件市场加载失败"')
    // 失败时横幅不与失败态叠加：横幅只在非失败态渲染
    expect(src).toContain('{notice && !list.loadFailed && <HubDegradedNotice')
    // 失败时不渲染“共 N 个”与加载更多
    expect(src).toContain('{list.total > 0 && !loading && !list.loadFailed && (')
    expect(src).toContain('{!list.loadFailed && list.items.length < list.total && (')
  })

  it('mine：失败分支在空态分支之前；失败时头部徽章与“共 N 个”整行隐藏', () => {
    const src = overlayFile('src/app/marketplace/mine/page.tsx')
    const failureAt = src.indexOf('list.loadFailed ? (')
    const emptyAt = src.indexOf('list.items.length === 0 ? (')
    expect(failureAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(failureAt).toBeLessThan(emptyAt)
    expect(src).toContain('<MarketplaceLoadError title="我的插件加载失败"')
    expect(src).toContain('{!list.loadFailed && (')
    expect(src).not.toContain('共 {total} 个')
    expect(src).toContain('共 {list.total} 个')
  })

  it('installed：失败分支在空态分支之前；分类栏假零随失败态隐藏；loadData 失败不写空兜底', () => {
    const src = overlayFile('src/app/marketplace/installed/page.tsx')
    const failureAt = src.indexOf('notice && items.length === 0')
    const emptyAt = src.indexOf('你尚未安装任何插件')
    expect(failureAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(failureAt).toBeLessThan(emptyAt)
    const failureBlock = src.slice(failureAt, emptyAt)
    expect(failureBlock).toContain('MarketplaceLoadError')
    expect(failureBlock).not.toContain('你尚未安装')
    expect(src).toContain('{!loadFailed && (')
    expect(src).toContain('if (!failed) {')
    // 过期注释已更新，不再称“无 catch、无 onDegraded”
    expect(src).not.toContain('无 catch、无 onDegraded')
  })
})
