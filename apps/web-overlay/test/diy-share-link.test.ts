/**
 * 免登分享链接（#diy=）的编码与接线守卫。
 *
 * 修的是什么：`exportPresetToUrlHash()` 以前把编码整段包在 try 里，失败就 `return ''`；
 * 调用方写的是 `if (!url) return`。于是「点了分享按钮，界面毫无反应」——不报错、
 * 不提示、控制台也没痕迹，用户只能以为按钮坏了。
 *
 * 现在编码抽成 lib/diy-share-link.ts 的纯函数，失败返回**原因**，调用方必须讲出来。
 * 这里覆盖两半：行为（成功可往返、真实失败都返回 ok:false + 原因）与接线
 * （工具栏必须说话、不能再退回裸 return；没人调用的重复实现已删除）。
 *
 * 说明：断言刻意不依赖「把注释挖空」的扫描器 —— 那个扫描器一旦在某行
 * 被字符串/正则里的引号带偏，后面所有注释都会漏屏蔽（本项目里真栽过）。
 * 这里改成要求代码里出现 `if (!out.ok) { … toast(` 这种**语义**形态，
 * 注释里引用旧代码不会误判，因为注释里不会同时具备 out.ok 和 toast。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SHARE_LINK_MAX_BYTES,
  decodeShareLinkPayload,
  describeShareLinkFailure,
  encodeShareLink,
  encodeVersionedShareLink,
  parseSharePayload,
} from '../src/lib/diy-share-link'
import {
  DIY_LAYOUT_FIELD_NAMES,
  DIY_SHARE_PAYLOAD_VERSION,
  KNOWN_HERO_WIDGET_IDS,
  SHARE_SHORT_KEY_MAP,
  deepStripDangerousKeys,
} from '../src/lib/modular/diy-layout-schema'
import {
  applyHomeDiyShareHash,
  getHomeDiySnapshot,
  resetHomeDiySharedState,
} from '../src/lib/modular/home-diy-storage'
import { LayoutSchema, sanitizeDiyLayoutInput } from '../src/lib/modular/diy-layout-schema-zod'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const BASE = { origin: 'https://nav.example', pathname: '/' }

/** 取 URL 里的 #diy= 负载并解回对象 */
function decodeOutcome(url: string): unknown {
  const b64 = url.slice(url.indexOf('#diy=') + '#diy='.length)
  return JSON.parse(decodeURIComponent(atob(b64)))
}

describe('encodeShareLink：成功要能往返，失败要给出原因', () => {
  it('成功时给出 <origin><pathname>#diy=<base64>，且能解回原对象', () => {
    const payload = { vm: 'grid', bg: 'aurora', n: 3, nested: { a: [1, 2] } }
    const out = encodeShareLink(payload, BASE)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.url.startsWith('https://nav.example/#diy=')).toBe(true)
    expect(decodeOutcome(out.url)).toEqual(payload)
  })

  it('中文与 emoji 也能往返（encodeURIComponent + btoa 的组合）', () => {
    const payload = { note: '排版·壁纸 🎨', title: '我的首页' }
    const out = encodeShareLink(payload, BASE)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(decodeOutcome(out.url)).toEqual(payload)
  })

  it('循环引用：不抛错、不返回空串，而是 ok:false + 原因', () => {
    const circle: Record<string, unknown> = { name: 'x' }
    circle.self = circle
    const out = encodeShareLink(circle, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason.length).toBeGreaterThan(0)
    expect(out.reason).toContain('复制配置')
  })

  it('BigInt 序列化不了', () => {
    // 用 BigInt(10) 而不是 10n：本仓库的 tsconfig target 低于 ES2020，字面量会报 TS2737
    const out = encodeShareLink({ big: BigInt(10) }, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('分享链接')
  })

  it('落单的代理项（半个 emoji）：JSON 会转义成 \\ud800，照样能往返', () => {
    // 这里本来想断言「btoa 会在半个 emoji 上失败」，实测不成立：
    // JSON.stringify 已经把落单代理项转义成纯 ASCII 的 \\ud800，
    // 根本走不到 btoa 的报错分支。与其留一条假失败用例，不如钉住真实行为。
    const payload = { broken: '\uD800' }
    const out = encodeShareLink(payload, BASE)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.url).not.toContain('\uD800')
    expect(decodeOutcome(out.url)).toEqual(payload)
  })

  it('压根序列化不出字符串（函数 / undefined）也算失败', () => {
    expect(encodeShareLink(() => {}, BASE).ok).toBe(false)
    expect(encodeShareLink(undefined, BASE).ok).toBe(false)
  })

  it('超过 4KB 上限时提前说清楚，而不是生成一个导入侧一定会丢的链接', () => {
    const out = encodeShareLink({ blob: 'x'.repeat(SHARE_LINK_MAX_BYTES * 2) }, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('4KB')
  })

  it('正常大小的负载仍然成功（上限不是摆设）', () => {
    const ok = encodeShareLink({ blob: 'y'.repeat(64) }, BASE)
    expect(ok.ok).toBe(true)
  })

  it('页面基准不完整时直接拒绝，不去拼一个坏链接', () => {
    // @ts-expect-error 故意传坏基准
    expect(encodeShareLink({ a: 1 }, { origin: 'https://x' }).ok).toBe(false)
    // @ts-expect-error 同上：空基准
    expect(encodeShareLink({ a: 1 }, null).ok).toBe(false)
  })

  it('TypeError 与其他错误给不同文案（循环引用 vs 其他）', () => {
    const circular = describeShareLinkFailure(new TypeError('Converting circular structure to JSON'))
    const other = describeShareLinkFailure(new Error('boom'))
    expect(circular).not.toBe(other)
    expect(circular).toContain('无法序列化')
    expect(other).toContain('复制配置')
  })
})

