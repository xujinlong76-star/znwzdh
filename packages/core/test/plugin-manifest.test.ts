/**
 * 插件市场契约的「非空性」测试：
 * 每个用例都对应一条发布/导入链路上「不该发生的暗损」——
 * 去掉校验器里的守卫，必有断言变红。
 */
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_LIMITS,
  comparePluginVersions,
  diffPluginManifests,
  normalizePluginUrlKey,
  parsePluginManifestJson,
  pluginKindLabel,
  summarizePluginManifest,
  validateAndCleanPluginManifest,
} from '../src/plugin-manifest.ts'

const validSitePack = {
  manifestVersion: 1,
  kind: 'site-pack',
  name: 'AI 工具集',
  description: '精选 AI 编程工具',
  icon: '🤖',
  version: '1.0.0',
  tags: ['AI', '工具'],
  payload: {
    categories: [{ title: 'AI 编程' }],
    sites: [
      { url: 'https://github.com/features/copilot', title: 'GitHub Copilot', category: 'AI 编程', tags: ['AI'] },
      { url: 'https://cursor.com/', title: 'Cursor', tags: ['AI', 'ai'] },
    ],
  },
}

const validWorkspacePreset = {
  manifestVersion: 1,
  kind: 'workspace-preset',
  name: '极客工作台',
  version: '1.0.0',
  payload: {
    boards: [
      {
        name: '极客工作台',
        widgets: [
          { type: 'clock-pomodoro', colSpan: 3, rowSpan: 1 },
          { type: 'quick-tools', colSpan: 4, rowSpan: 1, config: { note: 'ok' } },
        ],
      },
    ],
  },
}

const validTheme = {
  manifestVersion: 1,
  kind: 'theme',
  name: '紫罗兰之夜',
  version: '1.0.0',
  payload: { accent: 'violet', tokens: { '--primary': '262 83% 58%', '--radius': '0.75rem' } },
}

const validSearchPack = {
  manifestVersion: 1,
  kind: 'search-pack',
  name: '开发者检索包',
  version: '1.0.0',
  payload: {
    engines: [
      { name: 'GitHub Code', prefix: '!gh', searchUrl: 'https://github.com/search?q={q}&type=code', icon: '⚡' },
      { name: 'MDN Web Docs', prefix: '!mdn', searchUrl: 'https://developer.mozilla.org/zh-CN/search?q={q}' },
    ],
  },
}

const validBundle = {
  manifestVersion: 1,
  kind: 'bundle',
  name: '极客起步包',
  description: '一次安装网址包、搜索引擎包与主题',
  version: '1.0.0',
  payload: {
    items: [
      { slug: 'front-end-arsenal', kind: 'site-pack' },
      { slug: 'dev-search-arsenal', kind: 'search-pack' },
      { slug: 'dracula-dark', kind: 'theme' },
    ],
  },
}

function expectFail(input: unknown, ...fragments: string[]) {
  const res = validateAndCleanPluginManifest(input)
  expect(res.ok).toBe(false)
  if (res.ok) return
  const joined = res.errors.join(' | ')
  for (const fragment of fragments) expect(joined).toContain(fragment)
}

function expectOk(input: unknown) {
  const res = validateAndCleanPluginManifest(input)
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(`预期通过但失败：${res.errors.join(' | ')}`)
  return res
}

