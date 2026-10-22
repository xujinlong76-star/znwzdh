import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchPagedCatalog, type FetchChunk } from '../src/lib/server/sites-catalog'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 与 canonical-coverage 同一套定位方式：测试同时存在于 overlay/test 与 apps/web/test 两侧 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/**
 * 站点目录的分块取数契约。
 *
 * 这条链子上最贵的错误是「静默少数据」：目录页的总页数、末页链接、
 * 「共收录 N 个」全都来自这里返回的集合，一旦它悄悄截断，页面外观完全正常，
 * 只有爬虫和用户能发现——所以 truncated / failed 必须是显式信号，
 * 而「取完」必须真的能在测试里被证明。
 */

type Row = { id: string }

/** 造一个「按 offset/limit 切片」的假中枢：total 条数据，可选让某些块失败 */
function makeFetch(total: number, opts: { failAtOffset?: number } = {}): FetchChunk<Row> & { calls: number[] } {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `s${i}` }))
  const fn: FetchChunk<Row> & { calls: number[] } = Object.assign(
    async (offset: number, limit: number) => {
      fn.calls.push(offset)
      if (opts.failAtOffset === offset) return null
      return rows.slice(offset, offset + limit)
    },
    { calls: [] as number[] },
  )
  return fn
}

describe('fetchPagedCatalog', () => {
  it('不满一块就停：51 条只发 1 次请求（旧写法固定发 2 次 1000）', async () => {
    const fetch = makeFetch(51)
    const res = await fetchPagedCatalog(fetch)
    expect(fetch.calls).toEqual([0])
    expect(res.items).toHaveLength(51)
    expect(res).toMatchObject({ truncated: false, failed: false })
  })

  it('整块边界：恰好 2 满块时再多取一次确认到底，不算截断', async () => {
    const fetch = makeFetch(2000)
    const res = await fetchPagedCatalog(fetch, { chunkLimit: 1000 })
    expect(fetch.calls).toEqual([0, 1000, 2000])
    expect(res.items).toHaveLength(2000)
    expect(res).toMatchObject({ truncated: false, failed: false })
  })

  it('超过旧上限（2000）不再静默截断：2500 条要全部取到', async () => {
    const res = await fetchPagedCatalog(makeFetch(2500), { chunkLimit: 1000 })
    expect(res.items).toHaveLength(2500)
    expect(res).toMatchObject({ truncated: false, failed: false })
  })

  it('触到分块上限就报 truncated，而不是把已取条数当全量', async () => {
    const fetch = makeFetch(15000)
    const res = await fetchPagedCatalog(fetch, { chunkLimit: 1000, maxChunks: 10 })
    expect(fetch.calls).toHaveLength(10)
    expect(res.items).toHaveLength(10000)
    expect(res.truncated).toBe(true)
    expect(res.failed).toBe(false)
  })

  it('最后一块正好取满到上限时也算截断（宁可少说一句，不可多吹一句）', async () => {
    const res = await fetchPagedCatalog(makeFetch(2000), { chunkLimit: 1000, maxChunks: 2 })
    expect(res.items).toHaveLength(2000)
    expect(res.truncated).toBe(true)
  })

  it('某一块请求失败：停止并标 failed，已取到的部分照常返回（爬虫面不开天窗）', async () => {
    const fetch = makeFetch(2500, { failAtOffset: 1000 })
    const res = await fetchPagedCatalog(fetch, { chunkLimit: 1000 })
    expect(res.items).toHaveLength(1000)
    expect(res.failed).toBe(true)
    // 失败导致的「不完整」不能记成 truncated：那是取数中断，不是数据超预算
    expect(res.truncated).toBe(false)
  })

  it('块与块之间被写入插队导致重复行时按 id 去重（共收录 N 个不能虚高）', async () => {
    const dup: FetchChunk<Row> = async (offset, limit) =>
      offset === 0
        ? Array.from({ length: limit }, (_, i) => ({ id: `s${i}` }))
        : offset === limit
          ? [{ id: 's0' }, { id: 's1' }, { id: `s${limit + 1}` }] // 前两条是重复
          : []
    const res = await fetchPagedCatalog(dup, { chunkLimit: 1000 })
    expect(res.items.map((r) => r.id)).toEqual([
      ...Array.from({ length: 1000 }, (_, i) => `s${i}`),
      's1001',
    ])
  })

  it('空表返回空集合且不算截断（新库/重置后的正常形态）', async () => {
    const res = await fetchPagedCatalog(makeFetch(0), { chunkLimit: 1000 })
    expect(res).toEqual({ items: [], truncated: false, failed: false })
  })
})

/**
 * 源码护栏：把「写死块数」这条路堵在合入口。
 *
 * 纯逻辑测试证明的是 fetchPagedCatalog 的契约；这里证明的是目录页**在用**它。
 * 历史故障正是 `Promise.all([limit=1000&offset=0, ...offset=1000])` 这种写法：
 * 数字一旦写进调用点，数据涨过 2000 就没人回来改，于是静默截断。
 */
describe('站点目录取数写法', () => {
  it('目录页走 fetchPagedCatalog，不再写死 offset', () => {
    const src = overlayFile('src/app/sites/sites-directory.tsx')
    expect(src).toContain('fetchPagedCatalog')
    expect(src).not.toMatch(/offset=(0|1000)\b/)
    expect(src).not.toMatch(/limit=1000/)
  })
})
