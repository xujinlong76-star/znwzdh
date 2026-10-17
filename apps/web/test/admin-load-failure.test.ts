/**
 * 后台列表「加载失败」不能再显示成「暂无数据」。
 *
 * 真实缺陷（admin/collections · categories · tags 三页）：
 *
 *     void hubGet<Row[]>('/api/collections?all=1')
 *       .then((data) => setCols(Array.isArray(data) ? data : []))
 *       .catch(() => setCols([]))          // ← 401 / 500 / 断网 一律 = 空列表
 *
 * 失败与「本来就没有数据」合并成同一个状态，页面渲染的是
 * 「暂无专题 / 暂无类目 / 暂无匹配标签」—— 管理员看到的是「我的数据没了」。
 *
 * 这里钉住修复后的契约：
 *   1. 按原因分类的说明文案，且**每一条都必须**说清「空列表 ≠ 数据被删了」；
 *   2. 失败时的空态文案必须换掉「暂无数据」；
 *   3. 三个页面都不许再 `.catch(() => setX([]))` 静默降级，必须留错误态 + 可重试；
 *   4. 提示组件必须带 role="alert"。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOAD_FAILURE_EMPTY_HINT,
  classifyLoadFailure,
  describeLoadFailure,
  emptyStateText,
} from '@/lib/admin-load-failure'

/* ------------------------------------------------------------------ *
 * 1. 失败原因分类 → 决定「下一步该做什么」
 * ------------------------------------------------------------------ */

describe('classifyLoadFailure：按原因分类', () => {
  it('401 / 403（含 status 属性与消息文本）都算登录问题', () => {
    expect(classifyLoadFailure(Object.assign(new Error('x'), { status: 401 }))).toBe('auth')
    expect(classifyLoadFailure(Object.assign(new Error('x'), { status: 403 }))).toBe('auth')
    expect(classifyLoadFailure(new Error('HTTP 401 Unauthorized'))).toBe('auth')
    expect(classifyLoadFailure(new Error('Forbidden'))).toBe('auth')
    expect(classifyLoadFailure(new Error('未授权：token 已过期'))).toBe('auth')
  })

  it('网络问题：Failed to fetch / timeout / 断网', () => {
    expect(classifyLoadFailure(new Error('TypeError: Failed to fetch'))).toBe('network')
    expect(classifyLoadFailure(new Error('NetworkError when attempting to fetch resource.'))).toBe(
      'network',
    )
    expect(classifyLoadFailure(new Error('request timed out'))).toBe('network')
    expect(classifyLoadFailure(new Error('ECONNREFUSED 127.0.0.1:3000'))).toBe('network')
    expect(classifyLoadFailure(new Error('看起来断网了'))).toBe('network')
  })

  it('5xx 算服务端问题（status 属性优先于文本）', () => {
    expect(classifyLoadFailure(Object.assign(new Error('x'), { status: 500 }))).toBe('server')
    expect(classifyLoadFailure(Object.assign(new Error('x'), { status: 502 }))).toBe('server')
    expect(classifyLoadFailure(new Error('Internal Server Error'))).toBe('server')
    expect(classifyLoadFailure(new Error('upstream returned 503'))).toBe('server')
  })

  it('认不出来也不猜：unknown（文案仍要给出可执行的下一步）', () => {
    expect(classifyLoadFailure(new Error('something odd'))).toBe('unknown')
    expect(classifyLoadFailure(undefined)).toBe('unknown')
    expect(classifyLoadFailure({})).toBe('unknown')
  })

  it('异常输入不会在报错路径上再抛一次', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => classifyLoadFailure(circular)).not.toThrow()
    expect(classifyLoadFailure(circular)).toBe('unknown')
    expect(() => describeLoadFailure(circular, '专题列表')).not.toThrow()
    expect(describeLoadFailure(circular, '专题列表')).toContain('专题列表没有加载出来')
  })
})

/* ------------------------------------------------------------------ *
 * 2. 文案：必须写清「空列表 ≠ 数据被删了」
 * ------------------------------------------------------------------ */

