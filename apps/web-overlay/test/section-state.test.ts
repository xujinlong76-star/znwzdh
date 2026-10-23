import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 第 4 批：统一区块状态的守卫。
 *
 * 守住三件事：
 *   1. loading / error / empty 三态的 a11y 语义（aria-busy、role=alert、重试）；
 *   2. history / data / account / plugins 四个页面确实接入统一组件；
 *   3. 页面不再各自维护 amber 错误框（避免下次又分叉出第四种写法）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const PAGE_FILES = [
  'src/app/me/history/page.tsx',
  'src/app/me/data/page.tsx',
  'src/app/me/account/account-view.tsx',
  'src/app/me/plugins/me-plugins-view.tsx',
]

describe('SectionState 统一状态组件', () => {
  it('组件存在，并带 loading / error / empty 三态语义', () => {
    const rel = 'src/components/user-center/section-state.tsx'
    expect(existsSync(join(ROOT, rel))).toBe(true)
    const src = read(rel)
    expect(src).toContain('aria-busy="true"')
    expect(src).toContain('aria-live="polite"')
    expect(src).toContain('role="alert"')
    expect(src).toContain("retryLabel = '重试'")
    expect(src).toContain("variant === 'loading'")
    expect(src).toContain("variant === 'error'")
  })

  it('四个用户中心页面都接入统一组件', () => {
    for (const rel of PAGE_FILES) {
      const src = read(rel)
      expect(src, `${rel} 必须引入 SectionState`).toContain("from '@/components/user-center/section-state'")
      expect(src, `${rel} 必须使用 error 态`).toContain('variant="error"')
    }
  })

  it('页面不再各自实现 amber 错误框', () => {
    for (const rel of PAGE_FILES) {
      const src = read(rel)
      // 页面可以有局部的 action 错误提示（如导出失败），但区块级错误必须走 SectionState
      expect(src, `${rel} 不应再出现 amber 区块错误框`).not.toContain('border-amber-500/30')
    }
  })
})
