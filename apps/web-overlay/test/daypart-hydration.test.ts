/**
 * 时段提示的水合安全守卫。
 *
 * 真实缺陷：WorkspaceFilter 原来在渲染体里直接
 *     const hour = new Date().getHours()
 * 算「☀️ 早间专注 / ⚡ 敏捷高效 / 🌙 深度探索」。而首页由服务端渲染
 * （app/page.tsx 静态 import NavigationContent → WorkspaceFilter），
 * 服务端时区（CI / 容器基本都是 UTC）与用户时区不同，同一瞬间两边的小时数
 * 可能差好几个钟头：首屏 HTML 写「🌙 深度探索」，客户端首帧算出「☀️ 早间专注」，
 * React 判定水合不匹配 → 丢掉服务端 HTML 重渲染 + 控制台报错 + 提示文字闪一下。
 *
 * 这里钉两件事：
 *   1. 纯函数 describeDaypart 的边界（含与旧文案逐字一致）；
 *   2. 组件必须「挂载之后再算」：初始 state 为 null、new Date() 只出现在
 *      useEffect 里、渲染体不再直接取小时。
 *
 * 端到端那一层（服务端 HTML 里绝不能出现任何时段文案）在 e2e/daypart-hydration.spec.ts。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DAYPART_PLACEHOLDER, daypartText, describeDaypart } from '../src/lib/daypart'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const COMPONENT = resolve(ROOT, 'src', 'components', 'workspace-filter.tsx')

describe('describeDaypart：时段边界与旧文案逐字一致', () => {
  it('06:00-11:59 → 早间专注', () => {
    for (const h of [6, 7, 9, 11]) {
      expect(describeDaypart(h), `hour=${h}`).toEqual({ icon: '☀️', label: '早间专注' })
    }
  })

  it('12:00-17:59 → 敏捷高效', () => {
    for (const h of [12, 13, 17]) {
      expect(describeDaypart(h), `hour=${h}`).toEqual({ icon: '⚡', label: '敏捷高效' })
    }
  })

  it('18:00-05:59（含 0 点与 5 点）→ 深度探索', () => {
    for (const h of [18, 20, 23, 0, 3, 5]) {
      expect(describeDaypart(h), `hour=${h}`).toEqual({ icon: '🌙', label: '深度探索' })
    }
  })

  it('拼出来的文案就是改动前那三句话，一个字符都没换', () => {
    expect(daypartText(describeDaypart(9))).toBe('☀️ 早间专注')
    expect(daypartText(describeDaypart(15))).toBe('⚡ 敏捷高效')
    expect(daypartText(describeDaypart(22))).toBe('🌙 深度探索')
  })

  it('小数小时按整数部分算（getHours 不会给小数，纯属防身）', () => {
    expect(describeDaypart(11.9).label).toBe('早间专注')
    expect(describeDaypart(17.99).label).toBe('敏捷高效')
  })

  it('超出 0-23 的取值按 24 取模，不硬凑时段', () => {
    expect(describeDaypart(24).label).toBe('深度探索') // 24 → 0
    expect(describeDaypart(30).label).toBe('早间专注') // 30 → 6
    expect(describeDaypart(-1).label).toBe('深度探索') // -1 → 23
  })

  it('拿不到有效小时数时给占位提示，而不是瞎猜一个时段', () => {
    expect(describeDaypart(Number.NaN)).toEqual(DAYPART_PLACEHOLDER)
    expect(describeDaypart(Number.POSITIVE_INFINITY)).toEqual(DAYPART_PLACEHOLDER)
    // @ts-expect-error 故意传非数字（运行时可能来自被污染的配置）
    expect(describeDaypart('9')).toEqual(DAYPART_PLACEHOLDER)
  })

  it('占位提示本身不含任何时段词，首帧渲染它不会说错话', () => {
    const text = daypartText(DAYPART_PLACEHOLDER)
    for (const label of ['早间专注', '敏捷高效', '深度探索']) {
      expect(text).not.toContain(label)
    }
  })
})

/**
 * 按行剥掉注释，再数代码里的出现次数。
 * 组件里解释了「原来在渲染体里直接取 new Date().getHours()」，注释里必然出现
 * 同一个写法；不剥注释的话守卫会被自己的说明文字绊倒（注释替代码通过也一样危险）。
 */
