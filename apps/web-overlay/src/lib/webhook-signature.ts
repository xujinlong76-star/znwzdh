/**
 * Webhook 签名校验（真 HMAC-SHA256）。
 *
 * 为什么单独成文件：
 *   原实现（`video-multi-source-connector.ts` 里的 `verifyWebhookSignature`）声称是
 *   HMAC-SHA256，实际是 32 位滚动哈希 + `includes()` 子串匹配，且允许把密钥本身当签名。
 *   那套实现同时被单测复刻成「契约」（`video-evolution-v10.test.ts`），所以修复必须
 *   把「算法」抽出来，让实现与测试引用同一个函数，避免下次再各写一份。
 *
 * 三条不可回退的约定：
 *   1. **fail-closed**：签名头缺失、格式不对、密钥缺失，一律 false；
 *   2. **定长比较**：签名必须是 64 位 hex，用 `timingSafeEqual` 比较，禁止子串匹配；
 *   3. **原始 body**：调用方必须传 `await request.text()` 的原文，不能传
 *      `JSON.stringify(parsed)` —— 键序/空格一变签名就对不上。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PREFIX = 'sha256='
const HEX_64 = /^[0-9a-f]{64}$/i

/** 计算签名（供发送方与测试使用；服务端只做校验） */
export function signHmacSha256(rawBody: string, secret: string): string {
  return SIGNATURE_PREFIX + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/**
 * 校验签名。
 *
 * @param rawBody 请求原始 body 文本
 * @param header  签名头（`X-Hub-Signature-256` / `X-Webhook-Signature`），可带 `sha256=` 前缀
 * @param secret  共享密钥
 */
export function verifyHmacSha256(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!rawBody || !header || !secret) return false

  const provided = header.startsWith(SIGNATURE_PREFIX)
    ? header.slice(SIGNATURE_PREFIX.length).trim()
    : header.trim()

  // 定长 64 hex：长度不符直接拒，彻底堵掉「8 位子串命中即通过」的老漏洞
  if (!HEX_64.test(provided)) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(provided.toLowerCase(), 'hex')
  const b = Buffer.from(expected, 'hex')
  // 长度已由正则保证一致；timingSafeEqual 仍需等长入参
  return a.length === b.length && timingSafeEqual(a, b)
}
/** 时间戳容差：默认 ±300s（5 分钟），与项目内 identity-signature 的窗口一致 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300

/**
 * 计算「带时间戳」的签名（v2）：签名载荷 = `${ts}.${rawBody}`。
 *
 * 为什么要时间戳（2026-11-06 深扫 P2-11）：
 *   旧签名只覆盖 rawBody，抓到一个合法请求就能**无限重放** —— 对采集类 webhook
 *   而言，重放等于让对方免费把同一批数据反复写库。加 ts 后服务端校验时间窗口，
 *   配合调用方的去重缓存（nonceCache）即可杜绝重放。
 */
export function signHmacSha256WithTimestamp(rawBody: string, secret: string, tsSeconds: number): string {
  const payload = String(Math.floor(tsSeconds)) + "." + rawBody
  return SIGNATURE_PREFIX + createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/**
 * 校验带时间戳的签名（v2）。失败原因通过 `reason` 返回，便于审计与排障。
 *
 * @param rawBody  请求原始 body 文本
 * @param header   签名头（可带 `sha256=` 前缀）
 * @param secret   共享密钥
 * @param tsHeader 时间戳头（秒级 Unix 时间戳），如 `X-Webhook-Timestamp`
 * @param nowMs    当前时间（可注入，便于测试）
 * @param toleranceSec 容差秒数，默认 300
 */
export function verifyHmacSha256WithTimestamp(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  tsHeader: string | null | undefined,
  nowMs: number = Date.now(),
  toleranceSec: number = WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
): { ok: boolean; reason?: 'missing' | 'malformed' | 'bad_signature' | 'stale' | 'future' } {
  if (!rawBody || !header || !secret) return { ok: false, reason: 'missing' }
  const tsRaw = (tsHeader ?? '').trim()
  if (!/^\d{9,12}$/.test(tsRaw)) return { ok: false, reason: 'malformed' }
  const ts = Number(tsRaw)
  const nowSec = Math.floor(nowMs / 1000)
  const tol = Math.max(1, Math.floor(toleranceSec))
  if (ts < nowSec - tol) return { ok: false, reason: 'stale' }
  if (ts > nowSec + tol) return { ok: false, reason: 'future' }

  const provided = header.startsWith(SIGNATURE_PREFIX)
    ? header.slice(SIGNATURE_PREFIX.length).trim()
    : header.trim()
  if (!HEX_64.test(provided)) return { ok: false, reason: 'malformed' }

  const expected = createHmac('sha256', secret)
    .update(tsRaw + "." + rawBody, 'utf8')
    .digest('hex')
  const a = Buffer.from(provided.toLowerCase(), 'hex')
  const b = Buffer.from(expected, 'hex')
  const ok = a.length === b.length && timingSafeEqual(a, b)
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

/**
 * 重放去重（进程内 TTL 缓存）。
 *
 * 多副本部署时进程内缓存只能挡各自收到的重放；跨副本的严格去重要靠共享存储，
 * 属独立立项（见 ADR-0001 的多实例语义）。但**单副本 + 时间窗口**已能把重放
 * 从「无限次」压到「窗口内每副本一次」，是零依赖的净收益。
 */
export function createReplayGuard(ttlMs = WEBHOOK_TIMESTAMP_TOLERANCE_SEC * 2 * 1000) {
  const seen = new Map<string, number>()
  return {
    /** 首次见到返回 true（放行），重复返回 false（拒），过期自动回收 */
    check(key: string, nowMs: number = Date.now()): boolean {
      for (const [k, exp] of seen) if (exp <= nowMs) seen.delete(k)
      const exp = seen.get(key)
      if (exp !== undefined && exp > nowMs) return false
      seen.set(key, nowMs + ttlMs)
      return true
    },
    get size(): number { return seen.size },
  }
}