/**
 * 失败分支是不是「说了话」而不是裸 return。
 *
 * 先按行丢掉注释（行注释 + 块注释），再要求代码里出现
 * `if (!out.ok) { … toast(`。这样注释里引用旧写法（比如解释
 * 「以前是 if (!url) return」的那段话）不会误判，而把修复注释掉也骗不过守卫。
 * 刻意不用「逐字符跟踪引号」的扫描器：那种实现在长文件里一旦被字符串或
 * 正则里的引号带偏，后面所有注释都会漏屏蔽（本项目真栽过一次）。
 */
export function failureIsAnnounced(source: string): boolean {
  let inBlock = false
  const code = source
    .split(/\r?\n/)
    .map((line) => {
      if (inBlock) {
        if (line.includes('*/')) inBlock = false
        return ''
      }
      if (line.trim().startsWith('//')) return ''
      const open = line.indexOf('/*')
      if (open !== -1 && !line.includes('*/', open + 2)) {
        inBlock = true
        return line.slice(0, open)
      }
      return line
    })
    .join('\n')
  return /if\s*\(\s*!\s*out\.ok\s*\)\s*\{[^}]*toast\s*\(/.test(code)
}

describe('守卫本体：能认出「静默失败」也会误判', () => {
  it('识别「失败分支里有 toast」的写法', () => {
    expect(failureIsAnnounced('if (!out.ok) { toast({ title: "x" }); return }')).toBe(true)
  })

  it('裸 return 的写法被判掉（这就是原来的 bug）', () => {
    expect(failureIsAnnounced('if (!out.ok) return')).toBe(false)
    expect(failureIsAnnounced('const url = exportPresetToUrlHash()\nif (!url) return')).toBe(false)
  })

  it('注释里引用旧写法不该被当成违规，但也不能替代码通过', () => {
    const withComment =
      '// 以前是 if (!out.ok) return\nconst f = () => { if (!out.ok) { toast({ title: "x" }); return } }'
    expect(failureIsAnnounced(withComment)).toBe(true)
    expect(failureIsAnnounced('// if (!out.ok) { toast({}) }')).toBe(false)
  })

  it('块注释里包着的写法也不算数', () => {
    expect(failureIsAnnounced('/*\nif (!out.ok) { toast({ title: "x" }) }\n*/')).toBe(false)
    expect(
      failureIsAnnounced('/* 说明 */\nif (!out.ok) { toast({ title: "x" }); return }'),
    ).toBe(true)
  })
})

describe('分享入口：分享失败必须说出来', () => {
  const toolbar = readFileSync(resolve(ROOT, 'src', 'components', 'home-diy-toolbar.tsx'), 'utf8')
  // P1-2 拆分后，分享 handler 随备份弹窗迁入独立组件（工具栏只透传 props）
  const dialog = readFileSync(resolve(ROOT, 'src', 'components', 'home-diy-backup-dialog.tsx'), 'utf8')
  const hook = readFileSync(resolve(ROOT, 'src', 'lib', 'modular', 'use-home-diy.ts'), 'utf8')
  // P1-1 拆分后，hydrateHomeDiy 与 #diy 免登导入在 home-diy-storage.ts
  const storage = readFileSync(resolve(ROOT, 'src', 'lib', 'modular', 'home-diy-storage.ts'), 'utf8')

  it('handleShareUrlHash 拿的是带原因的结果，失败分支里有 toast', () => {
    const body = dialog.slice(dialog.indexOf('const handleShareUrlHash'))
    expect(body.includes('const out = exportPresetToUrlHash()')).toBe(true)
    expect(failureIsAnnounced(body)).toBe(true)
  })

  it('解构里不再有那个没人调用的 importPresetFromUrlHash', () => {
    expect(/^\s*importPresetFromUrlHash,?\s*$/m.test(toolbar)).toBe(false)
  })

  it('免登导入只剩一条实现（applyHomeDiyShareHash），且确实被调用', () => {
    const hookAndStorage = hook + storage
    expect(/const importPresetFromUrlHash\s*=/.test(hookAndStorage)).toBe(false)
    expect(/^\s*importPresetFromUrlHash,?\s*$/m.test(hookAndStorage)).toBe(false)
    expect(/const share = await applyHomeDiyShareHash\(\)/.test(storage)).toBe(true)
    // live 解码走 v1 感知的 parseSharePayload（async，须 await；旧内联解析已删，
    // 见「单条解析管线」守卫）：生成的 v1 信封链接经这条路才能打开。
    expect(storage).toContain('await parseSharePayload(')
    // 分享不再立即应用、也不提前返回：只挂起待确认，本地配置照常读
    expect(/if \(share\.applied\) return/.test(storage)).toBe(false)
    expect(/pendingShare: \{ imported, diff, warning, carriedFields, source: 'share' \}/.test(storage)).toBe(true)
    expect(/computeHomeDiyShareDiff\(sharedState\.config, imported, carriedFields\)/.test(storage)).toBe(true)
    // 字段级合并：确认时只写链接实际携带的字段（carriedFields），没携带的
    // 字段保持本地值——不再拿清洗后的全量 imported 整表替换。
    expect(/mergeHomeDiyShareFields\(prev, pending\.imported, pending\.carriedFields\)/.test(storage)).toBe(true)
    expect(storage).toContain('carriedFields')
    // 链接里被白名单/上限吃掉的内容必须挂到用户看得见的横幅上，不能只 console.warn
    expect(
      /if \(share\.warning\) commitSharedState\(\{ storageWarning: trackStorageWarning\('share', share\.warning\) \}\)/.test(
        storage,
      ),
    ).toBe(true)
  })

  it('导出类型是「带原因的结果」，不再是可能为空的字符串', () => {
    expect(hook.includes('useCallback((): ShareLinkOutcome =>')).toBe(true)
    // 导出走 v1 信封（encodeVersionedShareLink），旧链接仍可读
    expect(hook.includes('encodeVersionedShareLink(')).toBe(true)
  })

  it('插槽时钟键从 home-diy-storage 导出，hook 不再硬编码字面量', () => {
    expect(storage).toContain("export const STORAGE_CLOCKS_KEY = 'navhub_home_diy_clocks_v1'")
    expect(hook).toContain('STORAGE_CLOCKS_KEY')
    expect(hook).toContain('readSlotClocks(STORAGE_CLOCKS_KEY)')
    expect(hook).not.toContain("'navhub_home_diy_clocks_v1'")
  })

  it('确认对话框按携带字段重算差异预览，不把未携带字段算成变化', () => {
    const dialog = readFileSync(
      resolve(ROOT, 'src', 'components', 'diy', 'home-diy-share-confirm-dialog.tsx'),
      'utf8',
    )
    expect(dialog).toContain('computeHomeDiyShareDiff(config, pendingShare.imported, pendingShare.carriedFields)')
  })
})

/* ------------------------------------------------------------------ *
 * P1-5：分享载荷加固 —— 新信封 v1 双读、旧链接永久可读、恶意载荷点名
 * ------------------------------------------------------------------ */

function encodeHash(obj: unknown): string {
  return '#diy=' + btoa(encodeURIComponent(JSON.stringify(obj)))
}

describe('decodeShareLinkPayload：只管 base64 → JSON，不管字段', () => {
  it('旧短字段载荷能解回原对象', () => {
    const payload = { v: 3, vm: 'classic', co: ['cat-a'] }
    const out = decodeShareLinkPayload(encodeHash(payload))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.raw).toEqual(payload)
  })

  it('不带 #diy= 前缀的裸 base64 也认', () => {
    const out = decodeShareLinkPayload(encodeHash({ vm: 'hybrid' }).slice('#diy='.length))
    expect(out.ok).toBe(true)
  })

  it('空 hash 与坏 base64 / 坏 JSON 都给出原因，不抛错', () => {
    expect(decodeShareLinkPayload('').ok).toBe(false)
    expect(decodeShareLinkPayload('#diy=').ok).toBe(false)
    expect(decodeShareLinkPayload('#diy=!!!not-base64!!!').ok).toBe(false)
    const badJson = decodeShareLinkPayload('#diy=' + btoa(encodeURIComponent('{oops')))
    expect(badJson.ok).toBe(false)
    if (!badJson.ok) expect(badJson.reason.length).toBeGreaterThan(0)
  })

  it('超过 4KB 的 hash 整条拒收', () => {
    const out = decodeShareLinkPayload('#diy=' + 'A'.repeat(SHARE_LINK_MAX_BYTES + 1))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('4KB')
  })
})

