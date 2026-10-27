/**
 * 中枢取数的 Data Cache 标签：取数侧打标，写侧按标签失效。
 *
 * 为什么只有一个粗粒度标签：中枢的写操作（收藏、投稿、审核、插件安装、恢复…）
 * 与各读面之间的影响关系不是一份能长期维护的映射——一次审核会同时改变公开列表、
 * 详情页、站点计数与 sitemap。粗粒度失效的代价是写后的第一次读要回源一次；
 * 细粒度标签的代价是漏失效（页面在 revalidate 窗口内继续展示旧数据，且很难发现）。
 * 先选「不会漏」，等有实测的命中率数据再拆细。
 *
 * 只作用于 `revalidate > 0` 的取数：admin 系列与实时读本来就不进 Data Cache，
 * 给它们打标签没有意义。
 */
export const HUB_CACHE_TAG = 'navhub-hub'

/**
 * 写请求成功后是否该失效中枢取数缓存。
 *
 * 只有两条规则：
 *  - 方法不是 GET/HEAD（读请求不改变缓存状态）
 *  - 状态码是 2xx（失败不失效：中枢抖动时清空缓存，会让下一次访问直面一个不健康的上游）
 *
 * 说明：fetch 默认跟随重定向，成功的写请求最终状态是 2xx；3xx 只在
 * `redirect: 'manual'` 下出现，本代理不用那种模式。
 */
export function shouldInvalidateAfter(method: string, status: number): boolean {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return false
  return status >= 200 && status < 300
}
