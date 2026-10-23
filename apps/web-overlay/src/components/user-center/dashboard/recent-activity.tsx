'use client'

/**
 * 最近操作（M10）：只展示动作与时间，不含 IP 与内部差异。
 * 辅助信息，取数失败时不打断主面板。
 */
export interface ActivityItem {
  action: string
  target: string
  at: number
}

/** 操作记录的中文映射：未知 action 原样展示，不吞掉新事件 */
const ACTIVITY_LABELS: Record<string, string> = {
  'user.export': '导出个人数据',
  'user.delete': '删除云端个人数据',
  'user.settings_update': '更新个人偏好设置',
  'user.profile_update': '修改个人展示资料',
  'user.diagnostics': '执行账户数据健康自检修复',
  'identity.merge': '合并匿名身份',
  'identity.sync': '同步登录身份',
  'workspace:create': '创建工作空间',
  'workspace:member_update': '更新空间成员',
  'workspace:member_remove': '移除空间成员',
}

function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action
}

function relativeTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section className="flex flex-col rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">最近操作</h2>
        <span className="text-[11px] text-muted-foreground">只显示动作与时间，不含 IP 与内部差异</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          最近没有可展示的操作记录。
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-border/60">
          {items.map((item, index) => (
            <li
              key={`${item.action}-${item.target}-${item.at}-${index}`}
              className="flex items-start justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{activityLabel(item.action)}</p>
                {item.target ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={item.target}>
                    {item.target}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{relativeTime(item.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
