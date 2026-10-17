/**
 * 后台列表加载失败的说明文案。
 *
 * 真实缺陷（`app/admin/collections`、`categories`、`tags` 三页都中过）：
 *
 *     void hubGet<Row[]>('/api/collections?all=1')
 *       .then((data) => setCols(Array.isArray(data) ? data : []))
 *       .catch(() => setCols([]))          // ← 网络 / 401 / 500 失败 = 空列表
 *
 * 请求失败和「本来就没有数据」被合并成同一个状态，而页面渲染的是
 * 「暂无专题 / 暂无类目 / 暂无匹配标签」—— 管理员看到的是「我的数据没了」，
 * 实际只是这一次请求没成功。
 *
 * 所以这里提供三样东西：
 *   1. `describeLoadFailure`：按原因分类的下一步建议，并且**必须明说**
 *      「这里显示的是空列表，不代表数据被删了」；
 *   2. `emptyStateText`：失败时列表为空该显示什么（绝不能显示成「暂无数据」）；
 *   3. 纯字符串处理，规则可以钉进测试。
 */

/** 失败原因分类：决定「下一步该做什么」 */
export type LoadFailureKind = 'auth' | 'network' | 'server' | 'unknown'

/** 失败提示的共同落点：不写这句，用户会把「没拉到」当成「数据没了」 */
export const LOAD_FAILURE_EMPTY_HINT = '这里显示的是空列表，不代表数据被删了。'

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err === null || err === undefined) return ''
  try {
    return JSON.stringify(err)
  } catch {
    // 环形引用 / 不可序列化：退化成 String，宁可文案糙一点也别在报错路径上再抛一次
    return String(err)
  }
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = Number((err as { status?: unknown }).status)
    return Number.isFinite(status) ? status : null
  }
  return null
}

export function classifyLoadFailure(err: unknown): LoadFailureKind {
  const status = statusOf(err)
  if (status === 401 || status === 403) return 'auth'
  if (status !== null && status >= 500) return 'server'
  const text = messageOf(err)
  if (/401|403|unauthor|forbidden|未授权|登录|token/i.test(text)) return 'auth'
  if (/failed to fetch|networkerror|network error|timeout|timed out|econn|dns|offline|断网/i.test(text)) {
    return 'network'
  }
  if (/\b5\d\d\b|internal server|bad gateway|service unavailable/i.test(text)) return 'server'
  return 'unknown'
}

/**
 * 生成给用户看的失败说明。
 * @param what 加载的东西（用于拼句子，例如「专题列表」）
 */
export function describeLoadFailure(err: unknown, what: string): string {
  const detail = messageOf(err).trim()
  const base = `${what}没有加载出来${detail ? `（${detail}）` : ''}。`
  switch (classifyLoadFailure(err)) {
    case 'auth':
      return base + `登录状态可能已过期，重新登录后再点「重试」。${LOAD_FAILURE_EMPTY_HINT}`
    case 'network':
      return base + `看起来是网络或服务不可达，检查网络后点「重试」。${LOAD_FAILURE_EMPTY_HINT}`
    case 'server':
      return base + `服务端出错了（可以查一下服务日志），稍后再点「重试」。${LOAD_FAILURE_EMPTY_HINT}`
    default:
      return base + `点「重试」可以再拉一次。${LOAD_FAILURE_EMPTY_HINT}`
  }
}

/**
 * 列表为空时的文案：失败过就不能再说「暂无数据」。
 * @param loadError 上次失败的原因（null 表示没有失败）
 * @param emptyText 真的没有数据时该显示的话（例如「暂无专题」）
 */
export function emptyStateText(loadError: string | null, emptyText: string): string {
  return loadError ? '没能加载出来（见上方提示）' : emptyText
}
