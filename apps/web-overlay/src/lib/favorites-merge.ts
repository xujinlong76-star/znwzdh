/**
 * 登录后的收藏合并：**以云端成员集合为准**。
 *
 * 背景（真实缺陷）：页面原先把云端列表并集导入本地，下一次进入又先把本地全量推回云端。
 * 于是「在另一台设备删掉的收藏」会在本机再次被推回，删除永远无法传播。
 * 这里把云端当事实源：只保留云端仍存在的条目；本地仅补齐图标等展示字段。
 *
 * 注意 folderId / note 必须严格采用云端值：云端 null 表示用户主动移出文件夹/清空备注，
 * 用 `??` 回退到本地会把已清除的字段重新变回来。
 */
export interface CloudFavoriteSiteLike {
  title: string
  url: string
  /** 中枢契约里 description 是可选的（可能整块缺席），合并时按「无描述」处理 */
  description?: string | null
}

export interface CloudFavoriteLike {
  siteId: string
  folderId: string | null
  note: string | null
  /** 标签（T22）：云端权威；null = 已清除（与 note 同语义） */
  tags?: string[] | null
  createdAt: number
  site: CloudFavoriteSiteLike | null
}

export interface LocalFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
  createdAt: number
}

export function mergeCloudFavorites<T extends LocalFavoriteLike>(
  local: T[],
  cloud: CloudFavoriteLike[],
): T[] {
  const localById = new Map(local.map((item) => [item.siteId, item]))
  const merged: T[] = []
  for (const remote of cloud) {
    const cached = localById.get(remote.siteId)
    const href = remote.site?.url ?? cached?.href ?? ''
    // 站点已被硬删除且本地也没有展示信息：无法渲染，直接跳过
    if (!href) continue
    merged.push({
      ...(cached ?? {}),
      siteId: remote.siteId,
      title: remote.site?.title ?? cached?.title ?? remote.siteId,
      href,
      // 云端不返回图标：本地缓存有就保留
      icon: cached?.icon,
      description: remote.site?.description ?? cached?.description,
      // 云端权威字段：null 就是「已清除」，不能回退本地
      note: remote.note ?? undefined,
      tags: remote.tags ?? undefined,
      folderId: remote.folderId,
      createdAt: remote.createdAt || cached?.createdAt || Date.now(),
    } as T)
  }
  return merged
}
