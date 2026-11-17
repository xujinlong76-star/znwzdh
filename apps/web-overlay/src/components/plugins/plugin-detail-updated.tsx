import { formatPackDate } from '@/lib/link-pack'

/**
 * P3-4：插件详情头展示运行时 updatedAt（“更新于 YYYY-MM-DD”）。
 *
 * 日期格式复用仓内已有 helper formatPackDate（本地日期，与链接包快照
 * 「发布于某日」同款），不另起 toLocaleDateString。
 * updatedAt 缺失/非法时不渲染——HubPluginItem.updatedAt 理论上必填，
 * 但运行时数据不可信时宁可不显示也不显示错误日期。
 */
export function PluginDetailUpdated({ updatedAt }: { updatedAt?: number | null }) {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  return <span className="text-xs text-muted-foreground">更新于 {formatPackDate(updatedAt)}</span>
}