describe('插件清单校验：基础与元数据', () => {
  it('合法网址包通过校验并保留全部字段', () => {
    const res = expectOk(validSitePack)
    expect(res.manifest.kind).toBe('site-pack')
    expect(res.manifest.name).toBe('AI 工具集')
    expect(res.manifest.description).toBe('精选 AI 编程工具')
    expect(res.manifest.icon).toBe('🤖')
    expect(res.manifest.tags).toEqual(['AI', '工具'])
    expect(res.warnings).toEqual([])
    const payload = res.manifest.payload as { sites: Array<{ title: string }> }
    expect(payload.sites.length).toBe(2)
  })

  it('description 可省略且默认为空串（列表卡片不能拿 undefined 渲染）', () => {
    const res = expectOk({ ...validSitePack, description: undefined })
    expect(res.manifest.description).toBe('')
  })

  it('非对象输入（字符串/数组/null）一律拒绝', () => {
    expectFail('x', 'JSON 对象')
    expectFail(['x'], 'JSON 对象')
    expectFail(null, 'JSON 对象')
  })

  it('manifestVersion 不符拒绝（契约升级必须先改版本）', () => {
    expectFail({ ...validSitePack, manifestVersion: 2 }, 'manifestVersion')
    expectFail({ ...validSitePack, manifestVersion: undefined }, 'manifestVersion')
  })

  it('未知 kind 拒绝', () => {
    expectFail({ ...validSitePack, kind: 'script-pack' }, 'kind')
  })

  it('name 缺失或超长拒绝', () => {
    expectFail({ ...validSitePack, name: '' }, 'name 不能为空')
    expectFail({ ...validSitePack, name: 'x'.repeat(61) }, '60 字符')
  })

  it('version 必须是 x.y.z', () => {
    expectFail({ ...validSitePack, version: '1.0' }, 'x.y.z')
    expectFail({ ...validSitePack, version: 'v1.0.0' }, 'x.y.z')
    expectFail({ ...validSitePack, version: '1.0.0-beta' }, 'x.y.z')
  })

  it('icon 禁远程图片（防追踪/SSRF 诱饵）', () => {
    expectFail({ ...validSitePack, icon: 'https://evil.example/track.png' }, '禁止远程图片')
  })

  it('homepage 非 http(s) 拒绝', () => {
    expectFail({ ...validSitePack, homepage: 'javascript:alert(1)' }, 'http/https')
  })

  it('超过 256KB 的原始负载拒绝（未知字段也要计入体积）', () => {
    expectFail({ ...validSitePack, junk: 'x'.repeat(300 * 1024) }, '256KB 上限')
  })
})

describe('插件清单校验：网址包负载', () => {
  it('包内重复 URL 去重并给出警告（警告必须出现，不能静默）', () => {
    const res = expectOk({
      ...validSitePack,
      payload: {
        sites: [
          { url: 'https://example.com/tool', title: 'A' },
          { url: 'https://EXAMPLE.com/tool/', title: 'B' },
        ],
      },
    })
    const payload = res.manifest.payload as { sites: unknown[] }
    expect(payload.sites.length).toBe(1)
    expect(res.warnings.join(' ')).toContain('重复 URL 已去重：1 条')
  })

  it('站点数组为空拒绝；超过 320 条拒绝', () => {
    expectFail({ ...validSitePack, payload: { sites: [] } }, '至少需要 1 个站点')
    const many = { ...validSitePack, payload: { sites: Array.from({ length: 321 }, (_, i) => ({ url: `https://e.com/s${i}`, title: `S${i}` })) } }
    expectFail(many, '最多 320 个')
  })

  it('javascript:/相对地址/带凭据的 URL 全部拒绝', () => {
    expectFail({ ...validSitePack, payload: { sites: [{ url: 'javascript:alert(1)', title: 'x' }] } }, 'http/https')
    expectFail({ ...validSitePack, payload: { sites: [{ url: '/relative', title: 'x' }] } }, 'http/https')
    expectFail({ ...validSitePack, payload: { sites: [{ url: 'https://u:p@example.com/', title: 'x' }] } }, 'http/https')
  })

  it('站点标题超长、标签超量/超长拒绝', () => {
    expectFail({ ...validSitePack, payload: { sites: [{ url: 'https://e.com', title: 'x'.repeat(121) }] } }, '120 字符')
    expectFail(
      { ...validSitePack, payload: { sites: [{ url: 'https://e.com', title: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }] } },
      '最多 5 个',
    )
    expectFail(
      { ...validSitePack, payload: { sites: [{ url: 'https://e.com', title: 'x', tags: ['x'.repeat(21)] }] } },
      '20 字符',
    )
  })

  it('分类超过 24 个拒绝；包内同名分类去重（大小写不敏感）', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ title: `C${i}` }))
    expectFail({ ...validSitePack, payload: { categories: many, sites: [{ url: 'https://e.com', title: 'x' }] } }, '最多 24 个')
    const res = expectOk({
      ...validSitePack,
      payload: {
        categories: [{ title: 'AI 编程' }, { title: 'ai 编程' }],
        sites: [{ url: 'https://e.com', title: 'x' }],
      },
    })
    const payload = res.manifest.payload as { categories: unknown[] }
    expect(payload.categories.length).toBe(1)
  })
})

