/**
 * 写入冲突与缩水判据判定（纯函数，零依赖）。
 *
 * 单独成文件的原因：`video-library-store` 会 import `./github`，而后者经
 * `@/lib/auth` 拉进 `next-auth`，在 vitest 下解析失败（next-auth 的
 * `next/server` 子路径问题）。判定逻辑本身不需要任何 IO，抽出来才能被测。
 */

/**
 * 中枢缩水保护的三种拦截码（与 `apps/api/src/storage.ts` 的 VideoShrinkBlockCode 一致）。
 *
 * 必须在「版本冲突」之前认出来：两者都是 409，但含义相反 ——
 * 版本冲突是「有人比我快，重放一次」，缩水拦截是「这份内容本身要人确认」，
 * 拿后者去重放只会连撞三次，最后还给用户一句误导性的「请刷新重试」。
 * 导出是为了让 parity 守卫能把它和中枢的联合类型逐字比对。
 */
export const SHRINK_BLOCK_CODES = [
  'video_shrink_requires_confirmation',
  'video_shrink_expected_count_required',
  'video_shrink_expected_count_mismatch',
] as const

/** 中枢的错误响应体被适配器拼进 message（前 300 字符），所以这里按码子串判定 */
export function isVideoShrinkBlock(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && SHRINK_BLOCK_CODES.some((code) => message.includes(code))
}

/**
 * 缩水判据的两个数字：`apps/api/src/storage.ts` 的 VIDEO_SHRINK_MIN_BASELINE /
 * VIDEO_SHRINK_KEEP_RATIO 的同值副本（100 基线 / 保留 80%）。
 *
 * 为什么是副本而不是 import：Web 生产镜像只含 overlay，前端跨包引用中枢会构建失败
 * （同 lib/health-state.ts 的取舍）。不可接受的是两份悄悄分叉——本地守卫先按 90% 拦、
 * 中枢按 80% 放行，用户看到的就是「明明确认过了还是 409」。
 * 逐字对照由 test/video-shrink-parity.test.ts 守着，改这里必须同时改中枢。
 */
export const VIDEO_SHRINK_MIN_BASELINE = 100
export const VIDEO_SHRINK_KEEP_RATIO = 0.8

/** 一次疑似缩水的覆盖写：三个数字是给操作者做判断用的，缺一不可 */
export interface VideoShrinkVerdict {
  existingCount: number
  incomingCount: number
  minimumAllowed: number
}

/** 与中枢 evaluateVideoShrink 同判据的纯函数（同输入必须同结论） */
export function evaluateVideoShrink(
  existingCount: number,
  incomingCount: number,
): VideoShrinkVerdict | null {
  if (existingCount < VIDEO_SHRINK_MIN_BASELINE) return null
  if (incomingCount >= existingCount * VIDEO_SHRINK_KEEP_RATIO) return null
  return {
    existingCount,
    incomingCount,
    minimumAllowed: Math.ceil(existingCount * VIDEO_SHRINK_KEEP_RATIO),
  }
}

/** 版本冲突判定：优先看 StorageError.status，其次看文案（不同适配器文案不一） */
export function isVersionConflict(error: unknown): boolean {
  if (isVideoShrinkBlock(error)) return false
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  if (status === 409) return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /(^|\D)409(\D|$)|version conflict|版本冲突/i.test(message)
}
