import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  extractWbiKey,
  getMixinKey,
  getWbiMixinKey,
  resetWbiCacheForTest,
  signWbiQuery,
} from '../src/lib/bilibili-wbi'

/**
 * B 站 wbi 签名。
 *
 * 无法在离线环境验证「服务器是否接受这个签名」（需要真实请求 + 不受风控的网络），
 * 所以这里守的是**可确定性验证的部分**：
 *   - 密钥提取与置换表（顺序固定，改一个数字就全错）；
 *   - 签名的确定性、参数排序、非法字符过滤；
 *   - 拿不到密钥时**必须返回 null**（让调用方记 degraded），而不是编一个签名。
 */

const REAL_IMG = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png'
const REAL_SUB = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'

describe('extractWbiKey', () => {
  it('从 wbi_img 的 URL 里取出文件名主干', () => {
    expect(extractWbiKey(REAL_IMG)).toBe('7cd084941338484aae1ad9425b84077c')
    expect(extractWbiKey(REAL_SUB)).toBe('4932caff0ff746eab6f01bf08b70ac45')
  })

  it('空值不抛异常，返回空串', () => {
    expect(extractWbiKey('')).toBe('')
    expect(extractWbiKey('https://i0.hdslb.com/bfs/wbi/')).toBe('')
  })
})

describe('getMixinKey', () => {
  it('输出固定 32 位', () => {
    const key = getMixinKey(
      '7cd084941338484aae1ad9425b84077c',
      '4932caff0ff746eab6f01bf08b70ac45',
    )
    expect(key).toHaveLength(32)
    expect(key).toMatch(/^[0-9a-f]+$/)
  })

  it('按置换表取位：第 1 位来自拼接串的第 46 位', () => {
    const raw = '0123456789abcdef'.repeat(4) // 64 字符，位置 i 的值可辨认
    const key = getMixinKey(raw.slice(0, 32), raw.slice(32))
    // 置换表第一个元素是 46
    expect(key[0]).toBe(raw[46])
    expect(key[1]).toBe(raw[47])
    expect(key[2]).toBe(raw[18])
  })

  it('置换是双向确定的（同输入同输出）', () => {
    const a = getMixinKey('a'.repeat(32), 'b'.repeat(32))
    const b = getMixinKey('a'.repeat(32), 'b'.repeat(32))
    expect(a).toBe(b)
  })
})

describe('signWbiQuery', () => {
  const mixin = 'ea1db124af3c7062474693fa704f4ff8'

  it('同一输入得到同一 w_rid（确定性）', () => {
    const p = { search_type: 'video', keyword: 'React 19', order: 'totalrank' }
    const a = signWbiQuery(p, mixin, 1700000000)
    const b = signWbiQuery(p, mixin, 1700000000)
    expect(a.wRid).toBe(b.wRid)
    expect(a.wRid).toMatch(/^[0-9a-f]{32}$/)
    expect(a.query).toContain(`w_rid=${a.wRid}`)
    expect(a.query).toContain('wts=1700000000')
  })

  it('参数顺序不影响结果（内部按 key 字典序排序）', () => {
    const a = signWbiQuery({ b: '2', a: '1' }, mixin, 1700000000)
    const b = signWbiQuery({ a: '1', b: '2' }, mixin, 1700000000)
    expect(a.query).toBe(b.query)
  })

  it('任一参数或 wts 变化都会改变 w_rid', () => {
    const base = signWbiQuery({ keyword: 'a' }, mixin, 1700000000)
    expect(signWbiQuery({ keyword: 'b' }, mixin, 1700000000).wRid).not.toBe(base.wRid)
    expect(signWbiQuery({ keyword: 'a' }, mixin, 1700000001).wRid).not.toBe(base.wRid)
    expect(signWbiQuery({ keyword: 'a' }, 'x'.repeat(32), 1700000000).wRid).not.toBe(base.wRid)
  })

  it('过滤官方约定要去掉的 !\'()* 字符', () => {
    const { query } = signWbiQuery({ keyword: "a!b'c(d)e*f" }, mixin, 1700000000)
    // 过滤后再 encode：括号不会以 %28/%29 出现
    expect(query).not.toContain('%28')
    expect(query).not.toContain('%29')
    expect(query).toContain('abcdef')
  })

  it('跳过 undefined / 空串参数（避免签进无意义的 key）', () => {
    const { query } = signWbiQuery({ keyword: 'a', empty: '', missing: undefined }, mixin, 1700000000)
    expect(query).not.toContain('empty=')
    expect(query).not.toContain('missing=')
  })
})

describe('getWbiMixinKey — 取不到时必须返回 null', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    resetWbiCacheForTest()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    resetWbiCacheForTest()
  })

  it('nav 接口正常时返回 32 位 mixinKey', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: { wbi_img: { img_url: REAL_IMG, sub_url: REAL_SUB } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const key = await getWbiMixinKey()
    expect(key).toHaveLength(32)
  })

  it('nav 接口 5xx / 网络错误时返回 null（不得伪造签名）', async () => {
    globalThis.fetch = (async () => new Response('oops', { status: 502 })) as unknown as typeof fetch
    expect(await getWbiMixinKey()).toBeNull()

    resetWbiCacheForTest()
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await getWbiMixinKey()).toBeNull()
  })

  it('nav 返回结构变化（缺 wbi_img）时返回 null', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })) as unknown as typeof fetch
    expect(await getWbiMixinKey()).toBeNull()
  })

  it('并发调用只打一次 nav（共享 inflight）', async () => {
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: 0, data: { wbi_img: { img_url: REAL_IMG, sub_url: REAL_SUB } } }),
        { status: 200 },
      ))
    globalThis.fetch = spy as unknown as typeof fetch

    const [a, b, c] = await Promise.all([getWbiMixinKey(), getWbiMixinKey(), getWbiMixinKey()])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('缓存命中时不再请求 nav', async () => {
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: 0, data: { wbi_img: { img_url: REAL_IMG, sub_url: REAL_SUB } } }),
        { status: 200 },
      ))
    globalThis.fetch = spy as unknown as typeof fetch

    await getWbiMixinKey()
    await getWbiMixinKey()
    expect(spy).toHaveBeenCalledTimes(1)

    // forceRefresh 才重新拉
    await getWbiMixinKey({ forceRefresh: true })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