describe('parseSharePayload：旧链接永久可读，新信封 v1 双读', () => {
  it('旧链接（短字段 + v: 3）：字段认得出，v 不算未知字段', async () => {
    const res = await parseSharePayload({ v: 3, vm: 'classic', co: ['cat-a'] })
    expect(res.ok).toBe(true)
    expect(res.format).toBe('legacy')
    expect(res.carriedFields).toEqual(['viewMode', 'categoryOrder'])
    expect(res.config?.viewMode).toBe('classic')
    expect(res.config?.categoryOrder).toEqual(['cat-a'])
    expect(res.dropped).toBe(0)
    expect(res.warning).toBeNull()
  })

  it('旧链接（长字段）：同样认得出，短字段优先于长字段', async () => {
    const res = await parseSharePayload({ viewMode: 'classic', bg: 'grid', accentColor: 'rose' })
    expect(res.ok).toBe(true)
    expect(res.carriedFields).toEqual(['viewMode', 'canvasBackground', 'accentColor'])
    expect(res.config?.canvasBackground).toBe('grid')
    const both = await parseSharePayload({ vm: 'workbench', viewMode: 'classic' })
    expect(both.config?.viewMode).toBe('workbench')
  })

  it('旧链接里被白名单吃掉的内容：条数与原因对得上（与 storage 的 warning 同口径）', async () => {
    const res = await parseSharePayload({ vm: 'hybrid', co: ['cat-a', 'cat-b', 5, {}, '__proto__'] })
    expect(res.ok).toBe(true)
    expect(res.dropped).toBe(3)
    expect(res.warning).toContain('3 项内容被丢弃或截断')
    expect(res.warning).toContain('分类顺序')
    expect(res.config?.categoryOrder).toEqual(['cat-a', 'cat-b'])
  })

  it('新信封 { diy: 1, config }：认作 v1，字段照读', async () => {
    const res = await parseSharePayload({ diy: 1, config: { viewMode: 'classic', categoryOrder: ['x'] } })
    expect(res.ok).toBe(true)
    expect(res.format).toBe('v1')
    expect(res.carriedFields).toEqual(['viewMode', 'categoryOrder'])
    expect(res.config?.viewMode).toBe('classic')
  })

  it('encodeVersionedShareLink → decode → parse 全程往返，格式是 v1', async () => {
    const full = {
      version: 3,
      viewMode: 'workbench',
      cardDisplayMode: 'compact',
      canvasBackground: 'dots',
      accentColor: 'amber',
      categoryOrder: ['cat-a'],
      pinnedCategoryIds: ['pin-1'],
      hiddenCategoryIds: [],
      siteCategoryOverrides: { 'site-1': 'cat-a' },
      customWallpaperUrl: 'https://example.com/w.jpg',
      glassmorphismBlur: 18,
      cardOpacity: 0.9,
    } as never
    const encoded = encodeVersionedShareLink(full, BASE)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeShareLinkPayload(encoded.url.slice(encoded.url.indexOf('#diy=')))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect((decoded.raw as { diy?: unknown }).diy).toBe(DIY_SHARE_PAYLOAD_VERSION)
    const parsed = await parseSharePayload(decoded.raw)
    expect(parsed.ok).toBe(true)
    expect(parsed.format).toBe('v1')
    expect(parsed.config?.viewMode).toBe('workbench')
    expect(parsed.config?.accentColor).toBe('amber')
    expect(parsed.config?.categoryOrder).toEqual(['cat-a'])
  })

  it('未知信封版本拒收，不猜：diy: 2 与 diy: 1 但没 config 都不行', async () => {
    const future = await parseSharePayload({ diy: 2, config: { viewMode: 'classic' } })
    expect(future.ok).toBe(false)
    expect(future.error).toContain('v2')
    expect((await parseSharePayload({ diy: 1 })).ok).toBe(false)
    expect((await parseSharePayload({ diy: 1, config: 'nope' })).ok).toBe(false)
  })

  it('结构问题不拒收整条链接：走清洗器兜底，只把问题记进 notes', async () => {
    // viewMode 是数字：zod  fails，清洗器回退 hybrid；链接本身仍可读
    const res = await parseSharePayload({ viewMode: 123, version: 3 })
    expect(res.ok).toBe(true)
    expect(res.config?.viewMode).toBe('hybrid')
    expect(res.notes.join('\n')).toContain('viewMode')
  })

  it('空对象 / 非对象拒收（缺 viewMode/version 时清洗器本来就拒收）', async () => {
    expect((await parseSharePayload({ nothing: true })).ok).toBe(false)
    expect((await parseSharePayload(null)).ok).toBe(false)
    expect((await parseSharePayload('nope')).ok).toBe(false)
  })
})

