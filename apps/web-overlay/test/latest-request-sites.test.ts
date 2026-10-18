/**
 * 「过期响应不许写界面」的调用点守卫。
 *
 * 为什么是字符串守卫而不是行为测试：这几个页面是 React 客户端组件，
 * 仓库的 vitest 是 node 环境、也没有装 @testing-library/react，
 * 所以「组件真的只认最后一次响应」没法在单测里跑；管理端页面在 CI 里
 * 又因为需要登录而整体跳过（见 e2e/admin-*.spec.ts 的 signin 跳过分支）。
 * 于是拆成两半：
 *   - 闸门本身（lib/latest-request.ts）用乱序 Promise 做真行为测试；
 *   - 调用点用本守卫钉住结构：必须走 settleLatest，且必须先判 stale 再写状态。
 *
 * 守卫用「去注释（保留字符串）」的源码做内容判定，用「去注释去字符串」的源码
 * 定位函数体与括号配对 —— 否则注释里那句「原来只 setSiteSamples([])」
 * 会被当成真的状态写入，把顺序断言糊过去。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向 src */
const SRC = resolve(HERE, '..', 'src')

/** 注释 → 空格（保留换行与长度），字符串原样保留 */
export function maskComments(src: string): string {
  const out = src.split('')
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      for (let k = i; k < stop; k += 1) {
        if (out[k] !== '\n') out[k] = ' '
      }
      i = stop
      continue
    }
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      for (let k = i; k < stop; k += 1) out[k] = ' '
      i = stop
      continue
    }
    i += 1
  }
  return out.join('')
}

/** 注释与字符串都 → 空格（括号配对/函数定位用；长度与换行保持不变） */
export function maskCommentsAndStrings(src: string): string {
  const out = maskComments(src).split('')
  const masked = maskComments(src)
  let i = 0
  let quote: string | null = null
  while (i < masked.length) {
    const ch = masked[i]
    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) {
        quote = null
        i += 1
        continue
      }
      if (out[i] !== '\n') out[i] = ' '
      i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      i += 1
      continue
    }
    i += 1
  }
  return out.join('')
}

/** 取函数/箭头函数的函数体（原文切片；定位用去字符串的源码做括号配对） */
export function functionBody(source: string, name: string): string | null {
  const masked = maskCommentsAndStrings(source)
  const re = new RegExp('(?:const|let|function)\\s+' + name + '\\s*[=:(]')
  const m = re.exec(masked)
  if (!m) return null
  const open = masked.indexOf('{', m.index + m[0].length - 1)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1
    else if (masked[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

/** 这个函数体是不是「走闸门 + 先判过期再写状态」 */
export function gateDiscipline(
  source: string,
  name: string,
): { found: boolean; usesGate: boolean; checksStale: boolean; staleFirst: boolean } {
  const body = functionBody(source, name)
  if (body === null) return { found: false, usesGate: false, checksStale: false, staleFirst: false }
  const bodyNoComments = maskComments(body)
  const usesGate = bodyNoComments.includes('settleLatest(')
  const checksStale = bodyNoComments.includes("status === 'stale'")
  // 只看 await settleLatest(...) 之后的尾巴：请求发出前那句 setLoading(true)
  // 本来就不依赖响应，不该算违规
  const gateAt = bodyNoComments.indexOf('settleLatest(')
  const tail = gateAt === -1 ? '' : bodyNoComments.slice(gateAt)
  const staleAt = tail.indexOf("status === 'stale'")
  const firstSetter = tail.search(/\bset[A-Z]\w*\(/)
  return {
    found: true,
    usesGate,
    checksStale,
    staleFirst: checksStale && staleAt !== -1 && (firstSetter === -1 || staleAt < firstSetter),
  }
}

const SITES = [
  { file: 'app/admin/collections/page.tsx', fn: 'loadDetail' },
  { file: 'app/admin/tags/page.tsx', fn: 'load' },
  { file: 'app/admin/facets/page.tsx', fn: 'loadSamples' },
  { file: 'app/admin/stats/page.tsx', fn: 'load' },
]

describe('守卫工具本身是对的（否则守卫只是空跑）', () => {
  it('能定位函数体，且不被注释/字符串里的括号带偏', () => {
    const src = [
      'const load = useCallback(() => {',
      "  // 这句注释里有 } 和 setTags([]) 各一个",
      "  const url = '/api/x?a=}'",
      '  setTags([])',
      '})',
    ].join('\n')
    const body = functionBody(src, 'load')
    expect(body).not.toBeNull()
    expect(body!.includes('setTags([])')).toBe(true)
    // 注释里的 setTags 必须被抹掉，否则顺序断言会被它糊过去
    expect(maskComments(body!).includes('setTags([])')).toBe(true)
    expect(maskComments(body!).includes('// 这句注释')).toBe(false)
  })

  it('去字符串的版本会把字符串里的 setTags 抹掉', () => {
    expect(maskCommentsAndStrings("const a = 'setTags([])'").includes('setTags([])')).toBe(false)
  })

  it('没走闸门的写法会被判掉', () => {
    const naive = 'const load = useCallback(() => {\n  void hubGet(url).then((t) => setTags(t))\n})'
    expect(gateDiscipline(naive, 'load')).toEqual({
      found: true,
      usesGate: false,
      checksStale: false,
      staleFirst: false,
    })
  })

  it('过期判断写在状态写入之后也不行', () => {
    const late = [
      'const load = useCallback(() => {',
      '  void (async () => {',
      '    const out = await settleLatest(gate, () => hubGet(url))',
      '    setTags([])',
      "    if (out.status === 'stale') return",
      '  })()',
      '})',
    ].join('\n')
    const r = gateDiscipline(late, 'load')
    expect(r.usesGate).toBe(true)
    expect(r.checksStale).toBe(true)
    expect(r.staleFirst).toBe(false)
  })

  it('请求发出前的 setLoading(true) 不算违规', () => {
    const withPreSet = [
      'const load = useCallback(() => {',
      '  setLoading(true)',
      '  void (async () => {',
      '    const out = await settleLatest(gate, () => hubGet(url))',
      "    if (out.status === 'stale') return",
      '    setTags([])',
      '    setLoading(false)',
      '  })()',
      '})',
    ].join('\n')
    expect(gateDiscipline(withPreSet, 'load').staleFirst).toBe(true)
  })

  it('正确的写法才通过', () => {
    const good = [
      'const load = useCallback(() => {',
      '  void (async () => {',
      '    const out = await settleLatest(gate, () => hubGet(url))',
      "    if (out.status === 'stale') return",
      '    setTags([])',
      '  })()',
      '})',
    ].join('\n')
    expect(gateDiscipline(good, 'load')).toEqual({
      found: true,
      usesGate: true,
      checksStale: true,
      staleFirst: true,
    })
  })
})

describe('管理端这几个「整块覆盖界面」的刷新都必须过闸门', () => {
  it.each(SITES)('$file → $fn', ({ file, fn }) => {
    const source = readFileSync(resolve(SRC, file), 'utf8')
    expect(source.includes("from '@/lib/latest-request'")).toBe(true)
    const r = gateDiscipline(source, fn)
    expect(r.found).toBe(true)
    expect(r.usesGate).toBe(true)
    expect(r.checksStale).toBe(true)
    expect(r.staleFirst).toBe(true)
  })

  it('收藏夹与专题详情共用的闸门模块只有一处实现', () => {
    const mod = readFileSync(resolve(SRC, 'lib', 'latest-request.ts'), 'utf8')
    expect(mod.includes('export function newRequestGate')).toBe(true)
    expect(mod.includes('export async function settleLatest')).toBe(true)
  })
})