describe('插件清单校验：工作台预设负载', () => {
  it('合法预设通过并保留 config', () => {
    const res = expectOk(validWorkspacePreset)
    const payload = res.manifest.payload as { boards: Array<{ widgets: Array<{ config?: Record<string, unknown> }> }> }
    expect(payload.boards[0].widgets[1].config).toEqual({ note: 'ok' })
  })

  it('模块 type 必须是小写字母/数字/连字符', () => {
    expectFail(
      { ...validWorkspacePreset, payload: { boards: [{ name: 'b', widgets: [{ type: 'Clock!', colSpan: 3, rowSpan: 1 }] }] } },
      '格式不合法',
    )
  })

  it('colSpan/rowSpan 缺失或越界拒绝', () => {
    expectFail(
      { ...validWorkspacePreset, payload: { boards: [{ name: 'b', widgets: [{ type: 'clock-pomodoro', colSpan: 13, rowSpan: 1 }] }] } },
      '1..12',
    )
    expectFail(
      { ...validWorkspacePreset, payload: { boards: [{ name: 'b', widgets: [{ type: 'clock-pomodoro', colSpan: 3 }] }] } },
      'rowSpan 必须是整数',
    )
  })

  it('config 中的原型污染键被剥离（__proto__ 不得进入清洗结果）', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as Record<string, unknown>
    const res = expectOk({
      ...validWorkspacePreset,
      payload: { boards: [{ name: 'b', widgets: [{ type: 'clock-pomodoro', colSpan: 3, rowSpan: 1, config: polluted }] }] },
    })
    const payload = res.manifest.payload as { boards: Array<{ widgets: Array<{ config?: Record<string, unknown> }> }> }
    const config = payload.boards[0].widgets[0].config as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(config, '__proto__')).toBe(false)
    expect((Object.getPrototypeOf(config) as Record<string, unknown>).polluted).toBeUndefined()
    expect(config.safe).toBe(1)
  })

  it('config 净化后仍超 8KB 拒绝（防炸弹配置）', () => {
    const bomb = { list: Array.from({ length: 100 }, () => 'x'.repeat(2000)) }
    expectFail(
      { ...validWorkspacePreset, payload: { boards: [{ name: 'b', widgets: [{ type: 'clock-pomodoro', colSpan: 3, rowSpan: 1, config: bomb }] }] } },
      '8KB 上限',
    )
  })

  it('看板/模块数量上限', () => {
    const sixBoards = Array.from({ length: 6 }, (_, i) => ({ name: `b${i}`, widgets: [{ type: 'clock-pomodoro', colSpan: 3, rowSpan: 1 }] }))
    expectFail({ ...validWorkspacePreset, payload: { boards: sixBoards } }, '最多 5 个')
    const manyWidgets = Array.from({ length: 25 }, () => ({ type: 'quick-tools', colSpan: 3, rowSpan: 1 }))
    expectFail({ ...validWorkspacePreset, payload: { boards: [{ name: 'b', widgets: manyWidgets }] } }, '最多 24 个')
  })
})

