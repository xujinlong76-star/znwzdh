/**
 * 视频库缩水保护的二阶段确认：前端写链测试（升级方案 P2）。
 *
 * 中枢那侧的守卫早就有了，缺的是「合法的大规模删除怎么过去」。这条链上
 * 有四件事各自会静默失效，所以分别钉住：
 *   1. 本地守卫的放行判据与中枢一致（两段都要、条数逐字相等）；
 *   2. 确认参数真的传到适配器写入 —— 中间任何一层漏传，中枢还是会 409；
 *   3. 中枢的缩水 409 **不能**被当成版本冲突重放（重放同一份内容只会再撞一次，
 *      最后还给操作者一句误导性的「请刷新重试」）；
 *   4. 真的版本冲突仍按「重读 + 重放」处理，不能被第 3 条带跑。
 */
import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('@/lib/github', () => ({
  commitFile: vi.fn(),
  getFileContent: vi.fn(),
  getStorageVersion: vi.fn(),
  readStorageFresh: vi.fn(),
}))

import { commitFile, getFileContent, getStorageVersion, readStorageFresh } from '@/lib/github'
import { countVideoLibraryItems, mutateVideoLibrary, VIDEOS_FILE_PATH } from '@/lib/video-library-store'
import { isVersionConflict, isVideoShrinkBlock } from '@/lib/video-write-guard'
import { createHttpAdapter, StorageError } from '@/lib/storage-adapter'
import type { NavigationData } from '@/types/navigation'

const BASE = 'http://127.0.0.1:8787'

/** 单分类 n 条：条数就是缩水判据的分子，夹具必须精确可控 */
function lib(n: number): NavigationData {
  return {
    navigationItems: [
      {
        id: 'cat-1',
        title: '分类一',
        items: Array.from({ length: n }, (_, i) => ({
          id: `v-${i}`,
          title: `视频 ${i}`,
          href: `https://example.com/v-${i}`,
        })),
      },
    ],
  } as unknown as NavigationData
}

/** 与中枢 VideoShrinkError 同形的 409（适配器把响应体前 300 字符拼进 message） */
function shrinkError(code: string): StorageError {
  return new StorageError(
    `中枢返回 409：{"error":"${code}","detail":"待写入 10 条，少于库内 200 条的 80%（下限 160 条）"}`,
    409,
  )
}

beforeEach(() => {
  vi.mocked(commitFile).mockReset()
  vi.mocked(getFileContent).mockReset()
  vi.mocked(getStorageVersion).mockReset()
  vi.mocked(readStorageFresh).mockReset()
  vi.mocked(getStorageVersion).mockResolvedValue(7)
  vi.mocked(getFileContent).mockResolvedValue(null)
})

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe('本地守卫与中枢同判据', () => {
  beforeEach(() => {
    vi.mocked(readStorageFresh).mockResolvedValue(lib(200))
  })

  it('未确认的骤降：抛错并且一次都不提交', async () => {
    await expect(
      mutateVideoLibrary(() => ({ next: lib(10), result: null }), 'msg'),
    ).rejects.toThrow(/从 200 骤降至 10/)
    expect(commitFile).not.toHaveBeenCalled()
  })

  it('只给 confirm、不声明条数：照样拦（否则守卫退化成一个布尔开关）', async () => {
    await expect(
      mutateVideoLibrary(() => ({ next: lib(10), result: null }), 'msg', { confirmLargeDeletion: true }),
    ).rejects.toThrow(/骤降至/)
    expect(commitFile).not.toHaveBeenCalled()
  })

  it('confirm + 条数不符：拦下', async () => {
    await expect(
      mutateVideoLibrary(() => ({ next: lib(10), result: null }), 'msg', {
        confirmLargeDeletion: true,
        expectedCount: 199,
      }),
    ).rejects.toThrow(/骤降至/)
    expect(commitFile).not.toHaveBeenCalled()
  })

  it('报错文案给出该带的 expectedCount', async () => {
    const err = await mutateVideoLibrary(() => ({ next: lib(10), result: null }), 'msg').catch((e) => e as Error)
    expect(err.message).toContain('expectedCount=10')
  })

  it('两段齐全：放行，并把确认参数带到适配器写入', async () => {
    vi.mocked(commitFile).mockResolvedValue({ ok: true, note: 'ok', version: 8, attempts: 1 })

    const outcome = await mutateVideoLibrary(() => ({ next: lib(10), result: null }), 'msg', {
      confirmLargeDeletion: true,
      expectedCount: 10,
    })

    expect(outcome.ok).toBe(true)
    expect(commitFile).toHaveBeenCalledTimes(1)
    const args = vi.mocked(commitFile).mock.calls[0]
    expect(args[0]).toBe(VIDEOS_FILE_PATH)
    expect(args[5]).toBe(7) // ifVersion 不能被确认参数挤掉
    expect(args[6]).toEqual({ confirmLargeDeletion: true, expectedCount: 10 })
    // 写回去的文档条目数就是声明的那个数字
    expect(countVideoLibraryItems(JSON.parse(String(args[1])) as NavigationData)).toBe(10)
  })

  it('分类数减少同样是确认覆盖的情形（合法删分类不该被无条件判死）', async () => {
    // 80 条 / 2 分类：条数守卫不触发（基线 <100），只有分类守卫会拦 ——
    // 用一个「只撞第二道守卫」的场景，才能证明确认对两道都有效
    vi.mocked(readStorageFresh).mockResolvedValue({
      navigationItems: [
        { id: 'a', title: 'A', items: Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, href: `https://example.com/a${i}` })) },
        { id: 'b', title: 'B', items: Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, href: `https://example.com/b${i}` })) },
      ],
    } as unknown as NavigationData)
    vi.mocked(commitFile).mockResolvedValue({ ok: true, note: 'ok', version: 8, attempts: 1 })

    await expect(
      mutateVideoLibrary(() => ({ next: lib(40), result: null }), 'msg'),
    ).rejects.toThrow(/分类数从 2 减少至 1/)

    // 只给 confirm 不给条数：两道守卫都不放行 —— 本地判据必须与中枢一致（两段齐全），
    // 否则会出现「中枢准备放行、本地先拦死」或反过来「本地放过、中枢拦下」的错位。
    await expect(
      mutateVideoLibrary(() => ({ next: lib(40), result: null }), 'msg', { confirmLargeDeletion: true }),
    ).rejects.toThrow(/分类数从 2 减少至 1/)

    const outcome = await mutateVideoLibrary(() => ({ next: lib(40), result: null }), 'msg', {
      confirmLargeDeletion: true,
      expectedCount: 40,
    })
    expect(outcome.ok).toBe(true)
  })
})