function stripComments(source: string): string {
  let inBlock = false
  return source
    .split(/\r?\n/)
    .map((rawLine) => {
      let line = rawLine
      let out = ''
      for (;;) {
        if (inBlock) {
          const close = line.indexOf('*/')
          if (close === -1) return out
          inBlock = false
          line = line.slice(close + 2)
          continue
        }
        const lineComment = line.indexOf('//')
        const blockOpen = line.indexOf('/*')
        if (lineComment !== -1 && (blockOpen === -1 || lineComment < blockOpen)) {
          return out + line.slice(0, lineComment)
        }
        if (blockOpen !== -1) {
          out += line.slice(0, blockOpen)
          line = line.slice(blockOpen + 2)
          inBlock = true
          continue
        }
        return out + line
      }
    })
    .join('\n')
}

describe('组件守卫：时段提示必须挂载之后再算', () => {
  const src = readFileSync(COMPONENT, 'utf8')
  const code = stripComments(src)

  it('初始 state 是 null（服务端与客户端首帧必须渲染同一份占位）', () => {
    expect(code).toContain('useState<DaypartHint | null>(null)')
    expect(code).toContain('daypartText(timeHint ?? DAYPART_PLACEHOLDER)')
  })

  it('new Date() 只能出现在 useEffect 里，且代码里只有一处', () => {
    const stamps = code.match(/new Date\(/g) ?? []
    expect(stamps.length).toBe(1)
    expect(code.indexOf('useEffect(')).toBeGreaterThan(-1)
    expect(code.indexOf('useEffect(')).toBeLessThan(code.indexOf('new Date('))
    expect(code).toContain('setTimeHint(describeDaypart(new Date().getHours()))')
  })

  it('渲染体里不再直接取当前小时（这就是原来的 bug）', () => {
    expect(code).not.toContain('const hour = new Date')
    expect(code).not.toMatch(/\{describeDaypart\(/) // 渲染时不许直接调用
    expect((code.match(/describeDaypart\(/g) ?? []).length).toBe(1)
  })

  it('剥注释这一步本身是有效的（否则上面三条只是空跑）', () => {
    expect(stripComments('// new Date()\nconst a = 1')).not.toContain('new Date(')
    expect(stripComments('/* new Date() */ const b = 2')).not.toContain('new Date(')
    expect(stripComments('const c = new Date()')).toContain('new Date(')
  })
})

/**
 * signin 页脚年份的水合差异（与时段提示同类，但更轻）。
 *
 * `signin/page.tsx` 是**客户端组件**（首行 'use client'）：`new Date().getFullYear()`
 * 会在 SSR 与 hydrate 各算一次，跨年边界（或时区差）得到不同文本 → React 报水合
 * 文本不一致。年份是装饰性内容，用 `suppressHydrationWarning` 单点抑制最省事
 * （改成挂载后再算会让首帧空一下，反而更差）。
 *
 * 断言「抑制只加在这一处」：给整页开豁免会把真实的水合问题一起盖掉。
 */
describe('signin 年份：跨年边界的水合差异被单点抑制', () => {
  const src = readFileSync(resolve(ROOT, 'src', 'app', 'auth', 'signin', 'page.tsx'), 'utf8')
  const code = stripComments(src)

  it('前提成立：它是客户端组件（不抑制才会水合不一致）', () => {
    expect(src.startsWith("'use client'")).toBe(true)
  })

  it('年份 span 带 suppressHydrationWarning', () => {
    expect(code).toMatch(
      /<span suppressHydrationWarning>&copy; \{new Date\(\)\.getFullYear\(\)\}/,
    )
  })

  it('抑制只有一处（不许顺手给整页开豁免）', () => {
    expect((code.match(/suppressHydrationWarning/g) ?? []).length).toBe(1)
  })
})
