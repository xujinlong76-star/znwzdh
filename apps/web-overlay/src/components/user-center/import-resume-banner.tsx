'use client'

/**
 * 备份导入「续导」提示横幅（T2）：sessionStorage 里还有未导完的历史时出现。
 * 独立组件 + 按需加载：只在少数会话（刷新后续导）才需要，不占数据页首屏预算。
 */
import { Button } from '@/components/ui/button'
import { Loader2, Upload } from 'lucide-react'

export function ImportResumeBanner({
  remaining,
  busy,
  onResume,
}: {
  remaining: number
  busy: boolean
  onResume: () => void
}) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
      <span>上次的备份导入还有 {remaining} 条搜索历史未完成（页面刷新过也不会丢）。</span>
      <Button size="sm" variant="outline" className="w-full text-xs sm:w-auto" disabled={busy} onClick={onResume}>
        {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
        继续导入剩余 {remaining} 条
      </Button>
    </div>
  )
}