describe('插件清单校验：主题负载', () => {
  it('合法主题通过', () => {
    const res = expectOk(validTheme)
    const payload = res.manifest.payload as { accent?: string; tokens?: Record<string, string> }
    expect(payload.accent).toBe('violet')
    expect(payload.tokens?.['--primary']).toBe('262 83% 58%')
  })

  it('accent 白名单外的值拒绝', () => {
    expectFail({ ...validTheme, payload: { accent: 'blue' } }, 'accent')
  })

  it('颜色变量必须是 HSL 三段式且在范围内', () => {
    expectFail({ ...validTheme, payload: { tokens: { '--primary': 'blue' } } }, 'HSL 三段式')
    expectFail({ ...validTheme, payload: { tokens: { '--primary': '361 50% 50%' } } }, 'HSL 三段式')
    expectFail({ ...validTheme, payload: { tokens: { '--primary': '262 101% 50%' } } }, 'HSL 三段式')
  })

  it('未知变量与非 rem 圆角拒绝', () => {
    expectFail({ ...validTheme, payload: { tokens: { '--evil': '1 1% 1%' } } }, '不支持变量')
    expectFail({ ...validTheme, payload: { tokens: { '--radius': '3rem' } } }, '0..2rem')
    expectFail({ ...validTheme, payload: { tokens: { '--radius': '12px' } } }, '0..2rem')
  })

  it('空主题（既无 accent 又无 tokens）拒绝', () => {
    expectFail({ ...validTheme, payload: {} }, '至少需要 accent 或 tokens')
  })
})

describe('摘要、版本比较与文本解析', () => {
  it('网址包摘要：站点数/分类数/去重标签/主机前五', () => {
    const res = expectOk(validSitePack)
    const summary = summarizePluginManifest(res.manifest)
    expect(summary.kind).toBe('site-pack')
    expect(summary.siteCount).toBe(2)
    expect(summary.categoryCount).toBe(1)
    expect(summary.uniqueTagCount).toBe(2) // ai + 工具
    expect(summary.hosts).toEqual(['github.com', 'cursor.com'])
  })

  it('工作台摘要：看板数/模块数/类型集合', () => {
    const res = expectOk(validWorkspacePreset)
    const summary = summarizePluginManifest(res.manifest)
    expect(summary.boardCount).toBe(1)
    expect(summary.widgetCount).toBe(2)
    expect(summary.widgetTypes).toEqual(['clock-pomodoro', 'quick-tools'])
  })

  it('主题摘要：accent 与变量数', () => {
    const res = expectOk(validTheme)
    const summary = summarizePluginManifest(res.manifest)
    expect(summary.accent).toBe('violet')
    expect(summary.themeTokenCount).toBe(2)
  })

  it('版本比较按数值段（1.0.10 > 1.0.9 这种必须正确）', () => {
    expect(comparePluginVersions('1.0.0', '1.0.0')).toBe(0)
    expect(comparePluginVersions('1.0.10', '1.0.9')).toBe(1)
    expect(comparePluginVersions('1.1.0', '2.0.0')).toBe(-1)
  })

  it('URL 规范化键：主机小写、去 hash、去尾斜杠、保 query/路径大小写', () => {
    expect(normalizePluginUrlKey('HTTPS://Example.com/Path/#frag')).toBe('https://example.com/Path')
    expect(normalizePluginUrlKey('https://e.com?q=1')).toBe('https://e.com?q=1')
    expect(normalizePluginUrlKey('not a url')).toBe('not a url')
  })

  it('parsePluginManifestJson：非法 JSON 给中文错误，合法文本往返成功', () => {
    const bad = parsePluginManifestJson('{oops')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.join(' ')).toContain('JSON')
    const good = parsePluginManifestJson(JSON.stringify(validTheme))
    expect(good.ok).toBe(true)
  })

  it('kind 中文标签与上限常量对齐', () => {
    expect(pluginKindLabel('site-pack')).toBe('网址包')
    expect(pluginKindLabel('workspace-preset')).toBe('工作台预设')
    expect(pluginKindLabel('theme')).toBe('主题')
    expect(pluginKindLabel('bundle')).toBe('组合包')
    expect(PLUGIN_LIMITS.maxSites).toBe(320)
  })

  it('组合包：校验成员类型/去重/数量，并生成摘要', () => {
    const res = expectOk(validBundle)
    expect(res.manifest.kind).toBe('bundle')
    const summary = summarizePluginManifest(res.manifest)
    expect(summary.bundleItemCount).toBe(3)
    expect(summary.bundleKinds).toEqual(['site-pack', 'search-pack', 'theme'])

    expectFail({ ...validBundle, payload: { items: [] } }, '至少需要 1 个成员')
    expectFail(
      { ...validBundle, payload: { items: [{ slug: 'a', kind: 'bundle' }] } },
      '禁止嵌套组合包或工作台预设',
    )
    expectFail(
      { ...validBundle, payload: { items: [{ slug: 'a', kind: 'workspace-preset' }] } },
      '禁止嵌套组合包或工作台预设',
    )
    expectFail(
      { ...validBundle, payload: { items: [{ slug: 'a', kind: 'site-pack' }, { slug: 'A', kind: 'theme' }] } },
      'slug 重复',
    )
    expectFail(
      { ...validBundle, payload: { items: [{ slug: 'bad slug', kind: 'site-pack' }] } },
      '不能包含空白',
    )
    expectFail(
      {
        ...validBundle,
        payload: {
          items: Array.from({ length: 13 }, (_, i) => ({ slug: `p-${i}`, kind: 'site-pack' })),
        },
      },
      '最多 12 个',
    )
  })
})

