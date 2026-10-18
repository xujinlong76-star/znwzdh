/**
 * 侧边栏的分类图标原本是这么查的：
 *
 *     import * as LucideIcons from 'lucide-react'
 *     const Icon = LucideIcons[iconName] || LucideIcons.Folder
 *
 * 命名空间导入让打包器无法 tree-shaking。实测 `/videos` 的路由包里因此多出
 * **487 kB**（图标路径数据）+ **137 kB**（全量图标索引）两个 chunk，
 * First Load JS 349 kB —— 而同规模的 `/hot` 只有 205 kB。
 *
 * 更糟的是这份体积是白花的：数据里的名字是小写的 `code` / `sparkles`，
 * 与 lucide 的 PascalCase 导出对不上，`LucideIcons['code']` 是 undefined，
 * 于是每个分类都显示成兜底的文件夹图标。
 *
 * 现在真实数据全部命中静态映射（下面的测试直接读数据文件来证明这一点），
 * 表外名字才由 components/nav-icon.tsx 按需拉取整包兜底。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NAV_ICONS, NAV_ICON_FALLBACK, isIconUrl, resolveNavIcon } from '../src/lib/nav-icons'

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

function repoRoot(): string {
  let dir = ROOT
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = dirname(dir)
  }
  throw new Error('找不到仓库根目录（应有 pnpm-workspace.yaml）')
}

const REPO = repoRoot()

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/**
 * 去掉注释再断言：本仓库的说明性注释里会**引用**那段反面代码，
 * 不剥注释的守卫会被自己的文档骗过去（真发生过）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listSources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, '/'))
  }
  return out
}

/** 线上数据（web 端内容基线）里的分类/子分类图标名 */
function webContentIconNames(): string[] {
  const file = join(REPO, 'apps', 'web', 'src', 'navsphere', 'content', 'navigation.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    navigationItems?: Array<{ icon?: string; subCategories?: Array<{ icon?: string }> }>
  }
  const names: string[] = []
  for (const item of data.navigationItems ?? []) {
    if (typeof item.icon === 'string') names.push(item.icon)
    for (const sub of item.subCategories ?? []) {
      if (typeof sub.icon === 'string') names.push(sub.icon)
    }
  }
  return names
}

/** 中枢 seed 数据里的图标名（含站点图标 URL，用 isIconUrl 过滤掉） */
function seedIconNames(): string[] {
  const file = join(REPO, 'apps', 'api', 'src', 'seed-data.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as unknown
  const names: string[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (typeof record.icon === 'string') names.push(record.icon)
      Object.values(record).forEach(walk)
    }
  }
  walk(data)
  return names
}

describe('真实数据里的图标名必须命中静态映射', () => {
  it('先确认真的读到了数据（否则空数组会假装通过）', () => {
    const names = webContentIconNames()
    expect(names.length).toBeGreaterThan(5)
    expect(seedIconNames().length).toBeGreaterThan(5)
  })

  it('web 内容基线里的分类/子分类图标全部命中（否则首屏会去拉整包）', () => {
    // 数据里有一个空的 icon: ""，由 sidebar 的 `if (!iconName)` 分支兜底，不算漏网
    const names = [...new Set(webContentIconNames().filter((n) => n.trim() !== '' && !isIconUrl(n)))]
    expect(names.length).toBeGreaterThan(5)
    const misses = names.filter((n) => resolveNavIcon(n) === null)
    expect(misses, `这些名字没进静态表：${misses.join(', ')}`).toEqual([])
  })

  it('中枢 seed 的小写名字也命中（sparkles / code / palette / book / coffee）', () => {
    const names = [...new Set(seedIconNames().filter((n) => n.trim() !== '' && !isIconUrl(n)))]
    expect(names).toContain('code')
    const misses = names.filter((n) => resolveNavIcon(n) === null)
    expect(misses, `这些名字没进静态表：${misses.join(', ')}`).toEqual([])
  })

  it('历史遗留的 linecons-thumbs-up 有明确映射（不再默默显示文件夹）', () => {
    expect(webContentIconNames()).toContain('linecons-thumbs-up')
    expect(resolveNavIcon('linecons-thumbs-up')).toBe(NAV_ICONS['linecons-thumbs-up'])
    expect(resolveNavIcon('linecons-thumbs-up')).not.toBeNull()
  })
})

