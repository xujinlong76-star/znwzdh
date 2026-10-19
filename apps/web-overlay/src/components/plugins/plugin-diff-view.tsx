import type { PluginUpgradeDiff } from '@/lib/navhub-api'

/**
 * 版本升级变动明细视图（已安装版本 → 市场最新版本）。
 *
 * 服务端 upgradeDiff 即核心 diffPluginManifests 的 PluginDiffResult：
 * 按插件类型汇总计数与名称清单（站点 / 看板 / 主题变量 / 搜索引擎 / 组合成员）。
 * 服务端数据缺失（undefined/null）时展示空态说明，绝不阻塞详情页渲染。
 */
export function PluginDiffView({ diff }: { diff?: PluginUpgradeDiff | null }) {
  if (!diff) {
    return (
      <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border/70 p-4">
        当前没有可对比的版本差异，或您尚未安装历史版本。
      </p>
    )
  }

  const toneAdded = 'text-emerald-600 dark:text-emerald-400'
  const toneRemoved = 'text-destructive'
  const toneChanged = 'text-amber-600 dark:text-amber-400'

  const groups: Array<{ key: string; label: string; tone: string; items: string[] }> = []
  const push = (key: string, label: string, tone: string, items: string[]) => {
    if (items.length > 0) groups.push({ key, label, tone, items })
  }

  if (diff.nameChanged) {
    push('name', '名称', toneChanged, [`${diff.oldName ?? '（旧名称）'} → ${diff.newName ?? '（新名称）'}`])
  }
  if (diff.descriptionChanged) {
    push('description', '描述', toneChanged, ['描述已更新'])
  }

  if (diff.kind === 'site-pack') {
    const siteChanges = diff.siteChanges ?? []
    push(
      'sites-added',
      '新增站点',
      toneAdded,
      siteChanges.filter((s) => s.status === 'added').map((s) => s.title || s.url),
    )
    push(
      'sites-removed',
      '移除站点',
      toneRemoved,
      siteChanges.filter((s) => s.status === 'removed').map((s) => s.title || s.url),
    )
    push(
      'sites-modified',
      '调整站点',
      toneChanged,
      siteChanges
        .filter((s) => s.status === 'modified')
        .map(
          (s) =>
            `${s.title || s.url}（${s.changes && s.changes.length > 0 ? s.changes.join('、') : '字段更新'}）`,
        ),
    )
    if (siteChanges.length === 0) {
      // 服务端未携带逐一明细时退回计数摘要
      const summary: string[] = []
      if (diff.sitesAddedCount > 0) summary.push(`新增 ${diff.sitesAddedCount} 个`)
      if (diff.sitesRemovedCount > 0) summary.push(`移除 ${diff.sitesRemovedCount} 个`)
      if (diff.sitesModifiedCount > 0) summary.push(`调整 ${diff.sitesModifiedCount} 个`)
      push('sites-summary', '站点变更', toneChanged, summary)
    }
    push('categories', '新增分类', toneAdded, diff.categoriesAdded)
  } else if (diff.kind === 'workspace-preset') {
    push('boards-added', '新增看板', toneAdded, diff.boardsAdded)
    push('boards-removed', '移除看板', toneRemoved, diff.boardsRemoved)
    push('widgets-added', '新增组件', toneAdded, diff.widgetsAddedCount > 0 ? [`${diff.widgetsAddedCount} 个`] : [])
    push('widgets-removed', '移除组件', toneRemoved, diff.widgetsRemovedCount > 0 ? [`${diff.widgetsRemovedCount} 个`] : [])
  } else if (diff.kind === 'theme') {
    if (diff.accentChanged) {
      push('accent', '主色调', toneChanged, [`${diff.oldAccent ?? '默认'} → ${diff.newAccent ?? '默认'}`])
    }
    const tokenChanges = diff.tokenChanges ?? []
    push(
      'tokens-added',
      '新增变量',
      toneAdded,
      tokenChanges.filter((t) => t.status === 'added').map((t) => `${t.token}: ${t.newValue ?? ''}`),
    )
    push(
      'tokens-modified',
      '调整变量',
      toneChanged,
      tokenChanges
        .filter((t) => t.status === 'modified')
        .map((t) => `${t.token}: ${t.oldValue ?? ''} → ${t.newValue ?? ''}`),
    )
    push(
      'tokens-removed',
      '移除变量',
      toneRemoved,
      tokenChanges.filter((t) => t.status === 'removed').map((t) => `${t.token}: ${t.oldValue ?? ''}`),
    )
    if (tokenChanges.length === 0) {
      const summary: string[] = []
      if (diff.tokensAddedCount > 0) summary.push(`新增 ${diff.tokensAddedCount} 个`)
      if (diff.tokensModifiedCount > 0) summary.push(`调整 ${diff.tokensModifiedCount} 个`)
      if (diff.tokensRemovedCount > 0) summary.push(`移除 ${diff.tokensRemovedCount} 个`)
      push('tokens-summary', '主题变量', toneChanged, summary)
    }
  } else if (diff.kind === 'search-pack') {
    push('engines-added', '新增搜索引擎', toneAdded, diff.enginesAdded)
    push('engines-removed', '移除搜索引擎', toneRemoved, diff.enginesRemoved)
  } else if (diff.kind === 'bundle') {
    push('bundle-added', '新增成员', toneAdded, diff.bundleItemsAdded)
    push('bundle-removed', '移除成员', toneRemoved, diff.bundleItemsRemoved)
  }

  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border/70 p-4">
        两个版本的内容一致，没有需要对比的差异。
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-mono">
        v{diff.versionFrom} → v{diff.versionTo}
      </p>
      {groups.map((g) => (
        <div key={g.key} className="space-y-1.5">
          <div className={`text-xs font-medium ${g.tone}`}>
            {g.label}（{g.items.length}）
          </div>
          <ul className="space-y-1">
            {g.items.map((item, idx) => (
              <li key={`${g.key}-${idx}`} className="text-xs text-muted-foreground font-mono break-all">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
