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
import { describe, expect, it } from 'vitest'
import {
  SHARE_LINK_MAX_BYTES,
  describeShareLinkFailure,
  encodeShareLink,
} from '../src/lib/diy-share-link'

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
    // @ts-expect-error 同上
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

  it('handleShareUrlHash 拿的是带原因的结果，失败分支里有 toast', () => {
    const body = dialog.slice(dialog.indexOf('const handleShareUrlHash'))
    expect(body.includes('const out = exportPresetToUrlHash()')).toBe(true)
    expect(failureIsAnnounced(body)).toBe(true)
  })

  it('解构里不再有那个没人调用的 importPresetFromUrlHash', () => {
    expect(/^\s*importPresetFromUrlHash,?\s*$/m.test(toolbar)).toBe(false)
  })

  it('钩子里只剩一条免登导入实现（applyHomeDiyShareHash），重复实现已删除', () => {
    expect(/const importPresetFromUrlHash\s*=/.test(hook)).toBe(false)
    expect(/^\s*importPresetFromUrlHash,?\s*$/m.test(hook)).toBe(false)
    expect(/if \(applyHomeDiyShareHash\(\)\) return/.test(hook)).toBe(true)
  })

  it('导出类型是「带原因的结果」，不再是可能为空的字符串', () => {
    expect(hook.includes('useCallback((): ShareLinkOutcome =>')).toBe(true)
    expect(hook.includes('encodeShareLink(')).toBe(true)
  })
})
