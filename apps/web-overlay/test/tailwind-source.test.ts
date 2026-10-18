/**
 * Tailwind v4 源扫描守卫：globals.css 必须保留两条显式 @source（整棵 src 树 + registry 子树）。
 *
 * 为什么需要这两条守卫（都是实测，不是推测）：
 *   apps/web 里的 src 目录是 vendored 上游底座，根 .gitignore 用 apps/web/src 通配
 *   + 白名单（只放行覆盖层自己那批 lib / components 文件）把它排除在版本管理之外。
 *   而 Tailwind v4 的自动源检测同样遵守 .gitignore：
 *     - 没有「整棵树级」声明时，apply 到 apps/web 的那批文件根本不在扫描范围内
 *       （实测：apply 后的 globals.css 缺这条声明时，DialogContent 的定位类全都没生成，
 *        弹窗被钉在文档末尾 rect.y = 9116，Playwright 报 element is outside of the viewport）；
 *     - 只有「整棵树级」声明也不够：@source 通配同样不碰被忽略的路径，
 *       registry 子目录依旧漏扫（实测 next build 产物里 ring-offset-background、
 *       sm:rounded-lg 缺失，补上 registry 声明后才有）。
 *
 *   实测一次真实后果（本地生成目录过期、apply 后的 globals.css 里没有这条声明时）：
 *     - DialogContent 的 fixed / left-[50%] / top-[50%] / translate-x-[-50%] /
 *       translate-y-[-50%] 一个都没生成；
 *     - 弹窗按 static 位置被钉在文档末尾：1280×720 视口、页面高 9116px 时，
 *       弹窗 rect.y = 9116、translate = none，整块在视口外；
 *     - Playwright 点「确认创建」直接报 "element is outside of the viewport"，
 *       用户同样点不到 —— 快捷键说明、DIY 备份/导入、新建专属分类全废；
 *     - 补上声明并重新生成后：rect = (416, 233)、translate = -50% -50%，弹窗可用。
 *
 * 这里钉的是「声明还在、且是整棵树级别的」；「类真的生成了、弹窗真的在视口里」
 * 属于 CSS 产物，字符串守则证明不了，由 e2e/dialog-in-viewport.spec.ts 与 next build 兜底。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** overlay 与 apps/web 两份布局下都指向 globals.css */
const GLOBALS_CSS = resolve(HERE, '..', 'src', 'styles', 'globals.css')

/**
 * 把 CSS 注释挖成空格（保留换行），但**不动字符串里的内容**。
 *
 * 必须逐字符走：天真的非贪婪正则（匹配 斜杠+星号 到 星号+斜杠 的最短片段）
 * 会把 glob 里的星号斜杠序列当成注释吃掉 —— 实测一条递归通配声明
 * 会被腰斩成非递归的残句，守卫于是永远为 false（下一组用例就是钉这件事）。
 */
export function maskCssComments(css: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < css.length) {
    const ch = css[i]
    const next = css[i + 1]

    if (quote) {
      if (ch === '\\') {
        out += ch + (next ?? '')
        i += 2
        continue
      }
      if (ch === quote) quote = null
      out += ch
      i++
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i++
      continue
    }

    if (ch === '/' && next === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      out += css.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }

    if (ch === '/' && next === '/') {
      const end = css.indexOf('\n', i)
      const stop = end === -1 ? css.length : end
      out += css.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }

    out += ch
    i++
  }
  return out
}

/**
 * 是否声明了「整棵 src 树」级别的扫描源。
 *
 * 必须是从 styles/ 往上一级、递归覆盖整个 src 的通配声明；
 * 只放行某个子目录（components 或 registry 各写一条）都不算 ——
 * 那样 registry 依旧漏扫，弹窗继续被钉在文档底部。
 */
export function declaresTreeWideSource(css: string): boolean {
  return sourceValues(css).some((v) => /^\.\.\/\*\*\/.+$/.test(v))
}

