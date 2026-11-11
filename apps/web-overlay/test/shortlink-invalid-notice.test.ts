/**
 * 短链失效提示（B14 余项）：
 * `/s/<code>` 打不开时处理器 302 到 `/marketplace?shortlink=invalid`，
 * 但市场页从不读这个参数——用户被悄悄扔到通用页、没有任何解释。
 * 本文件钉住两端的口径：判定纯函数 + 文案 + 页面接线守卫。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isShortlinkInvalidNotice,
  SHORTLINK_INVALID_NOTICE,
  SHORTLINK_INVALID_QUERY_KEY,
  SHORTLINK_INVALID_QUERY_VALUE,
} from '@/lib/shortlink-notice'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录')
  return hit
}

const ROOT = overlayRoot()

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, ...rel.split('/')), 'utf8')
}

describe('isShortlinkInvalidNotice：只有处理器实际发出的值才亮提示', () => {
  it('shortlink=invalid 亮提示', () => {
    expect(isShortlinkInvalidNotice({ shortlink: 'invalid' })).toBe(true)
  })

  it('缺参数不亮', () => {
    expect(isShortlinkInvalidNotice({})).toBe(false)
  })

  it('别的取值不亮——拼 ?shortlink=xxx 造不出假提示', () => {
    expect(isShortlinkInvalidNotice({ shortlink: 'foo' })).toBe(false)
    expect(isShortlinkInvalidNotice({ shortlink: '' })).toBe(false)
    expect(isShortlinkInvalidNotice({ shortlink: ['invalid'] })).toBe(false)
  })

  it('键名与值和 /s 处理器同一套口径', () => {
    expect(SHORTLINK_INVALID_QUERY_KEY).toBe('shortlink')
    expect(SHORTLINK_INVALID_QUERY_VALUE).toBe('invalid')
    const route = readSrc('src/app/s/[code]/route.ts')
    expect(route).toContain('/marketplace?shortlink=invalid')
  })
})

describe('文案：只说能确定的事，不编原因、不承诺重试', () => {
  it('标题与正文齐全', () => {
    expect(SHORTLINK_INVALID_NOTICE.title.length).toBeGreaterThan(0)
    expect(SHORTLINK_INVALID_NOTICE.body.length).toBeGreaterThan(0)
  })

  it('不说「插件被删了」——处理器在码非法/查无此码/中枢异常时都返回同一个 invalid', () => {
    expect(SHORTLINK_INVALID_NOTICE.body).not.toContain('被删')
    expect(SHORTLINK_INVALID_NOTICE.body).not.toContain('已删除')
  })

  it('不承诺「再试一次就能打开」', () => {
    expect(SHORTLINK_INVALID_NOTICE.body).not.toContain('再试')
    expect(SHORTLINK_INVALID_NOTICE.body).not.toContain('重试')
  })

  it('给出真出路：市场搜索框或浏览全部插件', () => {
    expect(SHORTLINK_INVALID_NOTICE.body).toContain('搜')
    expect(SHORTLINK_INVALID_NOTICE.body).toContain('全部插件')
  })
})

describe('页面接线守卫：市场页真的渲染提示', () => {
  it('市场页引用判定函数并渲染提示（带 testid 与 role=alert）', () => {
    const page = readSrc('src/app/marketplace/page.tsx')
    expect(page).toContain('isShortlinkInvalidNotice')
    expect(page).toContain('data-testid="shortlink-invalid-notice"')
    expect(page).toContain('role="alert"')
    expect(page).toContain('SHORTLINK_INVALID_NOTICE')
  })

  it('失效视图不进索引：generateMetadata 把 shortlink=invalid 算进 noindex 的 filtered', () => {
    const page = readSrc('src/app/marketplace/page.tsx')
    expect(page).toContain('shortlinkInvalid')
    expect(page).toMatch(/filtered\s*=\s*[\s\S]*shortlinkInvalid/)
  })
})
