/**
 * P3-8：已安装页分得清「内置引擎 vs 插件引擎」，未登录文案说清本机保存。
 *
 * 验收：
 *  1. 用户能分清内置引擎与插件引擎——6 个默认引擎带 builtin: true，
 *     插件注册的引擎不带；已安装页按 isBuiltinSearchEngine 渲染「内置」/
 *     「插件」标识 + 图例；
 *  2. 换设备行为有说明——未登录时页面写明「仅保存在本机」「换设备……
 *     不会同步」，登录判定走 isLoggedIn()（localStorage 登录 id 键）。
 *
 * 本仓库无 DOM 渲染测试基建（vitest environment 为 node），页面文案与
 * 接线按仓库惯用的源码守卫模式断言（同各 `*-guard.test.ts`）；运行时
 * 区分逻辑用行为单测锁死。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SEARCH_ENGINES,
  getAllSearchEngines,
  isBuiltinSearchEngine,
  matchSearchShortcut,
  type InstalledSearchEngine,
} from '../src/lib/plugins/search-pack-runtime'
import { getIdentity, isLoggedIn } from '../src/lib/identity'

/**
 * 定位 overlay 里的源码文件。测试文件有两份（overlay 源 + apps/web 里的
 * 镜像），相对路径不同，因此按「路径里必须含 web-overlay」消歧。
 */
function overlaySource(rel: string): string {
  const candidates = [`../${rel}`, `../../web-overlay/${rel}`].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  )
  const hit = candidates.find(
    (p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p),
  )
  if (!hit) throw new Error(`无法定位 overlay 的 ${rel}（候选：${candidates.join(' | ')}）`)
  return hit
}

const installedSrc = readFileSync(
  overlaySource('src/app/marketplace/installed/page.tsx'),
  'utf8',
)

const PLUGIN_ENGINE: InstalledSearchEngine = {
  id: 'my-pack::!docs',
  name: 'Docs',
  prefix: '!docs',
  searchUrl: 'https://docs.example.com/search?q={q}',
  pluginSlug: 'my-search-pack',
}

const QUICKLINK_ENGINE: InstalledSearchEngine = {
  id: 'quicklink:my-gh',
  name: '我的 GitHub 镜像站',
  prefix: '!gh',
  searchUrl: 'https://github.example.com/search?q={q}',
}

describe('P3-8：内置引擎与插件引擎能分清（运行时）', () => {
  it('6 个默认引擎全部 builtin: true，且不再挂假的 pluginSlug', () => {
    expect(DEFAULT_SEARCH_ENGINES.map((e) => e.prefix)).toEqual([
      '!gh',
      '!npm',
      '!mdn',
      '!so',
      '!dd',
      '!caniuse',
    ])
    for (const eng of DEFAULT_SEARCH_ENGINES) {
      expect(eng.builtin).toBe(true)
      expect(eng.pluginSlug).toBeUndefined()
      expect(isBuiltinSearchEngine(eng)).toBe(true)
    }
  })

  it('插件注册的引擎与 quicklink 转来的引擎都不是内置', () => {
    expect(isBuiltinSearchEngine(PLUGIN_ENGINE)).toBe(false)
    expect(isBuiltinSearchEngine(QUICKLINK_ENGINE)).toBe(false)
    expect(isBuiltinSearchEngine({ ...PLUGIN_ENGINE, builtin: false })).toBe(false)
  })

  it('getAllSearchEngines() 无插件时 6 条全是内置', () => {
    const all = getAllSearchEngines()
    expect(all).toHaveLength(6)
    expect(all.every((e) => isBuiltinSearchEngine(e))).toBe(true)
  })

  it('内置引擎直达不受标识改动影响：!gh 仍命中', () => {
    expect(matchSearchShortcut('!gh react').directUrl).toBe('https://github.com/search?q=react')
    expect(matchSearchShortcut('!gh react').engine?.builtin).toBe(true)
  })
})

describe('P3-8：未登录身份判定（lib/identity）', () => {
  it('SSR/无 window 时未登录、身份为空串，不抛错', () => {
    expect(isLoggedIn()).toBe(false)
    expect(getIdentity()).toBe('')
  })
})

describe('P3-8：已安装页文案与标识接线（源码守卫）', () => {
  it('未登录文案写明仅保存在本机 + 换设备不会同步', () => {
    expect(installedSrc).toContain('未登录时仅保存在本机')
    expect(installedSrc).toMatch(/换设备.*不会同步/)
    expect(installedSrc).toContain('登录后可在多设备间同步')
  })

  it('匿名文案只在判定为匿名时渲染，不抢先于首载前出现', () => {
    expect(installedSrc).toMatch(/isAnonymous === true/)
    expect(installedSrc).toMatch(/setIsAnonymous\(!isLoggedIn\(\)\)/)
    expect(installedSrc).toMatch(/import \{ getIdentity, isLoggedIn \} from '@\/lib\/identity'/)
  })

  it('引擎按 isBuiltinSearchEngine 分内置/插件渲染标识', () => {
    expect(installedSrc).toMatch(/isBuiltinSearchEngine\(eng\)/)
    expect(installedSrc).toContain('内置')
    expect(installedSrc).toContain('插件')
  })

  it('图例说清两类来源：内置不装插件可用，插件随卸载消失', () => {
    expect(installedSrc).toMatch(/「内置」为系统自带引擎，不装任何插件也可使用/)
    expect(installedSrc).toMatch(/「插件」来自已安装的搜索引擎包，卸载对应插件后消失/)
  })

  it('插件标识带出来源插件 slug，title 也区分内置/插件', () => {
    expect(installedSrc).toMatch(/来自插件 \$\{eng\.pluginSlug\}/)
    expect(installedSrc).toMatch(/内置引擎.*插件引擎/s)
  })
})
