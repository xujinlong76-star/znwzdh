/**
 * 安全随机数（CodeQL #132 不安全的随机性修复）。
 *
 * 背景：`quick-tools-drawer.tsx` 的 UUID 回退分支曾用 `Math.random()`
 *（V8 xorshift128+，状态可观测、可预测）生成 UUID v4 的全部随机位——
 * 攻击者拿到几个已生成的 UUID 就能推算 PRNG 状态、预测后续 UUID。
 * 本文件统一用浏览器标准 Web Crypto API，且永不回退到 `Math.random()`。
 */

/** 可注入的最小 Crypto 接口（便于测试覆盖回退分支）。 */
export interface SecureRandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T
  randomUUID?: () => string
}

function defaultCrypto(): SecureRandomSource {
  if (typeof globalThis === "undefined" || typeof globalThis.crypto === "undefined") {
    throw new Error("当前环境不支持 Web Crypto 安全随机数，无法生成随机值")
  }
  return globalThis.crypto as SecureRandomSource
}

/**
 * 安全随机整数 [0, max)：拒绝采样（rejection sampling），消除取模偏差。
 *
 * 原理：只接受落在 [0, floor(256/max)*max) 内的字节再取模——被拒绝的尾巴
 * 正是会造成偏差的那部分。取 0–15 时 256 可被 16 整除、limit=256，零拒绝、零开销。
 */
export function secureRandomInt(max: number, source: SecureRandomSource = defaultCrypto()): number {
  if (!Number.isInteger(max) || max <= 0 || max > 256) {
    throw new RangeError(`secureRandomInt 的 max 须为 1–256 的整数，收到 ${max}`)
  }
  const buf = new Uint8Array(1)
  const limit = Math.floor(256 / max) * max
  let v: number
  do {
    source.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % max
}

/**
 * UUID v4：优先 `crypto.randomUUID()`；无 `randomUUID` 时用 `getRandomValues`
 * + 拒绝采样回退；`crypto` 完全不可用时抛错——绝不静默降级到 `Math.random()`。
 */
export function generateSecureUuid(source: SecureRandomSource = defaultCrypto()): string {
  if (typeof source.randomUUID === "function") {
    return source.randomUUID()
  }
  if (typeof source.getRandomValues !== "function") {
    throw new Error("当前环境不支持 Web Crypto 安全随机数，无法生成 UUID")
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    // x 位：0–15 均匀；y 位：8–11 均匀（变体位 10xx）
    const v = c === "x" ? secureRandomInt(16, source) : secureRandomInt(4, source) + 8
    return v.toString(16)
  })
}
