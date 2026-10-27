/**
 * 写入冲突判定（纯函数，零依赖）。
 *
 * 单独成文件的原因：`video-library-store` 会 import `./github`，而后者经
 * `@/lib/auth` 拉进 `next-auth`，在 vitest 下解析失败（next-auth 的
 * `next/server` 子路径问题）。判定逻辑本身不需要任何 IO，抽出来才能被测。
 */

/** 版本冲突判定：优先看 StorageError.status，其次看文案（不同适配器文案不一） */
export function isVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  if (status === 409) return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /(^|\D)409(\D|$)|version conflict|版本冲突/i.test(message)
}