describe('名字解析', () => {
  it('大小写无关：code 与 Code 解析到同一个图标', () => {
    const lower = resolveNavIcon('code')
    expect(lower).not.toBeNull()
    expect(resolveNavIcon('Code')).toBe(lower)
    expect(resolveNavIcon('CODE')).toBe(lower)
  })

  it('前后空白不影响解析（数据来自后台输入框）', () => {
    expect(resolveNavIcon('  Star  ')).toBe(resolveNavIcon('Star'))
  })

  it('未知名字返回 null —— 交给 NavIcon 按需兜底，而不是当成图标渲染', () => {
    expect(resolveNavIcon('definitely-not-a-lucide-icon')).toBeNull()
  })

  it('空值不会炸：undefined / null / 空串 / 纯空白都返回 null', () => {
    expect(resolveNavIcon(undefined)).toBeNull()
    expect(resolveNavIcon(null)).toBeNull()
    expect(resolveNavIcon('')).toBeNull()
    expect(resolveNavIcon('   ')).toBeNull()
  })

  it('兜底图标存在（旧实现是 Folder，保持同一个视觉结果）', () => {
    expect(NAV_ICON_FALLBACK).toBeTruthy()
    expect(NAV_ICON_FALLBACK).toBe(NAV_ICONS['folder'])
  })

  it('图标字段可能是图片地址：isIconUrl 只认路径与 http(s)', () => {
    expect(isIconUrl('/assets/images/logos/claude.webp')).toBe(true)
    expect(isIconUrl('https://icon.horse/icon/github.com')).toBe(true)
    expect(isIconUrl('http://example.com/a.png')).toBe(true)
    expect(isIconUrl('code')).toBe(false)
    expect(isIconUrl('Code')).toBe(false)
    expect(isIconUrl('')).toBe(false)
  })
})

describe('全仓护栏：整包 lucide 不许再进首屏', () => {
  const sources = listSources(join(ROOT, 'src'))

  it('先确认扫描覆盖面（源文件数量）', () => {
    expect(sources.length).toBeGreaterThan(50)
  })

  it('没有任何文件再用 `import * as ... from "lucide-react"`', () => {
    const offenders = sources.filter((rel) =>
      /import\s+\*\s+as\s+\w+\s+from\s+['"]lucide-react['"]/.test(stripComments(overlaySource(rel))),
    )
    expect(offenders).toEqual([])
  })

  it('整包 lucide 只允许在 nav-icon.tsx 里**按需**加载', () => {
    const dynamic = sources.filter((rel) =>
      /import\(\s*['"]lucide-react['"]\s*\)/.test(stripComments(overlaySource(rel))),
    )
    expect(dynamic).toEqual(['src/components/nav-icon.tsx'])
  })

  it('sidebar 用静态映射 + NavIcon，不再引用 LucideIcons', () => {
    const sidebar = stripComments(overlaySource('src/components/sidebar.tsx'))
    expect(sidebar).not.toContain('LucideIcons')
    expect(sidebar).toContain('resolveNavIcon(')
    expect(sidebar).toContain('<NavIcon name={iconName}')
    expect(sidebar).toContain('NAV_ICON_FALLBACK')
  })

  it('懒加载兜底组件保持「客户端 + 可取消」的写法', () => {
    const src = overlaySource('src/components/nav-icon.tsx')
    expect(src).toContain("'use client'")
    expect(src).toContain("import('lucide-react')")
    expect(src).toContain('cancelled')
  })
})