describe('恶意载荷：原型污染、未知类型、重复 id、超限、循环引用', () => {
  it('__proto__ / constructor 键被深剥，且不碰原型链', async () => {
    const hostile = JSON.parse(
      '{"viewMode":"hybrid","__proto__":{"polluted":true},' +
        '"pinnedSiteIdsByCategory":{"__proto__":["x"],"cat-a":["s1"]},' +
        '"customCategories":[{"id":"c1","title":"t","items":[],' +
        '"__proto__":{"polluted":true}}]}',
    )
    const res = await parseSharePayload(hostile)
    expect(res.ok).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(res.config?.pinnedSiteIdsByCategory ?? {})).not.toContain('__proto__')
    expect(res.notes.join('\n')).toContain('危险键')
    expect(res.dropped).toBeGreaterThan(0)
  })

  it('deepStripDangerousKeys：constructor / prototype 同样剥掉', () => {
    const input = JSON.parse('{"a":{"constructor":{"prototype":{"x":1}},"keep":1}}')
    const out = deepStripDangerousKeys(input)
    expect(out.stripped).toContain('a.constructor')
    expect((out.value as { a: Record<string, unknown> }).a.keep).toBe(1)
    // 自有键已剥掉：`a.constructor` 再读到的是原型链上继承的 Object，
    // 不是载荷里的那份 —— 断言必须看自有键，不能直接读属性。
    expect(Object.prototype.hasOwnProperty.call((out.value as { a: Record<string, unknown> }).a, 'constructor')).toBe(false)
    expect(Object.keys((out.value as { a: Record<string, unknown> }).a)).not.toContain('constructor')
  })

  it('未知小组件类型被丢弃并点名，本地不再留一个渲染不出来的空洞', async () => {
    const res = await parseSharePayload({
      viewMode: 'hybrid',
      heroDeckWidgets: ['quick-search', 'evil-widget', 'clock-pomodoro', 'evil-widget'],
    })
    expect(res.ok).toBe(true)
    expect(res.config?.heroDeckWidgets).toEqual(['quick-search', 'clock-pomodoro'])
    expect(res.notes.join('\n')).toContain('evil-widget')
    expect(res.notes.join('\n')).toContain('不是已知小组件')
    expect(res.warning).toContain('不是已知小组件')
  })

  it('重复小组件去重并点名', async () => {
    const res = await parseSharePayload({
      viewMode: 'hybrid',
      heroDeckWidgets: ['quick-search', 'quick-search', 'quick-search'],
    })
    expect(res.config?.heroDeckWidgets).toEqual(['quick-search'])
    expect(res.notes.join('\n')).toContain('重复出现')
  })

  it('重复分类 id 点名（内容保留，清洗器给后出现的重编号）', async () => {
    const res = await parseSharePayload({
      viewMode: 'hybrid',
      customCategories: [
        { id: 'dup', title: 'A', items: [] },
        { id: 'dup', title: 'B', items: [] },
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.config?.customCategories).toHaveLength(2)
    expect(res.config?.customCategories[0].id).toBe('dup')
    expect(res.config?.customCategories[1].id).not.toBe('dup')
    expect(res.notes.join('\n')).toContain('id「dup」重复出现')
  })

  it('重复站点 id 点名', async () => {
    const res = await parseSharePayload({
      viewMode: 'hybrid',
      customCategories: [
        {
          id: 'c1',
          title: 't',
          items: [
            { id: 's1', title: 'a', href: 'https://example.com' },
            { id: 's1', title: 'b', href: 'https://example.com' },
          ],
        },
      ],
    })
    expect(res.notes.join('\n')).toContain('站点 id「s1」重复出现')
  })

  it('超大数组：硬上限不炸，业务上限截断并记账', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `c${i}`, title: `t${i}`, items: [] }))
    const res = await parseSharePayload({ viewMode: 'hybrid', customCategories: many })
    expect(res.ok).toBe(true)
    expect(res.config?.customCategories).toHaveLength(100)
    expect(res.dropped).toBe(50)
    expect(res.notes.join('\n')).toContain('超出 100 个上限，截断 50 个')
  })

  it('循环引用直接拒收（JSON 造不出来，内存对象才有）', async () => {
    const circle: Record<string, unknown> = { viewMode: 'hybrid' }
    circle.self = circle
    const out = await sanitizeDiyLayoutInput(circle)
    expect(out.ok).toBe(false)
    expect(out.error).toContain('循环引用')
  })

  it('未知顶层字段被忽略并点名', async () => {
    const res = await parseSharePayload({ viewMode: 'hybrid', totallyUnknown: 1, anotherOne: 'x' })
    expect(res.ok).toBe(true)
    expect(res.dropped).toBe(2)
    expect(res.notes.join('\n')).toContain('未知字段「totallyUnknown」')
    expect(res.notes.join('\n')).toContain('未知字段「anotherOne」')
  })
})

