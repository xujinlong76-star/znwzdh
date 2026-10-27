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
