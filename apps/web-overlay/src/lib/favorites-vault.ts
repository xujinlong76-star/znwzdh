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
  /** 真实标签（T22，≤8 个、各 ≤24 字符）：v2 起进金库的 tags，不再被图标借用 */
  tags?: string[]
  /** 收藏夹名（U-413 金库 v2）：v2 起进金库的 folderName，导入时按名找回/新建 */
  folderName?: string
  createdAt: number
  /** 参数化快捷链接（v1 本地 only）：金库是显式白名单组装，两字段随金库走 */
  quickPrefix?: string
  templateUrl?: string
}

/**
 * 收藏 → 金库条目（v2，U-413）。
 *
 * v1 的映射错在两处，且没有任何报错：备注走 category（分组语义被借用）、
 * 图标走 tags[0]（真实标签无处可放）。v2 起四者各归其位——
 * note → category、icon → icon、tags → tags、folderName → folderName，
 * 并逐条写 formatVersion: 2，让导入侧能区分 v1 旧文件。
 */
export function favoritesToVaultItems(items: VaultMappableFavorite[]): VaultItem[] {
  return items.map((f) => ({
    id: f.siteId,
    title: f.title,
    url: f.href,
    description: f.description,
    // 备注走 category：金库格式里它是"分组"语义，导入侧再映射回 note
    category: f.note,
    // v2：真实标签进 tags，图标进 icon——v1 把图标塞进 tags[0] 致使标签全丢
    tags: f.tags ? [...f.tags] : [],
    icon: f.icon,
    folderName: f.folderName,
    formatVersion: 2,
    createdAt: f.createdAt,
    quickPrefix: f.quickPrefix,
    templateUrl: f.templateUrl,
  }))
}

/**
 * 解密文件里读出的条目：**不能假定字段齐全**。
 * 金库文件是用户手里的一份外部文件，可能被手改过、可能是旧版本、也可能是别的工具
 * 生成的——用 `VaultItem`（全必填）当入参类型会在编译期撒谎，运行时照样缺字段。
 * 因此这里显式声明"可能缺"，让缺字段成为类型系统里的一等公民。
 */
export type VaultFileEntry = Partial<VaultItem> & { id?: string; url?: string }

/** 金库条目 → 本地收藏（解密后的还原路径）
 *
 * v2（formatVersion === 2）：icon/tags/folderName 各归其位。
 * v1（缺 formatVersion 的旧文件）：tags[0] 是图标、category 是备注、
 * 没有文件夹与真实标签——按旧口径回退，旧文件仍能导入（U-413）。
 */
export function vaultItemsToFavorites(items: readonly VaultFileEntry[], now: number): VaultMappableFavorite[] {
  const out: VaultMappableFavorite[] = []
  for (const item of items) {
    // 站点地址是渲染与跳转的唯一依据：没有它这条记录无法使用，宁可丢掉也不留残行
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.url !== 'string' || !item.url) continue
    const isV2 = item.formatVersion === 2
    out.push({
      siteId: item.id,
      title: item.title || item.id,
      href: item.url,
      description: item.description,
      note: item.category,
      // v2：图标走 icon 字段、标签走 tags；v1：图标借存在 tags[0]，没有真实标签
      icon: isV2 ? item.icon : item.tags?.[0],
      tags: isV2 ? item.tags : undefined,
      folderName: isV2 ? item.folderName : undefined,
      createdAt: typeof item.createdAt === 'number' && item.createdAt > 0 ? item.createdAt : now,
      // 快捷链接随金库走：合法性由读取侧 quicklinkFromFavorite / importJson
      // 再验，这里只做透传，不静默丢字段
      quickPrefix: item.quickPrefix,
      templateUrl: item.templateUrl,
    })
  }
  return out
}

/** 导出文件名：按天归档，同一天多次导出会互相覆盖（浏览器下载行为，符合预期） */
export function vaultExportFilename(now: number): string {
  const day = new Date(now).toISOString().slice(0, 10)
  return `navhub-vault-${day}.navhub.vault`
}

