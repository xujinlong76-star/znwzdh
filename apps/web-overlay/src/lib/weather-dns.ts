import {
  SsrfBlockedError,
  WEATHER_DNS_TIMEOUT_MS,
  createExternalDnsResolver,
  verifyWeatherDnsResolver,
  type DnsResolverLike,
} from '@/lib/ssrf-guard'

/**
 * 天气路由的真实 DNS 解析器（单例，移植 PR #208 的巡检方案）。
 *
 * 进程内第一次出网才创建解析器并跑一次金丝雀自检（example.com）：
 * 金丝雀失败 = 解析器不可信，本次取数直接按 dns_failure 失败
 * （stale/502），绝不回退系统解析器。金丝雀失败结果缓存 60 秒，
 * 避免每次请求都付一次 5 秒超时；60 秒后下一次请求重试。
 *
 * 其它路由不受影响：只有天气两路由（预报/AQI/地理编码）调这里。
 */

let cached: Promise<DnsResolverLike> | null = null
let canaryFailedUntil = 0
let override: DnsResolverLike | null = null

/** 测试注入：传入假解析器（不触网、不跑金丝雀）；传入 null 恢复真实解析器。 */
export function __setWeatherDnsResolverForTest(resolver: DnsResolverLike | null): void {
  override = resolver
  cached = null
  canaryFailedUntil = 0
}

export async function getWeatherDnsResolver(): Promise<DnsResolverLike> {
  if (override) return override
  if (Date.now() < canaryFailedUntil) {
    throw new SsrfBlockedError('天气 DNS 金丝雀自检失败（60 秒内不再重试），未回退系统解析器', 'dns-failure')
  }
  if (!cached) {
    cached = (async () => {
      const resolver = createExternalDnsResolver()
      const canary = await verifyWeatherDnsResolver(resolver)
      if (!canary.ok) {
        cached = null
        canaryFailedUntil = Date.now() + 60_000
        throw new SsrfBlockedError(`天气 DNS 金丝雀自检失败：${canary.reason}，未回退系统解析器`, 'dns-failure')
      }
      return resolver
    })()
  }
  return cached
}

export { WEATHER_DNS_TIMEOUT_MS }
