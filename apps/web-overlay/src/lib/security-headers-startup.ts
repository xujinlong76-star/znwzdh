/**
 * 安全头启动告警（U-415）。
 *
 * 背景：CSP / HSTS 都是**构建期**变量（next.config.js 的 headers() 在
 * `next build` 时求值并写入 routes-manifest，运行时改 env 不生效），所以
 * 「部署时忘了开安全头」在运行期是静默的——服务照常跑，只是不下发头。
 * 本模块在生产启动时读构建产物 `.next/routes-manifest.json`（响应头的
 * 事实源），缺哪项就告警哪项；产物不可读（standalone / 构建中）时静默
 * 跳过，不刷假警报。告警不抛错：http-only 自托管关 HSTS 可能是有意的。
 *
 * 判定口径与 next.config.js 一致：
 *   - CSP：enforce 与 report-only 任一出现即算有；
 *   - HSTS：Strict-Transport-Security 出现即算有。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface SecurityHeaderStatus {
  csp: boolean
  hsts: boolean
}

/** 从 routes-manifest 的 headers 规则里判定 CSP / HSTS 是否下发。 */
export function inspectSecurityHeaders(rules: unknown): SecurityHeaderStatus {
  const keys = new Set<string>()
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const headers = (rule as { headers?: unknown } | null | undefined)?.headers
      if (!Array.isArray(headers)) continue
      for (const header of headers) {
        const key = (header as { key?: unknown } | null | undefined)?.key
        if (typeof key === 'string') keys.add(key.toLowerCase())
      }
    }
  }
  return {
    csp: keys.has('content-security-policy') || keys.has('content-security-policy-report-only'),
    hsts: keys.has('strict-transport-security'),
  }
}

/**
 * 读构建产物并对缺失的安全头打启动告警。返回缺失项（空 = 全有，或产物
 * 不可读）。distDir 默认取 `process.cwd()/.next`（NEXT_DIST_DIR 可覆盖，
 * 与 next.config.js 的 distDir 同口径）。
 */
export async function warnIfSecurityHeadersOff(distDir?: string): Promise<string[]> {
  const dir = distDir ?? join(process.cwd(), process.env.NEXT_DIST_DIR ?? '.next')
  let raw: string
  try {
    raw = await readFile(join(dir, 'routes-manifest.json'), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const status = inspectSecurityHeaders((parsed as { headers?: unknown } | null | undefined)?.headers)
  const missing: string[] = []
  if (!status.csp) missing.push('Content-Security-Policy(-Report-Only)')
  if (!status.hsts) missing.push('Strict-Transport-Security')
  for (const name of missing) {
    console.warn(
      `[security-headers] 安全头未下发：${name} —— 默认构建应同时下发 CSP report-only 与 HSTS（Docker 默认 NAVHUB_CSP_REPORT_ONLY=1、上报到 /api/csp-report，compose 默认 NAVHUB_HSTS=1）。确认有意关闭（构建期设对应变量为 0）后再忽略此告警。`,
    )
  }
  return missing
}
