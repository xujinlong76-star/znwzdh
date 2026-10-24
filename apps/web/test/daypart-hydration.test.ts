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
 *   2. 组件必须「只有客户端才算得到小时」：时钟读取收在 useClientHour 里，
 *      服务端快照恒为 null，组件不再自己 new Date()，也不再往 effect 里塞 setState。
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

describe('组件接线：时段提示只在挂载后计算（渲染行为由 E2E 断言）', () => {
  const code = stripComments(readFileSync(COMPONENT, 'utf8'))
  const daypartCode = stripComments(readFileSync(resolve(ROOT, 'src', 'lib', 'daypart.ts'), 'utf8'))

  // P1-1 分层：`e2e/daypart-hydration.spec.ts` 已经断言了首屏 HTML 只有占位、
  // 挂载后换成客户端时段、且控制台没有水合报错。这里不再数「new Date() 出现几次」
  // 这类实现形状（重构拆文件就会误红），只保留「客户端才算、服务端拿不到」的语义。
  it('小时数一律经 useClientHour 取，组件不自己碰时钟', () => {
    expect(code).toContain('useClientHour()')
    expect(code).not.toContain('new Date')
  })

  it('拿不到小时数时渲染占位提示，而不是瞎猜一个时段', () => {
    expect(code).toContain('daypartText(daypart?.hint ?? DAYPART_PLACEHOLDER)')
  })

  it('useClientHour 的服务端快照恒为 null（水合两边首帧一致）', () => {
    expect(daypartCode).toMatch(/useSyncExternalStore\(\s*noopSubscribe,\s*\(\)\s*=>\s*new Date\(\)\.getHours\(\),\s*\(\)\s*=>\s*null\s*\)/)
  })

  it('时段文案不许在渲染体里按小时直接算（只能经 useClientHour 的客户端值）', () => {
    expect(code).not.toMatch(/\{describeDaypart\(/)
    expect(daypartCode).not.toMatch(/^const .*describeDaypart\(/m)
  })

  it('关掉推荐开关时这一行必须改口径，不能继续报按时间算出来的提示', () => {
    expect(code).toMatch(/hour === null \|\| !daypartSceneEnabled[\s\S]*?return null/)
    expect(code).toContain('时段场景推荐已关闭')
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
