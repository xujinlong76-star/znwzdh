/**
 * 视频链路的结构化日志。
 *
 * 此前全链路只有 `console.warn('xxx', err)`：采集失败时无法回答
 * 「是哪个源、哪个阶段、耗时多少」——本轮排查 CI 时最缺的就是这个。
 *
 * 约定：一行一个 JSON（ndjson），字段固定为
 *   `{ scope: 'video', stage, level, at, ...fields }`
 * 这样既能被人直接读，也能被日志采集端按 `stage` 聚合。
 * 不引入日志库：这个模块要能在 Edge/Node 两种 runtime 里跑，且保持零依赖。
 */

export type VideoLogStage = 'fetch' | 'score' | 'dedupe' | 'persist' | 'probe' | 'rollback'

export interface VideoLogFields {
  /** 视频/条目的外部标识（bvid / videoId / siteId） */
  id?: string
  /** 数据来源（bilibili / youtube / webhook / manual） */
  source?: string
  /** 阶段耗时（毫秒） */
  durationMs?: number
  /** 本次处理的条目数 */
  count?: number
  /** 其它附加上下文（错误信息放 message） */
  [key: string]: unknown
}

export function videoLog(
  stage: VideoLogStage,
  fields: VideoLogFields = {},
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const line = JSON.stringify({
    scope: 'video',
    stage,
    level,
    at: new Date().toISOString(),
    ...fields,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** 计时器：`const done = startVideoTimer('fetch', { id }); ... done({ count: 3 })` */
export function startVideoTimer(stage: VideoLogStage, fields: VideoLogFields = {}) {
  const startedAt = Date.now()
  return (extra: VideoLogFields = {}, level: 'info' | 'warn' | 'error' = 'info') =>
    videoLog(stage, { ...fields, ...extra, durationMs: Date.now() - startedAt }, level)
}