/* ------------------------------------------------------------------ *
 * 已下线字段：旧分享链接里可能还带着 enableTemporalRanking /
 * enableKeyboardNav（早期的排序与键盘导航开关，现已从 schema 移除，
 * 只剩 enableAdaptiveRanking）。旧链接必须仍可读 —— 校验通过，
 * 两个字段被当成未知字段剥离并点名，不能因为「认不得」就拒收整条链接。
 * ------------------------------------------------------------------ */

describe('已下线字段 enableTemporalRanking / enableKeyboardNav：旧链接仍可读，字段被剥离', () => {
  it('legacy 旧链接：两个字段都在，校验通过且被剥离', async () => {
    const res = await parseSharePayload({
      viewMode: 'classic',
      version: 3,
      enableTemporalRanking: true,
      enableKeyboardNav: false,
    })
    expect(res.ok).toBe(true)
    expect(res.format).toBe('legacy')
    expect(res.config?.viewMode).toBe('classic')
    expect('enableTemporalRanking' in (res.config ?? {})).toBe(false)
    expect('enableKeyboardNav' in (res.config ?? {})).toBe(false)
    expect(res.carriedFields).toEqual(['viewMode'])
    expect(res.dropped).toBe(2)
    expect(res.warning).toContain('2 项内容被丢弃或截断')
    expect(res.notes.join('\n')).toContain('未知字段「enableTemporalRanking」')
    expect(res.notes.join('\n')).toContain('未知字段「enableKeyboardNav」')
  })

  it('v1 信封里的旧字段：同样通过并剥离', async () => {
    const res = await parseSharePayload({
      diy: 1,
      config: {
        viewMode: 'workbench',
        accentColor: 'amber',
        enableTemporalRanking: true,
        enableKeyboardNav: true,
      },
    })
    expect(res.ok).toBe(true)
    expect(res.format).toBe('v1')
    expect(res.config?.viewMode).toBe('workbench')
    expect(res.config?.accentColor).toBe('amber')
    expect('enableTemporalRanking' in (res.config ?? {})).toBe(false)
    expect('enableKeyboardNav' in (res.config ?? {})).toBe(false)
    expect(res.carriedFields).toEqual(['viewMode', 'accentColor'])
    expect(res.dropped).toBe(2)
    expect(res.warning).toContain('2 项内容被丢弃或截断')
    expect(res.notes.join('\n')).toContain('未知字段「enableTemporalRanking」')
    expect(res.notes.join('\n')).toContain('未知字段「enableKeyboardNav」')
  })

  it('sanitizeDiyLayoutInput：两个字段进 unknownKeys，清洗后配置里没有它们', async () => {
    const out = sanitizeDiyLayoutInput({
      viewMode: 'classic',
      version: 3,
      enableTemporalRanking: true,
      enableKeyboardNav: true,
    })
    expect(out.ok).toBe(true)
    expect(out.unknownKeys).toContain('enableTemporalRanking')
    expect(out.unknownKeys).toContain('enableKeyboardNav')
    expect('enableTemporalRanking' in (out.config ?? {})).toBe(false)
    expect('enableKeyboardNav' in (out.config ?? {})).toBe(false)
  })
})

