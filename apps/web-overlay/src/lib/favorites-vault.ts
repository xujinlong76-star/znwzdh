/**
 * 收藏 ↔ E2EE 金库的纯转换（P1 抽出的可测逻辑）。
 *
 * 为什么单独成文件：这两个转换此前内联在 `favorites/page.tsx` 里，一个是导出时
 * 组装 `VaultItem[]`，一个是导入时把解密结果转回 `LocalFavorite`。它们是纯函数，
 * 却没有任何测试——而它们恰好是最容易出错的地方：
 *  - 导出的 `category` 映射到 `note`、`tags[0]` 映射到 `icon`，映射错了用户
 *    导出再导入就会发现备注变成了标签、图标变成了备注，而且**没有任何报错**；
 *  - 导入侧 `createdAt ?? Date.now()`：解密文件里没有时间戳时必须给个确定值，
 *    否则排序会抖。
 * 页面只保留「读文件 / 调加密 / 触发下载」这些必须碰 DOM 与异步的部分。
 */
import type { VaultItem } from '@/lib/vault'

/** 本地收藏的最小形状（与 hooks/useFavorites 的 LocalFavorite 对齐，避免循环依赖） */
export interface VaultMappableFavorite {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  createdAt: number
}

/** 收藏 → 金库条目 */
export function favoritesToVaultItems(items: VaultMappableFavorite[]): VaultItem[] {
  return items.map((f) => ({
    id: f.siteId,
    title: f.title,
    url: f.href,
    description: f.description,
    // 备注走 category：金库格式里它是"分组"语义，导入侧再映射回 note
    category: f.note,
    tags: f.icon ? [f.icon] : [],
    createdAt: f.createdAt,
  }))
}

/**
 * 解密文件里读出的条目：**不能假定字段齐全**。
 * 金库文件是用户手里的一份外部文件，可能被手改过、可能是旧版本、也可能是别的工具
 * 生成的——用 `VaultItem`（全必填）当入参类型会在编译期撒谎，运行时照样缺字段。
 * 因此这里显式声明"可能缺"，让缺字段成为类型系统里的一等公民。
 */
export type VaultFileEntry = Partial<VaultItem> & { id?: string; url?: string }

/** 金库条目 → 本地收藏（解密后的还原路径） */
export function vaultItemsToFavorites(items: readonly VaultFileEntry[], now: number): VaultMappableFavorite[] {
  const out: VaultMappableFavorite[] = []
  for (const item of items) {
    // 站点地址是渲染与跳转的唯一依据：没有它这条记录无法使用，宁可丢掉也不留残行
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.url !== 'string' || !item.url) continue
    out.push({
      siteId: item.id,
      title: item.title || item.id,
      href: item.url,
      description: item.description,
      note: item.category,
      icon: item.tags?.[0],
      createdAt: typeof item.createdAt === 'number' && item.createdAt > 0 ? item.createdAt : now,
    })
  }
  return out
}

/** 导出文件名：按天归档，同一天多次导出会互相覆盖（浏览器下载行为，符合预期） */
export function vaultExportFilename(now: number): string {
  const day = new Date(now).toISOString().slice(0, 10)
  return `navhub-vault-${day}.navhub.vault`
}

/** 与收藏页 syncStatus 的三态一致：信息（部分完成）不能借用绿色或红色 */
export type VaultRestoreTone = 'success' | 'info' | 'error'

export interface VaultRestoreCounts {
  /** 解密出来的原始条数（外部文件可能夹带残行） */
  decryptedCount: number
  /** 转换后可用于渲染的条数（缺 id/url 的条目在这一步出局） */
  convertibleCount: number
  /** 实际并入本地收藏的条数（importJson 返回的 imported） */
  restoredCount: number
}

/**
 * 金库还原的结案陈词。
 *
 * 措辞铁律：成功文案只能报「真正并入的条数」。此前这里报的是解密条数——
 * 一个缺 url 的残行会让「已恢复 N 条」比实际多，而界面上没有任何地方提到它。
 * 两个缺口分开点名：缺站点标识/链接（转换阶段出局）与格式不完整（合并阶段出局），
 * 修法不同，不能合并成一句「部分失败」。
 */
export function formatVaultRestoreNotice(counts: VaultRestoreCounts): {
  text: string
  tone: VaultRestoreTone
} {
  const unusable = Math.max(0, counts.decryptedCount - counts.convertibleCount)
  const rejected = Math.max(0, counts.convertibleCount - counts.restoredCount)
  const gaps: string[] = []
  if (unusable > 0) gaps.push(`${unusable} 条缺少站点标识或链接`)
  if (rejected > 0) gaps.push(`${rejected} 条格式不完整`)

  if (counts.decryptedCount === 0) {
    return { text: '金库解密成功，但文件里没有收藏条目', tone: 'info' }
  }
  if (counts.restoredCount === 0) {
    // 一条都没进去就不是「部分成功」：绿色横幅会把失败说成完成
    return {
      text: `金库解密成功，但${gaps.length ? gaps.join('、') : '所有条目都未通过合并校验'}，没有可恢复的收藏`,
      tone: 'error',
    }
  }
  if (gaps.length === 0) {
    return { text: `🔓 零知识金库解密成功！已恢复 ${counts.restoredCount} 条私密收藏`, tone: 'success' }
  }
  return {
    text: `🔓 金库解密成功：已恢复 ${counts.restoredCount} 条私密收藏；另有 ${gaps.join('、')}，未能恢复`,
    tone: 'info',
  }
}
