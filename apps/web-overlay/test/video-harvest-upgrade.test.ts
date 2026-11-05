/**
 * 视频采集子系统升级（2026-11-05）的回归锚点。
 *
 * 覆盖升级方案的四类改动：
 *   A. B 站域名断言（bili-parse 匿名端点不再把任意 URL 转发给第三方解析站）；
 *   B. 死链探活覆盖非内置平台（此前 vimeo/ted/… 一律 healthy，巡检空转）；
 *   C. 双层租约（中枢 KV CAS）、指标 max 合并与任务排队语义；
 *   D. 解析引擎合规倒置（官方优先、第三方兜底/可关停）；
 *   E. bili-stream 的 DNS/IP 级 SSRF 校验与空闲看门狗；
 *   F. 假数据治理与路由状态码语义（源码守卫）。
 *
 * 写法沿用本仓先例：能离线单测的行为直接测；跑不起来的（要中枢/登录态）
 * 用源码守卫钉住关键写法。
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
}

/** 去掉注释，避免「注释里写了旧代码」导致守卫误判（同 video-api-guards） */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// 本文件的 import 图里只有任务队列/锁需要中枢适配器：mock 掉 github，
// 顺便绕开 next-auth 在 vitest 下的解析问题（见 video-write-guard.ts 头注释）
vi.mock('@/lib/github', () => ({
  commitFile: vi.fn(async () => ({ ok: true })),
  getFileContent: vi.fn(async () => ({ navigationItems: [] })),
  readStorageFresh: vi.fn(async () => null),
  getStorageVersion: vi.fn(async () => null),
  getFileContentWithStatus: vi.fn(async () => ({ data: { navigationItems: [] }, degraded: false })),
  invalidateContentCache: vi.fn(),
}))

// 任务队列的 worker 只在本文件里跑到 mock 报告即可（真实引擎另测）
vi.mock('@/lib/video-harvester', () => ({
  runVideoHarvestAndRotation: vi.fn(async () => ({
    timestamp: 0,
    dryRun: true,
    totalCheckedCategories: 0,
    totalHarvestedCount: 0,
    totalAddedCount: 0,
    totalReplacedCount: 0,
    additions: [],
    replacements: [],
    degradedKeywords: [],
    categorySummaries: [],
  })),
  VideoShrinkBlockedError: class VideoShrinkBlockedError extends Error {},
}))

const { normalizeBilibiliTarget } = await import('../src/lib/video-bilibili-hd-url')
const { probeVideoAvailability } = await import('../src/lib/video-deadlink-sweeper')
const metrics = await import('../src/lib/video-harvest-metrics')
const parser = await import('../src/lib/video-bilibili-hd-parser')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

