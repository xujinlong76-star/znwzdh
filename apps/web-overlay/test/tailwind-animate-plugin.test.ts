/**
 * tailwindcss-animate 插件守卫：globals.css 必须真的把插件装上。
 *
 * 为什么（实测，不是推测）：
 *   这个仓库有两套 Tailwind 配置线索，但 v4 一条都不看：
 *     - 覆盖层（apps/web-overlay）自己没有 tailwind.config.js；
 *     - apps/web/tailwind.config.js 里确实有一句 require('tailwindcss-animate')，
 *       可 v4 只有在 CSS 里写 @config 才会去读那个文件 —— 本项目从头到尾没写过。
 *   于是插件从未加载，源码里 11 处 animate-in / zoom-in-95 / slide-in-from-* /
 *   fade-in-0 全部没有产物：搜索面板、Dialog、离线提示条、批量操作坞都是「啪」地
 *   出现，没有入场动画，退出动画更是完全没有。
 *
 *   实测对照（next build 产物 CSS，检索方式本身用同一次产物里的
 *   ring-offset-background 自证有效）：
 *     - 加 @plugin 之前：animate-in 0 处、zoom-in-95 0 处；
 *     - 加上之后：animate-in 4 处、zoom-in-95 2 处、slide-in-from-top 4 处。
 *
 * 这里钉的是「声明还在、且没被注释掉、且依赖里确实有这个包」；
 * 「类真的进了 CSS 产物」属于构建产物，字符串守卫证明不了，由 next build 兜底
 * （上面那组实测数字就是构建时抓的）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向本包的根目录 */
const PKG_ROOT = resolve(HERE, '..')
const GLOBALS_CSS = resolve(PKG_ROOT, 'src', 'styles', 'globals.css')

/**
 * 把 CSS 注释挖成空格（保留换行），字符串里的内容原样留着。
 * 必须逐字符走：正则版会把 glob 里的 星号-斜杠 序列当成注释吃掉。
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

/** 抽出所有 @plugin 的声明值（已屏蔽注释） */
export function pluginNames(css: string): string[] {
  const re = /@plugin\s+(['"])([^'"]+)\1/g
  const out: string[] = []
  const code = maskCssComments(css)
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) out.push(m[2])
  return out
}

/** 是否装了指定插件（注释里写的、@import 进来的都不算） */
export function declaresPlugin(css: string, name: string): boolean {
  return pluginNames(css).includes(name)
}

/** 递归收集 src 下的源码文件 */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(tsx?|jsx?|mdx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('检索器本身是对的（否则守卫只是空跑）', () => {
  it('两种引号都认', () => {
    expect(declaresPlugin('@plugin "tailwindcss-animate";', 'tailwindcss-animate')).toBe(true)
    expect(declaresPlugin("@plugin 'tailwindcss-animate';", 'tailwindcss-animate')).toBe(true)
    expect(pluginNames('@plugin "a";\n@plugin "b";\n')).toEqual(['a', 'b'])
  })

  it('注释掉的声明不算数', () => {
    expect(
      declaresPlugin('/* 曾经写过 @plugin "tailwindcss-animate"; */\n', 'tailwindcss-animate'),
    ).toBe(false)
  })

  it('@import 进来的包不算「装上了插件」', () => {
    expect(declaresPlugin("@import 'tailwindcss-animate';\n", 'tailwindcss-animate')).toBe(false)
  })

  it('别的插件不能顶替', () => {
    expect(declaresPlugin('@plugin "tailwindcss-animate";', 'tw-animate-css')).toBe(false)
  })
})

describe('globals.css 必须真的装上 tailwindcss-animate', () => {
  it('声明了 @plugin "tailwindcss-animate"', () => {
    const css = readFileSync(GLOBALS_CSS, 'utf8')
    expect(declaresPlugin(css, 'tailwindcss-animate')).toBe(true)
  })

  it('依赖里确实有这个包，@plugin 才不会在构建时解析失败', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(all)).toContain('tailwindcss-animate')
  })

  it('这行声明不是多余的：源码里确实在用插件产出的类', () => {
    // 覆盖层目录里没有 vendored 副本（没跑 apply-overlay）时跳过结构性断言
    const src = resolve(PKG_ROOT, 'src')
    const files = sourceFiles(src)
    if (files.length === 0) return
    const used = files.filter((f) => /animate-in|animate-out/.test(readFileSync(f, 'utf8')))
    expect(used.length).toBeGreaterThan(0)
    // 而且不止一处：真出现「插件没装」时是一片没有动画，不是个别组件
    expect(used.length).toBeGreaterThanOrEqual(5)
  })
})
