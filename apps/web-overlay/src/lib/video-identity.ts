/**
 * 视频的跨平台唯一标识。
 *
 * 为什么需要：三个采集入口原来都用「只有 bvid / videoId」的裸 ID 做去重：
 *
 *     const vid = item.videoConfig?.bvid || item.videoConfig?.videoId
 *     if (existingIds.has(vid)) continue
 *
 * 问题是不同平台的 ID 空间会撞车：YouTube 的 11 位 ID 与 B 站的 `BV…` 写法不同，
 * 但 `custom` 类型（webhook / 手工录入）完全可能填成同一个值；更糟的是
 * `video-multi-source-connector` 曾把非 B 站来源的 bvid 塞成硬编码的
 * `BV1whDefault`，于是所有 webhook 来源都被判成「同一条」。
 *
 * 约定：`<platform>:<externalId>`，例如 `bilibili:BV1xx411c7mD`、`youtube:dQw4w9WgXcQ`。
 * 任何需要「这条视频是不是已经在库里」的地方都必须用它，不要再各自拼。
 */

export interface VideoIdentitySource {
  type?: string
  bvid?: string
  videoId?: string
}

/** 返回 `platform:externalId`；缺少可用 ID 时返回 null（调用方据此跳过） */
export function videoExternalKey(config?: VideoIdentitySource | null): string | null {
  if (!config) return null
  const externalId = (config.bvid || config.videoId || '').trim()
  if (!externalId) return null
  const platform = (config.type || 'custom').trim() || 'custom'
  return `${platform}:${externalId}`
}

/** 从 `platform:externalId` 反解（供日志与报告使用） */
export function parseVideoExternalKey(key: string): { platform: string; externalId: string } | null {
  const idx = key.indexOf(':')
  if (idx <= 0 || idx === key.length - 1) return null
  return { platform: key.slice(0, idx), externalId: key.slice(idx + 1) }
}

/**
 * 判断一条 `VideoIdentitySource` 是否与给定 key 相同。
 * 用于「候选过滤」场景，避免调用方重复写 `videoExternalKey(x) === key`。
 */
export function matchesVideoKey(config: VideoIdentitySource | null | undefined, key: string): boolean {
  return videoExternalKey(config) === key
}
