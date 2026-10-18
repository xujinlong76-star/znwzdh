import type { PluginUpgradeDiff } from '@/lib/navhub-api'

/**
 * 版本升级变动明细视图（已安装版本 → 市场最新版本）。
 *
 * 服务端 upgradeDiff 到位前（undefined/null）展示空态说明；到位后按
 * 「新增 / 移除 / 调整」分组渲染条目。数据缺失绝不阻塞详情页渲染。
 */
export function PluginDiffView({ diff }: { diff?: PluginUpgradeDiff | null }) {
  if (!diff) {
    return (
      <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border/70 p-4">
        当前没有可对比的版本差异，或您尚未安装历史版本。
      </p>
    )
  }

  const groups: Array<{ key: string; label: string; tone: string; items?: string[] }> = [
    { key: 'added', label: '新增', tone: 'text-emerald-600 dark:text-emerald-400', items: diff.added },
    { key: 'removed', label: '移除', tone: 'text-destructive', items: diff.removed },
    { key: 'changed', label: '调整', tone: 'text-amber-600 dark:text-amber-400', items: diff.changed },
  ]

  const hasAny = groups.some((g) => g.items && g.items.length > 0)
  if (!hasAny) {
    return (
      <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border/70 p-4">
        两个版本的内容一致，没有需要对比的差异。
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((g) =>
        g.items && g.items.length > 0 ? (
          <div key={g.key} className="space-y-1.5">
            <div className={`text-xs font-medium ${g.tone}`}>
              {g.label}（{g.items.length}）
            </div>
            <ul className="space-y-1">
              {g.items.map((item) => (
                <li key={item} className="text-xs text-muted-foreground font-mono break-all">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  )
}