afterAll(() => {
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// A. B 站域名断言
// ---------------------------------------------------------------------------
describe('A：normalizeBilibiliTarget 只放行 B 站域（P0-4 任意 URL 中继）', () => {
  it('B 站域（含 www / b23.tv 短链）照常放行', () => {
    expect(normalizeBilibiliTarget({ url: 'https://www.bilibili.com/video/BV1MmUSB5Efw' }).bvid).toBe('BV1MmUSB5Efw')
    expect(normalizeBilibiliTarget({ url: 'https://b23.tv/ab3cd9' }).canonicalUrl).toContain('b23.tv')
  })

  it('非 B 站 http(s) URL 直接拒绝，不再转发给第三方解析站', () => {
    expect(() => normalizeBilibiliTarget({ url: 'https://evil.example.com/steal?u=1' })).toThrow(/仅支持 B 站/)
    expect(() => normalizeBilibiliTarget({ url: 'http://127.0.0.1:8787/internal' })).toThrow(/仅支持 B 站/)
  })

  it('含 BV 号的内容不受影响（强标识优先于域名判断）', () => {
    const target = normalizeBilibiliTarget({ url: ' BV1MmUSB5Efw ' })
    expect(target.bvid).toBe('BV1MmUSB5Efw')
    expect(target.canonicalUrl).toBe('https://www.bilibili.com/video/BV1MmUSB5Efw')
  })
})

// ---------------------------------------------------------------------------
// B. 死链探活覆盖非内置平台
// ---------------------------------------------------------------------------
describe('B：非内置平台的真实 HTTP 探测（此前一律 healthy，巡检空转）', () => {
  const item = {
    id: 'item_vimeo_1',
    title: 'Vimeo 教程',
    href: 'https://vimeo.com/123456789',
    videoConfig: { type: 'vimeo' },
  }

  function fetchWith(headStatus: number | 'reject', getStatus = 200) {
    return vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        if (headStatus === 'reject') throw new Error('connect ECONNREFUSED')
        return new Response(null, { status: headStatus })
      }
      return new Response(null, { status: getStatus })
    }) as unknown as typeof fetch
  }

  it('HEAD 200 → healthy；404 → dead；403 → unverified（防盗链不判死）', async () => {
    vi.stubGlobal('fetch', fetchWith(200))
    const ok = await probeVideoAvailability(item as never, 500)
    expect(ok.state).toBe('healthy')

    vi.stubGlobal('fetch', fetchWith(404))
    const gone = await probeVideoAvailability(item as never, 500)
    expect(gone.state).toBe('dead')

    vi.stubGlobal('fetch', fetchWith(403))
    const blocked = await probeVideoAvailability(item as never, 500)
    expect(blocked.state).toBe('unverified')
  })

  it('站点不支持 HEAD（405/501）时用 GET 复核', async () => {
    vi.stubGlobal('fetch', fetchWith(405, 200))
    const result = await probeVideoAvailability(item as never, 500)
    expect(result.state).toBe('healthy')
  })

  it('超时/网络错误仍是 unverified，绝不进删除分母', async () => {
    vi.stubGlobal('fetch', fetchWith('reject'))
    const result = await probeVideoAvailability(item as never, 500)
    expect(result.state).toBe('unverified')
  })

  it('非 http(s) 目标无从探测：保持 healthy 并注明原因', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const result = await probeVideoAvailability(
      { id: 'x', title: 't', videoConfig: { type: 'custom' } } as never,
      500,
    )
    expect(result.state).toBe('healthy')
    expect(result.reason).toContain('跳过')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// C1. 指标合并（max 语义，重启后接历史）
// ---------------------------------------------------------------------------
describe('C1：mergeVideoMetrics 取 max（hydrate 不翻倍历史）', () => {
  it('落盘值接上历史累计，后续进程内累加继续生效', () => {
    metrics.resetVideoMetricsForTest()
    metrics.mergeVideoMetrics({
      harvest: { runs: 7, failed: 1, added: 20, replaced: 0, degradedKeywords: 2 },
      sweep: { runs: 0, failed: 0, healthy: 0, dead: 0, unverified: 0, pruned: 0 },
      lastHarvestAt: 12345,
      lastSweepAt: null,
      lastError: null,
    })
    const hydrated = metrics.videoMetricsSnapshot()
    expect(hydrated.harvest.runs).toBe(7)
    expect(hydrated.harvest.added).toBe(20)
    expect(hydrated.lastHarvestAt).toBe(12345)

    metrics.recordHarvestRun({ ok: true, added: 3 })
    const snap = metrics.videoMetricsSnapshot()
    expect(snap.harvest.runs).toBe(8) // max(7,7) 之后 +1
    expect(snap.harvest.added).toBe(23) // max(20,20) 之后 +3
    expect(snap.lastHarvestAt).toBeGreaterThan(12345)
  })

  it('两边都是 0/缺失时不出 1970 时间戳', () => {
    metrics.resetVideoMetricsForTest()
    metrics.mergeVideoMetrics(null)
    const snap = metrics.videoMetricsSnapshot()
    expect(snap.lastHarvestAt).toBeNull()
    expect(snap.lastSweepAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// C2. 跨实例租约（mock 中枢 github 适配器）
// ---------------------------------------------------------------------------
describe('C2：acquireHarvestLease 的 CAS 能力探测与降级', () => {
  it('适配器不支持版本号（version=null）→ 降级为仅进程内锁，如实标注 degraded', async () => {
    const github = await import('@/lib/github')
    ;(github.getStorageVersion as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const lock = await import('../src/lib/video-harvest-lock')
    const outcome = await lock.acquireHarvestLease('owner_a', 60_000)
    expect(outcome.success).toBe(true)
    expect(outcome.degraded).toBe(true)
  })

  it('他人持有未过期租约 → 拒绝；本人持有 → 续租放行', async () => {
    const github = await import('@/lib/github')
    const version = 42
    ;(github.getStorageVersion as ReturnType<typeof vi.fn>).mockResolvedValue(version)
    ;(github.readStorageFresh as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      owner: 'instance_1',
      expiresAt: Date.now() + 60_000,
      savedAt: Date.now(),
    })
    ;(github.commitFile as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue({ ok: true })

    const lock = await import('../src/lib/video-harvest-lock')
    const denied = await lock.acquireHarvestLease('instance_2', 60_000)
    expect(denied.success).toBe(false)
    expect(denied.error).toContain('instance_1')

    const renewed = await lock.acquireHarvestLease('instance_1', 60_000)
    expect(renewed.success).toBe(true)
    expect(github.commitFile).toHaveBeenCalledWith(
      'data/video-harvest-lock.json',
      expect.any(String),
      expect.any(String),
      undefined,
      1,
      version,
    )
  })

  it('释放时只清自己的租约', async () => {
    const github = await import('@/lib/github')
    ;(github.getStorageVersion as ReturnType<typeof vi.fn>).mockResolvedValue(7)
    ;(github.readStorageFresh as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      owner: 'instance_1',
      expiresAt: Date.now() + 60_000,
      savedAt: Date.now(),
    })
    ;(github.commitFile as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue({ ok: true })

    const lock = await import('../src/lib/video-harvest-lock')
    await lock.releaseHarvestLease('instance_9') // 他人：不写
    expect(github.commitFile).not.toHaveBeenCalled()
    await lock.releaseHarvestLease('instance_1') // 本人：清空
    expect(github.commitFile).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// C3. 任务排队语义（锁被占 → 排队而非 409；队列满 → 类型化错误）
// ---------------------------------------------------------------------------
describe('C3：scheduleAndRunVideoHarvest 的排队语义', () => {
  it('锁被占时任务入队（pending + 排队中），队列满抛 HarvestBusyError(queue_full)', async () => {
    vi.resetModules()
    const queue = await import('../src/lib/video-task-queue')

    // 占住锁，模拟「已有任务在跑」
    expect(queue.videoTaskQueue.acquireLock('someone_else', 60_000).success).toBe(true)

    const first = await queue.scheduleAndRunVideoHarvest({ dryRun: true, trigger: 'admin' })
    expect(first.queued).toBe(true)
    expect(first.task.status).toBe('pending')
    expect(first.task.progress.stage).toContain('排队中')

    await queue.scheduleAndRunVideoHarvest({ dryRun: true, trigger: 'admin' })
    await queue.scheduleAndRunVideoHarvest({ dryRun: true, trigger: 'admin' })
    expect(queue.videoTaskQueue.getQueueDepth()).toBe(3)

    await expect(queue.scheduleAndRunVideoHarvest({ dryRun: true, trigger: 'admin' })).rejects.toMatchObject({
      name: 'HarvestBusyError',
      code: 'queue_full',
    })

    // 收尾：放锁并唤起队列，worker 跑的是文件级 mock（不打网络）
    queue.videoTaskQueue.releaseLock('someone_else')
    queue.videoTaskQueue.drainQueuedTasks()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})

// ---------------------------------------------------------------------------
// D. 解析引擎合规倒置 + 第三方关停
// ---------------------------------------------------------------------------
describe('D：解析引擎官方优先，第三方可关停', () => {
  it('引擎优先级：官方 WBI 在第三方（星之阁/米人）之前', () => {
    const code = stripComments(src('lib/video-bilibili-hd-parser.ts'))
    const wbi = code.indexOf("name: 'bilibili_wbi'")
    const xz = code.indexOf("name: 'xingzhige'")
    const mir6 = code.indexOf("name: 'mir6'")
    expect(wbi).toBeGreaterThan(0)
    expect(xz).toBeGreaterThan(wbi)
    expect(mir6).toBeGreaterThan(xz)
    expect(code).toContain('NAVHUB_BILI_DISABLE_THIRD_PARTY')
  })

  it('第三方关停后，官方通道失败 → 直接内嵌兜底，不向第三方转发', async () => {
    vi.stubEnv('NAVHUB_BILI_DISABLE_THIRD_PARTY', '1')
    parser.clearBilibiliHdStreamCache()
    // 全局 fetch 也掐断：bilibili-wbi 取 mixinKey 的 nav 接口走全局 fetch，必须快速失败
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network offline')
      }) as unknown as typeof fetch,
    )
    const seen: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen.push(String(input))
      throw new Error('network offline')
    }) as unknown as typeof fetch

    const result = await parser.resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw' }, fetchImpl)
    expect(result.ok).toBe(false)
    expect(result.source).toBe('iframe_fallback')
    expect(seen.join('|')).not.toContain('xingzhige')
    expect(seen.join('|')).not.toContain('mir6')
    expect(result.errorReason).not.toContain('xingzhige')
  })

  it('默认配置下第三方兜底仍然可用（官方全挂时由星之阁救回）', async () => {
    vi.stubEnv('NAVHUB_BILI_DISABLE_THIRD_PARTY', '')
    parser.clearBilibiliHdStreamCache()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network offline')
      }) as unknown as typeof fetch,
    )
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.xingzhige.com')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              bvid: 'BV1MmUSB5Efw',
              video: { title: '兜底成功', url: 'https://upos-sz-mirrorhw.bilivideo.com/x.mp4' },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error('network offline')
    }) as unknown as typeof fetch

    const result = await parser.resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw' }, fetchImpl)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('xingzhige')
  })
})

// ---------------------------------------------------------------------------
// E. bili-stream 的 DNS/IP 级 SSRF 校验（mock DNS 指向内网）
// ---------------------------------------------------------------------------
describe('E：bili-stream 域名白名单之外的解析后 IP 校验', () => {
  it('白名单域名解析到受保护网段 → 403，且不打上游', async () => {
    vi.stubEnv('NAVHUB_BILI_STREAM_SSRF_GUARD', '1')
    vi.doMock('node:dns/promises', () => ({
      default: { lookup: async () => [{ address: '127.0.0.1' }] },
      lookup: async () => [{ address: '127.0.0.1' }],
    }))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    vi.resetModules()
    const mod = await import('../src/app/api/videos/bili-stream/route')
    const request = new Request(
      'https://app.example.com/api/videos/bili-stream?url=https%3A%2F%2Fupos-sz-mirrorhw.bilivideo.com%2Fx.mp4',
    )
    const res = await (mod.GET as (r: Request) => Promise<Response>)(request)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error?: string }).error).toContain('受限')
    expect(fetchSpy, 'SSRF 拦截发生在出站之前').not.toHaveBeenCalled()
    vi.doUnmock('node:dns/promises')
  })

  it('源码守卫：路由接入 resolveAndCheck + 空闲看门狗（暂停播放不再永久占槽）', () => {
    const code = stripComments(src('app/api/videos/bili-stream/route.ts'))
    expect(code).toMatch(/resolveAndCheck\s*\(/)
    expect(code).toMatch(/setInterval\s*\(/)
    expect(code).toMatch(/clearInterval\s*\(\s*watchdog\s*\)/)
    expect(code).toMatch(/GLOBAL_STREAM_BUDGET/)
    expect(code).toMatch(/resolveRateLimitKey\s*\(/)
  })
})

// ---------------------------------------------------------------------------
// F. 假数据治理 + 路由语义守卫
// ---------------------------------------------------------------------------
describe('F：假数据治理与路由状态码语义（源码守卫）', () => {
  it('连接器不再编造互动数据（RSS 50000 / stars×10）与默认时长', () => {
    const code = stripComments(src('lib/video-multi-source-connector.ts'))
    expect(code).not.toMatch(/views:\s*50000/)
    expect(code).not.toMatch(/likes:\s*3500/)
    expect(code).not.toMatch(/stars\s*\*\s*10/)
    expect(code).not.toMatch(/durationSec:\s*1200/)
    expect(code).not.toMatch(/durationSec:\s*1800/)
  })

  it('harvest/task 不再把一切错误当 409；畸形 JSON 是 400', () => {
    const code = stripComments(src('app/api/videos/harvest/task/route.ts'))
    expect(code).toMatch(/HarvestBusyError/)
    expect(code).toMatch(/request\.json\(\)\.catch\(/)
    // 忙碌 409 与程序错误 500 分支并存，畸形 JSON 有自己的 400
    expect(code).toMatch(/status: 400/)
    expect(code).toMatch(/status: 409/)
    expect(code).toMatch(/status: 500/)
  })

  it('采集参数有钳制，不再接受任意大数字', () => {
    const harvest = stripComments(src('app/api/videos/harvest/route.ts'))
    expect(harvest).toMatch(/clampPositiveInt\s*\(/)
    const ai = stripComments(src('app/api/videos/ai-autonomous-harvest/route.ts'))
    expect(ai).toMatch(/clampPositiveInt\s*\(/)
  })

  it('主采集路径不再吞写失败（缩水拦截显式失败，版本冲突交给整体重放）', () => {
    const code = stripComments(src('lib/video-harvester.ts'))
    expect(code).toMatch(/isVideoShrinkBlock\s*\(/)
    expect(code).toMatch(/VideoShrinkBlockedError/)
    // 旧的「降级为临时应用模式」吞错误写法必须消失
    expect(code).not.toMatch(/降级为临时应用模式/)
  })

  it('cron 采集入口接入指标落盘；巡检报告落中枢 KV', () => {
    const cron = stripComments(src('app/api/cron/video-harvest/route.ts'))
    expect(cron).toMatch(/hydrateVideoMetrics\s*\(/)
    const sweep = stripComments(src('app/api/cron/video-health-sweep/route.ts'))
    expect(sweep).toMatch(/persistSweepReport\s*\(/)
    expect(sweep).toMatch(/scheduleVideoMetricsPersist\s*\(/)
    // 巡检路由本身不得出现 commitFile（历史整包覆盖事故的守卫）
    expect(sweep).not.toMatch(/\bcommitFile\s*\(/)
  })

  it('匿名端点错误响应不再外泄内部异常信息', () => {
    const webhook = stripComments(src('app/api/videos/webhook-harvest/route.ts'))
    expect(webhook).not.toMatch(/message:\s*\(error as Error\)\.message/)
    const harvest = stripComments(src('app/api/videos/harvest/route.ts'))
    expect(harvest).not.toMatch(/details:\s*\(error as Error\)\.message/)
  })
})