/**
 * 金库主密码强度（导出表单的即时反馈，纯函数、可测）。
 *
 * 计分（0–4 分，上限 4）：
 * - 长度 ≥ 8 位：+1；长度 ≥ 12 位：再 +1
 * - 大小写混合：+1；含数字：+1；含符号：+1
 * 标签：0 分「未输入」（空串专用）、1 分「弱」、2 分「一般」、3 分「良好」、4 分「很强」。
 * 注意：强度条只是建议，不拦截导出——导出底线仍是页面里的 6 位校验。
 */
export interface VaultPasswordStrength {
  score: number
  label: string
}

export function getVaultPasswordStrength(password: string): VaultPasswordStrength {
  if (!password) return { score: 0, label: '未输入' }
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  const clamped = Math.min(4, score)
  const label = clamped <= 1 ? '弱' : clamped === 2 ? '一般' : clamped === 3 ? '良好' : '很强'
  return { score: clamped, label }
}

/**
 * 金库里带快捷模板的条数（导出前提醒的 M，纯函数、可测）。
 *
 * 判定口径与 hooks/useFavorites 一致：templateUrl 存在当且仅当是快捷链接
 * （quickPrefix 单独存在不算——两字段总是一起写盘，templateUrl 是唯一判定）。
 */
export function countVaultQuicklinks(
  items: ReadonlyArray<{ quickPrefix?: string | null; templateUrl?: string | null }>,
): number {
  return items.filter((item) => Boolean(item.templateUrl)).length
}

/** 与收藏页 syncStatus 的三态一致：信息（部分完成）不能借用绿色或红色 */
export type VaultRestoreTone = 'success' | 'info' | 'error'

export interface VaultRestoreCounts {
  /** 解密出来的原始条数（外部文件可能夹带残行） */
  decryptedCount: number
  /** 转换后可用于渲染的条数（缺 id/url 的条目在这一步出局） */
  convertibleCount: number
  /** 实际并入本地收藏的条数（importJson 返回的 imported + updated：更新已存条目
   *  也是已恢复的内容，只报 imported 会把“恢复一份本地已有的金库”说成失败） */
  restoredCount: number
  /** 已在收藏夹、无需恢复的条数（importJson 返回的 alreadyExisted）：不是失败，
   *  必须单独点名，不能算进“格式不完整” */
  alreadyExisted?: number
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
  const alreadyExisted = counts.alreadyExisted ?? 0
  const unusable = Math.max(0, counts.decryptedCount - counts.convertibleCount)
  // 已存在的不算“被拒绝”：restoredCount 已含 updated，剩下没进去的
  // 只有真正格式不完整的条目
  const rejected = Math.max(0, counts.convertibleCount - counts.restoredCount - alreadyExisted)
  const failures: string[] = []
  if (unusable > 0) failures.push(`${unusable} 条缺少站点标识或链接`)
  if (rejected > 0) failures.push(`${rejected} 条格式不完整`)

  if (counts.decryptedCount === 0) {
    return { text: '金库解密成功，但文件里没有收藏条目', tone: 'info' }
  }
  if (counts.restoredCount === 0 && alreadyExisted === 0) {
    // 一条都没进去、也没有已存在的，就不是「部分成功」：绿色横幅会把失败说成完成
    return {
      text: `金库解密成功，但${failures.length ? failures.join('、') : '所有条目都未通过合并校验'}，没有可恢复的收藏`,
      tone: 'error',
    }
  }
  if (counts.restoredCount === 0) {
    // 全是已存在：恢复了一份本地已有的金库，本就无需恢复，不是失败
    return {
      text: `金库解密成功：${alreadyExisted} 条均已存在，无需恢复${failures.length ? `；另有 ${failures.join('、')}，未能恢复` : ''}`,
      tone: 'info',
    }
  }
  if (failures.length === 0 && alreadyExisted === 0) {
    return { text: `🔓 零知识金库解密成功！已恢复 ${counts.restoredCount} 条私密收藏`, tone: 'success' }
  }
  let text = `🔓 零知识金库解密成功！已恢复 ${counts.restoredCount} 条私密收藏`
  if (alreadyExisted > 0) text += `；${alreadyExisted} 条已存在，无需恢复`
  if (failures.length > 0) text += `；另有 ${failures.join('、')}，未能恢复`
  return { text, tone: 'info' }
}
