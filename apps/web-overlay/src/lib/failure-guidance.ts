/**
 * 失败 toast 三类指导语模板（Phase 2 批 E K7；设计线 §4.3）。
 *
 * 规则：toast.error(发生了什么 + 下一步)，下一步三选一——
 * ①「请稍后重试」（临时失败）②「请检查网络后重试」（网络类）
 * ③「请重新登录后重试，仍失败请联系管理员」（权限类）/
 * 「请刷新页面确认最新状态，仍失败请联系管理员」（冲突/状态类）。
 * 服务端 err.message 只作为补充缀在后面，不做主文案；同一操作连续失败
 * 两次文案一致（不因服务端文案变化而漂移）。
 */
export function failureGuidance(err: unknown): string {
  const status = (err as { status?: number } | null)?.status
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (
    status === 401 ||
    status === 403 ||
    /未登录|登录已过期|登录失效|无权|unauthorized|forbidden/i.test(raw)
  ) {
    return '请重新登录后重试，仍失败请联系管理员。'
  }
  if (status === 409 || status === 422 || /冲突|已存在|重复/i.test(raw)) {
    return '请刷新页面确认最新状态，仍失败请联系管理员。'
  }
  if (status !== undefined && status >= 500) {
    return '服务器暂时不可用，请稍后重试。'
  }
  if (/failed to fetch|fetch failed|network|timeout|超时|网络|ECONN|离线|offline|502|503|504/i.test(raw)) {
    return '请检查网络后重试。'
  }
  return '请稍后重试。'
}

/** 失败 toast 的描述：指导语在前，服务端原始信息只做括号补充。 */
export function failureDescription(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const guide = failureGuidance(err)
  return raw ? `${guide}（${raw}）` : guide
}

/** 失败 toast 停留时长（K5：延到 8 秒以上）。 */
export const FAILURE_TOAST_DURATION_MS = 8000

/**
 * 失败 toast 的统一配置：指导语描述 + 8 秒停留 + 「重试」入口（K5）。
 * 重试回调由调用方传入（重跑同一操作）。
 */
export function failureToastOptions(
  err: unknown,
  onRetry: () => void,
): {
  description: string
  duration: number
  action: { label: string; onClick: () => void }
} {
  return {
    description: failureDescription(err),
    duration: FAILURE_TOAST_DURATION_MS,
    action: { label: '重试', onClick: onRetry },
  }
}