describe('源码守卫：schema 的两张表与源头不分叉', () => {
  it('KNOWN_HERO_WIDGET_IDS 与 WIDGET_REGISTRY 的键完全一致', () => {
    const registry = readFileSync(resolve(ROOT, 'src', 'lib', 'modular', 'registry.ts'), 'utf8')
    const keys = [...registry.matchAll(/^  '([a-z0-9-]+)': \{$/gm)].map((m) => m[1])
    expect(keys).toHaveLength(KNOWN_HERO_WIDGET_IDS.length)
    expect([...keys].sort()).toEqual([...KNOWN_HERO_WIDGET_IDS].sort())
  })

  it('单条解析管线：storage 里不再有内联短字段表与内联清洗，短字段展开只有一处来源', () => {
    const storage = readFileSync(resolve(ROOT, 'src', 'lib', 'modular', 'home-diy-storage.ts'), 'utf8')
    // 内联表与内联清洗都已删除：live 解码只剩 decodeShareLinkPayload +
    // parseSharePayload 一条管线（v1 信封与旧裸配置都在那条管线里双读）。
    expect(storage).not.toMatch(/\['(vm|cdm|bg|ac|co|pco|hco|sco|wp|gb|co_op)',\s*'/)
    expect(storage).not.toContain('parsed.vm ??')
    expect(storage).not.toContain('validateAndCleanDIYConfig(normalized)')
    expect(storage).toContain('decodeShareLinkPayload(')
    expect(storage).toContain('await parseSharePayload(')
    // 短字段表本身仍在 diy-layout-schema（expandShareShortKeys 的唯一来源），
    // 11 个短字段一个不少。
    expect(Object.keys(SHARE_SHORT_KEY_MAP)).toHaveLength(11)
  })
})

describe('包体守卫：zod 不进首屏（diy-layout-schema 拆分）', () => {
  it('字段名表与 zod schema 一一对应：DIY_LAYOUT_FIELD_NAMES === LayoutSchema.shape 的键', async () => {
    expect([...DIY_LAYOUT_FIELD_NAMES].sort()).toEqual(Object.keys(LayoutSchema.shape).sort())
  })

  it('轻模块不 import zod：diy-layout-schema.ts 里没有 zod 导入语句', () => {
    const light = readFileSync(resolve(ROOT, 'src', 'lib', 'modular', 'diy-layout-schema.ts'), 'utf8')
    // 注释里可以提 zod（文件头就是拆分说明），但不能有真正拉包的 import：
    // 静态 `from 'zod'` / `from '...diy-layout-schema-zod'` 与动态 import('...') 都不行。
    expect(light).not.toMatch(/^\s*import\s+.*from\s+['"]zod['"]/m)
    expect(light).not.toMatch(/from\s+['"][^'"]*diy-layout-schema-zod['"]/)
    expect(light).not.toMatch(/import\(['"][^'"]*diy-layout-schema-zod['"]\)/)
  })

  it('首屏同步路径不静态 import zod 模块：io 与 share-link 只 dynamic import', () => {
    for (const rel of [
      ['src', 'lib', 'modular', 'home-diy-io.ts'],
      ['src', 'lib', 'diy-share-link.ts'],
    ]) {
      const src = readFileSync(resolve(ROOT, ...rel), 'utf8')
      expect(src).not.toMatch(/from\s+['"][^'"]*diy-layout-schema-zod['"]/)
      expect(src).toContain("import('@/lib/modular/diy-layout-schema-zod')")
    }
  })

  it('parse / prepare / import 是 async（调用方 await，首屏不付 zod）', () => {
    const link = readFileSync(resolve(ROOT, 'src', 'lib', 'diy-share-link.ts'), 'utf8')
    const io = readFileSync(resolve(ROOT, 'src', 'lib', 'modular', 'home-diy-io.ts'), 'utf8')
    expect(link).toContain('export async function parseSharePayload')
    expect(io).toContain('export async function prepareHomeDiyImport')
    expect(io).toContain('export async function importDIYConfig')
    // 编码不走 zod，仍是同步的 —— 分享按钮不用等 chunk
    expect(link).toContain('export function encodeVersionedShareLink')
  })
})

/* ------------------------------------------------------------------ *
 * W1：v1 信封经 live 路径解码 —— exportPresetToUrlHash 生成的
 * `{ diy: 1, config }` 链接，打开后必须经唯一的 live 入口
 * applyHomeDiyShareHash 挂起待确认（旧 bug：live 解码只读顶层字段，
 * v1 信封的 config 全被当成「缺失元数据」拒掉）；旧裸配置同路可读。
 * ------------------------------------------------------------------ */

describe('v1 信封经 live 路径解码：生成的链接能打开，旧链接照常可读', () => {
  interface FakeWindow {
    localStorage: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
      removeItem: (k: string) => void
    }
    location: { hash: string; pathname: string; search: string }
    history: { replaceState: (a: unknown, b: string, url: string) => void }
  }

  let win: FakeWindow

  beforeEach(() => {
    resetHomeDiySharedState()
    const store = new Map<string, string>()
    win = {
      localStorage: {
        getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k, v) => void store.set(k, String(v)),
        removeItem: (k) => void store.delete(k),
      },
      location: { hash: '', pathname: '/', search: '' },
      history: { replaceState: () => void (win.location.hash = '') },
    }
    ;(globalThis as unknown as { window: unknown }).window = win
  })

  afterEach(() => {
    resetHomeDiySharedState()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('encodeVersionedShareLink 生成的 v1 链接：live 路径挂起待确认，不拒收', async () => {
    const full = {
      version: 3,
      viewMode: 'workbench',
      cardDisplayMode: 'compact',
      canvasBackground: 'dots',
      accentColor: 'amber',
      categoryOrder: ['cat-a'],
      pinnedCategoryIds: ['pin-1'],
      hiddenCategoryIds: [],
      siteCategoryOverrides: { 'site-1': 'cat-a' },
      customWallpaperUrl: 'https://example.com/w.jpg',
      glassmorphismBlur: 18,
      cardOpacity: 0.9,
    } as never
    const encoded = encodeVersionedShareLink(full, BASE)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    win.location.hash = encoded.url.slice(encoded.url.indexOf('#diy='))
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toBeNull()
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending).not.toBeNull()
    expect(pending?.imported.viewMode).toBe('workbench')
    expect(pending?.imported.cardDisplayMode).toBe('compact')
    expect(pending?.imported.accentColor).toBe('amber')
    expect(pending?.imported.categoryOrder).toEqual(['cat-a'])
    expect(pending?.carriedFields).toContain('viewMode')
    expect(pending?.carriedFields).toContain('accentColor')
    // 只挂起待确认：本地配置纹丝不动，hash 已清
    expect(getHomeDiySnapshot().config.viewMode).toBe('hybrid')
    expect(win.location.hash).toBe('')
  })

  it('旧链接（短字段 + v: 3）经同一条 live 路径可读', async () => {
    win.location.hash = encodeHash({ v: 3, vm: 'classic', co: ['cat-a'] })
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toBeNull()
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending?.imported.viewMode).toBe('classic')
    expect(pending?.imported.categoryOrder).toEqual(['cat-a'])
    expect(pending?.carriedFields).toEqual(['viewMode', 'categoryOrder'])
  })

  it('旧链接（只带背景 + 强调色，不带 vm）同样可读：不因缺 viewMode 拒收', async () => {
    win.location.hash = encodeHash({ bg: 'aurora', ac: 'emerald' })
    const res = await applyHomeDiyShareHash()
    expect(res.applied).toBe(false)
    expect(res.warning).toBeNull()
    const pending = getHomeDiySnapshot().pendingShare
    expect(pending?.imported.canvasBackground).toBe('aurora')
    expect(pending?.imported.accentColor).toBe('emerald')
    expect(pending?.carriedFields).toEqual(['canvasBackground', 'accentColor'])
  })
})
