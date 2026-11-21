/**
 * Web 层的 SSRF 出口（2026-11-21 收口）。
 *
 * ## 为什么改成一个薄壳
 *
 * 这个文件此前是 packages/ai/src/ssrf.ts 的**完整副本**——两套
 * assertUrlShape / isBlockedIp / resolveAndCheck / guardedFetch 各自维护。
 * 后果是真实漂移：权威层早早支持了逐跳剥离敏感头，这里靠一个 parity
 * 测试才发现没跟上；每加一道防线都要改两处，忘一处就是一次回归。
 * 本轮把能力统一收口到 packages/ai，本文件只做 re-export + 保留两个
 * 只对 Edge/Web 有意义的辅助函数（它们操作的是 Web 的 Response 对象，
 * 塞进 packages/ai 会让那个包依赖 Web 标准类型）。
 *
 * ## 新增的统一入口
 *
 * `safeFetch` 是本次 CodeQL 8 条 Critical SSRF 告警的收敛点：
 * 它把「校验过的 IP」用连接级 lookup 钉到 socket 上（Node 的 fetch 会
 * 静默忽略 connect 选项，实测 lookup 回调从不触发——这也是为什么不能
 * 继续用 fetch 写"钉扎"）。业务路由应优先用它，其次才用 guardedFetch
 * （后者保留给需要逐跳观测的场景）。
 */
import { isIP } from 'node:net'

import {
  ALLOWED_PROTOCOLS,
  DEFAULT_GUARD,
  SsrfBlockedError,
  assertUrlShape,
  guardedFetch as coreGuardedFetch,
  isBlockedIp,
  isHostAllowed,
  resolveAndCheck,
  safeFetch,
} from '@navhub/ai/ssrf'

export {
  ALLOWED_PROTOCOLS,
  DEFAULT_GUARD,
  SsrfBlockedError,
  assertUrlShape,
  isBlockedIp,
  isHostAllowed,
  resolveAndCheck,
  safeFetch,
}

/**
 * 高危端口禁用表（数值副本，2026-11-21 收口时保留）。
 *
 * 为什么收口了还要留一份：apps/web 是 vendored 底座、不在 pnpm workspace 内，
 * Next 构建期无法解析 @navhub/core（vitest 有别名、next build 没有），
 * 所以这里只能复制字面量。一致性由 apps/web/test/ssrf-ports-drift.test.ts
 * 守三方相等（本文件 / packages/ai / packages/core 的并集）。
 *
 * 注意：这是一份**数据副本**，不是第二套校验实现——校验逻辑仍然只有
 * packages/ai 一处；这里只提供端口集合供本层复用。
 */
export const BLOCKED_PORTS = new Set([
  21, 22, 23, 25, 110, 111, 135, 139, 143, 445,
  512, 513, 514, 1433, 1521, 2049, 2181, 2375, 2376, 2379,
  2380, 3306, 3389, 4222, 5432, 5601, 5672, 5900, 5984, 6379,
  6380, 6443, 7000, 7001, 7002, 8086, 8500, 8600, 9042, 9092,
  9200, 9300, 10250, 10255, 11211, 15672, 27017, 27018, 27019,
])

/** web 层历史别名：GuardOptions 与权威层 FetchGuardOptions 同形。 */
export type GuardOptions = typeof DEFAULT_GUARD

/** web 层沿用的返回形状（9 个调用方读 .response，保持不变）。 */
export interface GuardedFetchResult {
  response: Response
  finalUrl: string
}

/**
 * 兼容适配器：把权威层 guardedFetch 的结果包成 web 层既有形状。
 *
 * 为什么不直接把调用方改成读 `status/headers/bytes`：
 * 那是 9 个文件、多个路由的机械改动，与本轮"收口 SSRF 安全层"
 * 这个目标无关，却把回归面积放大 9 倍。适配器只多一层转发，
 * 安全性完全来自权威层，不存在第二套校验逻辑。
 */
export async function guardedFetch(
  rawUrl: string,
  options: Partial<GuardOptions> = {},
  init: RequestInit = {},
): Promise<GuardedFetchResult> {
  const result = await coreGuardedFetch(rawUrl, options, {
    method: init.method,
    headers: init.headers as Record<string, string> | undefined,
    body: typeof init.body === "string" ? init.body : undefined,
  })
  // 权威层 guardedFetch 返回 { body: string, status, contentType, ... }，
  // 这里还原成 Response 以维持 9 个调用方读 .response 的既有契约。
  const headers: Record<string, string> = {}
  if (result.contentType) headers["content-type"] = result.contentType
  const response = new Response(result.body, { status: result.status, headers })
  return { response, finalUrl: result.finalUrl }
}

export function isProbablySafeUrl(input: string): boolean {
  try {
    const u = new URL(input)
    // 权威层 assertUrlShape 接收字符串（内部自行 new URL），返回规范化后的 URL
    const normalized = assertUrlShape(input)
    u.hostname // 保留引用，避免 lint 判 u 未使用
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) !== 0 && isBlockedIp(host)) return false
    return true
  } catch {
    return false
  }
}

/**
 * 边读边计数地读取响应体，超过上限立即中断。
 *
 * 为什么不能只信 Content-Length：分块传输（chunked）可以完全不发这个头，
 * 或者发一个远小于实际体量的假值。只做头部校验等于给攻击者留了一条
 * 「让服务端把 2GB 读进内存」的路 —— 必须按实际字节数截断。
 */
export async function readBodyLimited(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body
  if (!body) return { bytes: new Uint8Array(0), truncated: false }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))))
        truncated = true
        break
      }
      chunks.push(value)
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => { /* 截断后取消底层流，网络已中断时忽略残留异常 */ })
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return { bytes: merged, truncated }
}

/** 同 readBodyLimited，但按 UTF-8 解码为文本（用于 HTML 元数据抽取） */
export async function readTextLimited(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const { bytes, truncated } = await readBodyLimited(response, maxBytes)
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), truncated }
}