describe('版本升级差异对比 (diffPluginManifests)', () => {
  it('检测 site-pack 新增站点、移除站点与修改站点', () => {
    const base = expectOk(validSitePack).manifest
    const target = expectOk({
      ...validSitePack,
      version: '1.1.0',
      payload: {
        categories: [{ title: 'AI 编程' }, { title: '数据分析' }],
        sites: [
          { url: 'https://github.com/features/copilot', title: 'GitHub Copilot (Pro)', category: 'AI 编程' },
          { url: 'https://chatgpt.com/', title: 'ChatGPT', category: '数据分析' },
        ],
      },
    }).manifest

    const diff = diffPluginManifests(base, target)
    expect(diff.hasChanges).toBe(true)
    expect(diff.versionFrom).toBe('1.0.0')
    expect(diff.versionTo).toBe('1.1.0')
    expect(diff.versionCompared).toBe(1)
    expect(diff.sitesAddedCount).toBe(1) // chatgpt
    expect(diff.sitesRemovedCount).toBe(1) // cursor
    expect(diff.sitesModifiedCount).toBe(1) // copilot title modified
    expect(diff.categoriesAdded).toEqual(['数据分析'])
    expect(diff.siteChanges?.find((s) => s.url === 'https://chatgpt.com/')?.status).toBe('added')
    expect(diff.siteChanges?.find((s) => s.url === 'https://cursor.com/')?.status).toBe('removed')
  })

  it('检测 theme 颜色变量增删改与主色调变动', () => {
    const base = expectOk(validTheme).manifest
    const target = expectOk({
      ...validTheme,
      version: '1.2.0',
      payload: {
        accent: 'emerald',
        tokens: {
          '--primary': '142 76% 36%',
          '--accent': '142 70% 45%',
        },
      },
    }).manifest

    const diff = diffPluginManifests(base, target)
    expect(diff.hasChanges).toBe(true)
    expect(diff.accentChanged).toBe(true)
    expect(diff.oldAccent).toBe('violet')
    expect(diff.newAccent).toBe('emerald')
    expect(diff.tokensAddedCount).toBe(1) // --accent
    expect(diff.tokensRemovedCount).toBe(1) // --radius
    expect(diff.tokensModifiedCount).toBe(1) // --primary
  })

  it('无任何变更时 hasChanges 为 false', () => {
    const base = expectOk(validWorkspacePreset).manifest
    const target = expectOk(validWorkspacePreset).manifest
    const diff = diffPluginManifests(base, target)
    expect(diff.hasChanges).toBe(false)
    expect(diff.versionCompared).toBe(0)
  })

  it('支持 search-pack 合法格式校验、摘要与错误拦截', () => {
    // 正常通过
    const ok = expectOk(validSearchPack).manifest
    expect(ok.kind).toBe('search-pack')
    const summary = summarizePluginManifest(ok)
    expect(summary.engineCount).toBe(2)
    expect(summary.enginePrefixes).toEqual(['!gh', '!mdn'])

    // 前缀缺叹号拦截
    expectFail(
      {
        ...validSearchPack,
        payload: { engines: [{ name: 'Test', prefix: 'badprefix', searchUrl: 'https://example.com?q={q}' }] },
      },
      '必须以叹号开头',
    )

    // 重复前缀拦截
    expectFail(
      {
        ...validSearchPack,
        payload: {
          engines: [
            { name: 'Test1', prefix: '!gh', searchUrl: 'https://example.com?q={q}' },
            { name: 'Test2', prefix: '!gh', searchUrl: 'https://example2.com?q={q}' },
          ],
        },
      },
      '前缀重复',
    )

    // 缺少 {q} 占位符拦截
    expectFail(
      {
        ...validSearchPack,
        payload: { engines: [{ name: 'Test', prefix: '!test', searchUrl: 'https://example.com/search' }] },
      },
      '必须包含 {q} 查询占位符',
    )
  })

  it('检测 search-pack 搜索引擎增删差异', () => {
    const base = expectOk(validSearchPack).manifest
    const target = expectOk({
      ...validSearchPack,
      version: '1.1.0',
      payload: {
        engines: [
          { name: 'GitHub Code', prefix: '!gh', searchUrl: 'https://github.com/search?q={q}&type=code' },
          { name: 'NPM Packages', prefix: '!npm', searchUrl: 'https://www.npmjs.com/search?q={q}' },
        ],
      },
    }).manifest

    const diff = diffPluginManifests(base, target)
    expect(diff.hasChanges).toBe(true)
    expect(diff.enginesAdded).toEqual(['NPM Packages'])
    expect(diff.enginesRemoved).toEqual(['MDN Web Docs'])
  })

  it('检测 bundle 成员增删与类型变更', () => {
    const base = expectOk(validBundle).manifest
    const target = expectOk({
      ...validBundle,
      version: '1.1.0',
      payload: {
        items: [
          { slug: 'front-end-arsenal', kind: 'site-pack' },
          { slug: 'dracula-dark', kind: 'search-pack' },
          { slug: 'new-theme', kind: 'theme' },
        ],
      },
    }).manifest

    const diff = diffPluginManifests(base, target)
    expect(diff.hasChanges).toBe(true)
    expect(diff.bundleItemsAdded).toEqual(['dracula-dark', 'new-theme'])
    expect(diff.bundleItemsRemoved).toEqual(['dracula-dark', 'dev-search-arsenal'])
  })

  it('GlassWorm 防御：严格拦截包含零宽字符或 Bidi 控制符的恶意清单', () => {
    // 注入零宽空格 \u200B
    const withZeroWidth = {
      ...validSitePack,
      name: 'AI\u200B工具集',
    }
    const res1 = validateAndCleanPluginManifest(withZeroWidth)
    expect(res1.ok).toBe(false)
    expect(res1.errors.some((e) => e.includes('GlassWorm'))).toBe(true)

    // 注入 Bidi RLO 双向欺骗控制符 \u202E
    const withBidi = {
      ...validSitePack,
      description: '正常介绍\u202E反转欺骗',
    }
    const res2 = validateAndCleanPluginManifest(withBidi)
    expect(res2.ok).toBe(false)
    expect(res2.errors.some((e) => e.includes('GlassWorm'))).toBe(true)

    // 注入私用区字符 PUA \uE001
    const withPua = {
      ...validSitePack,
      author: 'Official\uE001Hacker',
    }
    const res3 = validateAndCleanPluginManifest(withPua)
    expect(res3.ok).toBe(false)
    expect(res3.errors.some((e) => e.includes('GlassWorm'))).toBe(true)
  })
})