/** 抽出所有 @source 的声明值（已屏蔽注释） */
export function sourceValues(css: string): string[] {
  const re = /@source\s+(['"])([^'"]+)\1/g
  const out: string[] = []
  const code = maskCssComments(css)
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) out.push(m[2])
  return out
}

/**
 * 是否单独声明了 registry 子树。
 *
 * 为什么不能只靠整棵树级的声明：v4 的 @source 通配不会去碰被 .gitignore
 * 忽略掉的路径，registry 就是被 apps/web/src 通配忽略的那个子目录。
 * 实测少了这条声明时，next build 产出的 CSS 里 ring-offset-background、
 * sm:rounded-lg 这些 registry 独占类都没有产物（焦点环外圈没底色、小屏圆角丢失）。
 */
export function declaresRegistrySource(css: string): boolean {
  return sourceValues(css).some((v) => v.includes('/registry/'))
}

describe('扫描器本身是对的（否则守卫只是空跑）', () => {
  it('抓得住：覆盖整棵 src 树的声明', () => {
    expect(declaresTreeWideSource("@import 'tailwindcss';\n@source '../**/*.{js,ts,jsx,tsx,mdx}';\n")).toBe(true)
    expect(declaresTreeWideSource('@source "../**/*.tsx";')).toBe(true)
  })

  it('不把 glob 当成注释（这里真栽过一次）', () => {
    const line = "@source '../**/*.{js,ts,jsx,tsx,mdx}';"
    expect(maskCssComments(line)).toBe(line)
    expect(maskCssComments("@source '../**/*.tsx';")).toBe("@source '../**/*.tsx';")
  })

  it('不误报：注释里写 @source 不算声明', () => {
    const css = "/* 曾经用过 @source '../**/*.tsx' */\n@import 'tailwindcss';\n"
    expect(maskCssComments(css).includes('@source')).toBe(false)
    expect(declaresTreeWideSource(css)).toBe(false)
    expect(declaresTreeWideSource("// @source '../**/*.tsx'\n")).toBe(false)
  })

  it('不误报：只放行某个子目录不算整棵树', () => {
    expect(declaresTreeWideSource("@source '../components/**/*.{ts,tsx}';\n")).toBe(false)
    expect(declaresTreeWideSource("@source '../registry/**/*.{ts,tsx}';\n")).toBe(false)
    expect(declaresTreeWideSource("@source './**/*.{ts,tsx}';\n")).toBe(false)
  })

  it('registry 检查器：认 registry 声明，不被整棵树声明糊弄', () => {
    expect(declaresRegistrySource("@source '../registry/**/*.{ts,tsx}';\n")).toBe(true)
    expect(declaresRegistrySource("@source '../**/*.{ts,tsx}';\n")).toBe(false)
    expect(declaresRegistrySource("/* @source '../registry/**/*.tsx' */\n")).toBe(false)
    expect(sourceValues("@source '../**/*.tsx';\n@source '../registry/**/*.tsx';\n")).toEqual([
      '../**/*.tsx',
      '../registry/**/*.tsx',
    ])
  })
})

describe('globals.css 必须保留两条 @source（整棵树 + registry 子树）', () => {
  it('有整棵树级别的 @source 声明', () => {
    const css = readFileSync(GLOBALS_CSS, 'utf8')
    expect(declaresTreeWideSource(css)).toBe(true)
  })

  it('有 registry 子树的 @source 声明', () => {
    const css = readFileSync(GLOBALS_CSS, 'utf8')
    expect(declaresRegistrySource(css)).toBe(true)
  })

  it('这条声明不是多余的：registry 里确实有需要扫描的组件', () => {
    // 覆盖层目录里没有 vendored 副本（没跑 apply-overlay）时跳过结构性断言
    const appSrc = [resolve(HERE, '..', 'src'), resolve(HERE, '..', '..', 'web', 'src')].find((p) =>
      existsSync(join(p, 'registry')),
    )
    if (!appSrc) return
    const ui = join(appSrc, 'registry', 'new-york', 'ui')
    const files = existsSync(ui) ? readdirSync(ui).filter((f) => f.endsWith('.tsx')) : []
    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('dialog.tsx')
  })
})
