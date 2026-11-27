'use client'

/**
 * 「X 天未备份」轻提醒（2026-11-27 命令面板 v2）：
 * - 只在用户已有个人数据、且从未导出过或上次导出 ≥14 天时出现；
 * - 可关闭：关闭后 7 天内不再出现（7 天后若仍未导出会再次出现）；
 * - 不弹窗、不阻塞：只是一行提示 + 「导出备份」按钮；
 * - 判定是纯函数（lib/personal-data.ts 的 backupReminderStatus），
 *   本组件只负责展示与两条本地写操作（导出由调用方传入、关闭写本地），
 *   零网络请求。
 */
import { X } from 'lucide-react'
import { backupReminderStatus } from '@/lib/personal-data'
import { usePersonalData } from '@/hooks/usePersonalData'

export function PersonalBackupReminder({ onExport }: { onExport: () => void }) {
  const personal = usePersonalData()
  const status = backupReminderStatus(personal.data)
  if (!status.show) return null
  return (
    <div
      data-testid="personal-backup-reminder"
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-muted-foreground mb-2"
    >
      <span className="min-w-0 flex-1">
        {status.neverExported
          ? '你还没有导出过「我的常用」备份，换浏览器或清数据后就找不回来了。'
          : `已经 ${status.daysOverdue} 天没有导出备份了，导一份 JSON 存好，换设备也能带走。`}
      </span>
      <button
        type="button"
        onClick={onExport}
        className="shrink-0 rounded-md bg-amber-500/15 px-2 py-1 font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
      >
        导出备份
      </button>
      <button
        type="button"
        aria-label="7 天内不再提醒备份"
        title="7 天内不再提醒"
        onClick={() => personal.dismissBackupReminder()}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
