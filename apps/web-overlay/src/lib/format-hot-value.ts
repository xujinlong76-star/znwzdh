/**
 * 热度数值展示（纯函数，客户端/服务端共用）。
 *
 * U-358：原在 `@/lib/server/brief`，与服务端取数（`lib/server/hub`，含内部凭据）
 * 同模块——客户端岛（今日中心简报条）直接 import 会把服务端取数层拖进首屏包。
 * 纯函数抽到这里，服务端页与客户端岛各自 import，行为逐字一致。
 */

/** 热度数值展示：12345 → 1.2万；源站没给数值时返回 null（不编造） */
export function formatHotValue(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')}万`
  return String(value)
}