describe('409 的两种含义必须分得开', () => {
  it('中枢缩水拦截：原样抛出，不做无意义的重放', async () => {
    vi.mocked(readStorageFresh).mockResolvedValue(lib(200))
    vi.mocked(commitFile).mockRejectedValue(shrinkError('video_shrink_requires_confirmation'))

    await expect(
      mutateVideoLibrary(() => ({ next: lib(10), result: null }), 'msg', {
        confirmLargeDeletion: true,
        expectedCount: 10,
      }),
    ).rejects.toThrow(/video_shrink_requires_confirmation/)

    // 重放同一份内容只会再被拦一次：这里必须是 1 次，不是 3 次
    expect(commitFile).toHaveBeenCalledTimes(1)
  })

  it('真版本冲突：仍按「重读 + 重放」处理', async () => {
    vi.mocked(readStorageFresh).mockResolvedValue(lib(100))
    vi.mocked(commitFile)
      .mockRejectedValueOnce(new StorageError('中枢返回 409：{"error":"version_conflict"}', 409))
      .mockResolvedValueOnce({ ok: true, note: 'ok', version: 9, attempts: 1 })

    const outcome = await mutateVideoLibrary(() => ({ next: lib(101), result: null }), 'msg')

    expect(outcome.ok).toBe(true)
    expect(outcome.attempts).toBe(2)
    expect(commitFile).toHaveBeenCalledTimes(2)
    expect(readStorageFresh).toHaveBeenCalledTimes(2) // 每轮都重读最新，不复用旧快照
  })

  it('判定函数本身：缩水不是冲突', () => {
    const shrink = shrinkError('video_shrink_expected_count_mismatch')
    expect(isVideoShrinkBlock(shrink)).toBe(true)
    expect(isVersionConflict(shrink)).toBe(false)
    const conflict = new StorageError('中枢返回 409：{"error":"version_conflict"}', 409)
    expect(isVideoShrinkBlock(conflict)).toBe(false)
    expect(isVersionConflict(conflict)).toBe(true)
    expect(isVideoShrinkBlock(null)).toBe(false)
    expect(isVideoShrinkBlock('video_shrink_requires_confirmation')).toBe(false) // 非对象不算
  })
})

describe('http 适配器只在显式给出时带上确认参数', () => {
  async function writeWithBody(writeOpts?: Parameters<ReturnType<typeof createHttpAdapter>['write']>[3]) {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, note: '已更新' }), { status: 200 }),
    )
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch })
    await adapter.write(VIDEOS_FILE_PATH, '{}', 'msg', writeOpts)
    return JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as Record<string, unknown>
  }

  it('不带确认：请求体里既没有 confirm 也没有 expectedCount（省略 ≠ false）', async () => {
    const body = await writeWithBody({ ifVersion: 7 })
    expect(body.ifVersion).toBe(7)
    expect('confirmLargeDeletion' in body).toBe(false)
    expect('expectedCount' in body).toBe(false)
  })

  it('带确认：两段一起进请求体', async () => {
    const body = await writeWithBody({ ifVersion: 7, confirmLargeDeletion: true, expectedCount: 10 })
    expect(body).toMatchObject({ ifVersion: 7, confirmLargeDeletion: true, expectedCount: 10 })
  })
})

describe('PUT /api/videos 的处理', () => {
  const code = readFileSync(
    new URL('../src/app/api/videos/route.ts', import.meta.url),
    'utf8',
  )

  it('确认参数从文档里剥出来，不会被写进 videos.json', () => {
    expect(code).toMatch(/const \{\s*confirmLargeDeletion,\s*expectedCount,\s*\.\.\.data\s*\} = payload/)
    expect(code).toMatch(/next: data as NavigationData/)
  })

  it('expectedCount 只认非负整数，缩水 409 走 409 而不是 500', () => {
    expect(code).toMatch(/Number\.isInteger\(expectedCount\)/)
    expect(code).toMatch(/isVideoShrinkBlock\(error\)/)
    expect(code).toMatch(/status: 409/)
  })
})
