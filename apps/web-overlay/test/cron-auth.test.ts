import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { requireCronSecret } from '../src/lib/cron-auth'

/**
 * 回归守卫：cron 端点必须 fail-closed。
 *
 * 历史实现：
 *   const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_JOB_TOKEN
 *   const querySecret = searchParams.get('secret')
 *   if (cronSecret && providedSecret !== cronSecret) { 401 }
 *
 * 两个后果：
 *   1. 生产漏配 CRON_SECRET → 校验整段跳过，匿名请求可触发采集写库；
 *   2. `?secret=` 允许密钥进 URL（access log / Referer / 浏览器历史）。
 * 下面每条断言在旧实现下都会失败。
 */

const ENV_KEYS = ['CRON_SECRET', 'INTERNAL_JOB_TOKEN'] as const

/**
 * 环境变量清理必须挂在 afterAll（本仓 mock-hygiene 守卫的硬要求）：
 * 测试是并发跑的，只在 afterEach 恢复会让「最后一个用例之后」的状态泄漏给同进程的其它文件。
 */
const ORIGINAL: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k]
})

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL[k]
  }
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/cron/video-harvest', { method: 'POST', headers })
}

describe('requireCronSecret', () => {
  it('未配置 secret 时拒绝（503），而不是放行', () => {
    const res = requireCronSecret(req())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(503)
      expect(res.error).toContain('未启用')
    }
  })

  it('配置了 secret 但请求没带 Authorization → 401', () => {
    process.env.CRON_SECRET = 's3cret'
    const res = requireCronSecret(req())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(401)
  })

  it('secret 错误 → 401', () => {
    process.env.CRON_SECRET = 's3cret'
    const res = requireCronSecret(req({ authorization: 'Bearer wrong' }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(401)
  })

  it('secret 正确 → 通过', () => {
    process.env.CRON_SECRET = 's3cret'
    const res = requireCronSecret(req({ authorization: 'Bearer s3cret' }))
    expect(res.ok).toBe(true)
  })

  it('INTERNAL_JOB_TOKEN 可作为等价凭据', () => {
    process.env.INTERNAL_JOB_TOKEN = 'internal'
    expect(requireCronSecret(req({ authorization: 'Bearer internal' })).ok).toBe(true)
  })

  it('不再接受 ?secret= 查询参数（旧实现的泄露通道）', () => {
    process.env.CRON_SECRET = 's3cret'
    const withQuery = new Request('https://example.com/api/cron/video-harvest?secret=s3cret', {
      method: 'POST',
    })
    const res = requireCronSecret(withQuery)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(401)
  })

  it('空 Bearer 不算通过', () => {
    process.env.CRON_SECRET = 's3cret'
    const res = requireCronSecret(req({ authorization: 'Bearer ' }))
    expect(res.ok).toBe(false)
  })
})