describe('describeLoadFailure：说明白发生了什么、空列表意味着什么', () => {
  it('每种原因都包含原始报错信息与「不代表数据被删了」', () => {
    const cases: [unknown, string][] = [
      [Object.assign(new Error('HTTP 401'), { status: 401 }), '登录状态可能已过期'],
      [new Error('Failed to fetch'), '网络或服务不可达'],
      [Object.assign(new Error('boom'), { status: 500 }), '服务端出错了'],
      [new Error('weird'), '点「重试」可以再拉一次'],
    ]
    for (const [err, expected] of cases) {
      const note = describeLoadFailure(err, '专题列表')
      expect(note).toContain('专题列表没有加载出来')
      expect(note).toContain(expected)
      expect(note).toContain(LOAD_FAILURE_EMPTY_HINT)
      expect(LOAD_FAILURE_EMPTY_HINT).toBe('这里显示的是空列表，不代表数据被删了。')
    }
  })

  it('把原始报错带进括号里（便于排查，而不是只说「失败了」）', () => {
    expect(describeLoadFailure(new Error('HTTP 502 Bad Gateway'), '标签列表')).toContain(
      '（HTTP 502 Bad Gateway）',
    )
  })

  it('没有报错信息时不留空括号', () => {
    const note = describeLoadFailure(undefined, '类目列表')
    expect(note).toContain('类目列表没有加载出来。')
    expect(note).not.toContain('（）')
  })

  it('字符串 / 对象形态的错误也能说明白', () => {
    expect(describeLoadFailure('Failed to fetch', '标签列表')).toContain('网络或服务不可达')
    expect(describeLoadFailure({ status: 403, message: 'nope' }, '标签列表')).toContain(
      '登录状态可能已过期',
    )
  })
})

describe('emptyStateText：失败过就不能再说「暂无数据」', () => {
  it('有失败原因 → 换成「没能加载出来（见上方提示）」', () => {
    expect(emptyStateText('专题列表没有加载出来。', '暂无专题')).toBe('没能加载出来（见上方提示）')
  })

  it('没有失败 → 保留原本的空态文案（新用户不该看到错误）', () => {
    expect(emptyStateText(null, '暂无专题')).toBe('暂无专题')
    expect(emptyStateText(null, '暂无类目')).toBe('暂无类目')
    expect(emptyStateText(null, '暂无匹配标签')).toBe('暂无匹配标签')
  })
})

/* ------------------------------------------------------------------ *
 * 3. 接线守则（字符串守则抓不到语法错，语法由 tsc / build 兜底）
 * ------------------------------------------------------------------ */

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
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const ADMIN_PAGES = [
  { rel: 'src/app/admin/collections/page.tsx', what: '专题列表' },
  { rel: 'src/app/admin/categories/page.tsx', what: '类目列表' },
  { rel: 'src/app/admin/tags/page.tsx', what: '标签列表' },
] as const

describe('接线守则：加载失败必须有错误态、能重试、能看出来', () => {
  it('三个页面都不许再把失败静默降级成空列表', () => {
    const offenders: string[] = []
    for (const { rel } of ADMIN_PAGES) {
      const src = readSrc(rel)
      if (/\.catch\(\(\) => set/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('三个页面都要：错误态 + 分类文案 + 重试 + 失败时换掉空态文案', () => {
    for (const { rel, what } of ADMIN_PAGES) {
      const src = readSrc(rel)
      expect(src, rel).toContain("useState<string | null>(null)")
      expect(src, rel).toContain('setLoadError(null)')
      expect(src, rel).toContain(`describeLoadFailure(err, '${what}')`)
      expect(src, rel).toContain('<LoadErrorNotice')
      expect(src, rel).toContain('onRetry={() => load()}')
      expect(src, rel).toContain('emptyStateText(loadError,')
      expect(src, rel).toContain("from '@/lib/admin-load-failure'")
      expect(src, rel).toContain("from '@/components/admin/load-error-notice'")
    }
  })

  it('提示只在失败时出现：`loadError &&` 守卫，成功时依然是「暂无…」', () => {
    for (const { rel } of ADMIN_PAGES) {
      const src = readSrc(rel)
      expect(src, rel).toContain('{loadError && <LoadErrorNotice')
    }
  })

  it('专题条目（详情）失败也要说：collections 的 loadDetail 不能静默清空', () => {
    const src = readSrc('src/app/admin/collections/page.tsx')
    expect(src).toContain("describeLoadFailure(err, '专题条目')")
    expect(src).toContain('detailError &&')
    expect(src).toContain('emptyStateText(detailError,')
  })

  it('提示组件本身：role=alert + 可重试', () => {
    const notice = readSrc('src/components/admin/load-error-notice.tsx')
    expect(notice).toContain('role="alert"')
    expect(notice).toContain('onRetry')
    expect(notice).toContain('重试')
  })

  it('非空列表不显示提示（不能因为曾经失败过就永远挂着）', () => {
    for (const { rel } of ADMIN_PAGES) {
      const src = readSrc(rel)
      // 失败一次后重试成功：load() 会先把 loadError 清成 null
      expect(src, rel).toContain('setLoadError(null)')
    }
  })
})
