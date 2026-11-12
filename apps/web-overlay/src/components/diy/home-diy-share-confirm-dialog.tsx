'use client'

/**
 * #diy= 分享确认对话框（第二阶段）。
 *
 * 阶段一（5e018f3）只把分享挂起进 pendingShare，不替换本地配置；没有这一步，
 * 挂起的分享永远到不了用户手里、也清不掉。这个对话框就是挂起状态的唯一出口：
 *
 *   - 打开一条分享链接 → hydrateHomeDiy() 挂起 pendingShare → 本对话框弹出，
 *     逐条列出确认后会变什么（computeHomeDiyShareDiff 按水合后的本地配置重算，
 *     不以挂起时的快照为准）；
 *   - 「确认应用」→ confirmPendingShare()：先把当前本地配置自动备份到
 *     `<STORAGE_KEY>.share-backup.<时间戳>`，再按字段级合并应用（只写链接
 *     实际携带的字段，没携带的字段保持本地值；可 Ctrl+Z 撤销）；
 *   - 「暂不应用」/ Esc / 点遮罩 → dismissPendingShare()：只清 pendingShare，
 *     本地排版一概不动。
 *
 * 挂载点有两个，但同一时刻只会存在一个实例（见下）：
 *   - HomeDIYTrigger（静息态，常驻）：分享链接的接收方通常还没进编排模式，
 *     对话框必须在这里就能弹出来；本组件经 next/dynamic 懒加载，不破坏
 *     Trigger 轻量化的 P0-3 拆分；
 *   - HomeDIYToolbar（编排态）：进编排模式后 Trigger 让位，改由工具栏挂载。
 * 组件本身不持状态，直接读 useHomeDIY() 的 pendingShare，两个挂载点都不用传 props。
 */
import { Share2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { computeHomeDiyShareDiff, getHomeDiySnapshot } from '@/lib/modular/home-diy-storage'
import { useHomeDIY } from '@/lib/modular/use-home-diy'

export function HomeDiyShareConfirmDialog() {
  const { config, pendingShare, confirmPendingShare, dismissPendingShare } = useHomeDIY()
  const { toast } = useToast()

  // 待确认的来源：'share'（#diy= 分享链接）或 'import'（备份弹窗里粘贴/
  // 上传的 JSON 导入）。import 的 pending 由 prepareHomeDiyImport 产出，
  // 经 stageHomeDiyPendingShare 挂进同一份 pendingShare（见 home-diy-io.ts
  // 的 P0-5 注释）；source 字段是 coordinator 在 storage 的
  // PendingHomeDiyShare 上补的类型，旧分享没有它，默认按 'share' 读。
  // 两个来源的流程完全相同：确认 = 自动备份 + 字段级合并 + 可撤销；
  // 忽略 = 本地排版一概不动。只换文案，不分叉。
  const source = (pendingShare as (typeof pendingShare & { source?: 'share' | 'import' }) | null)?.source ?? 'share'
  const isImport = source === 'import'

  // 差异按当前本地配置重算：挂起发生在水合读本地存储之前，pendingShare.diff
  // 那份快照是对默认配置算的，会把「本地本来就有、链接没带」的字段也算成变化。
  // 只比链接实际携带的字段（pendingShare.carriedFields），没携带的字段不列入。
  const diff = pendingShare ? computeHomeDiyShareDiff(config, pendingShare.imported, pendingShare.carriedFields) : []

  const handleConfirm = () => {
    const res = confirmPendingShare()
    if (!res.applied) {
      toast({
        title: '没有待确认的分享',
        description: '这条分享可能已经被确认或忽略了，本地排版未作任何改动。',
        variant: 'destructive',
      })
      return
    }
    toast({
      title: isImport ? '✅ 导入的排版已应用' : '✅ 分享排版已应用',
      description: res.backupKey
        ? `应用前已把当前排版备份到 ${res.backupKey}；按 Ctrl/Cmd+Z 也可撤销这次应用。`
        : '当前排版没能自动备份（本地存储写入失败），但按 Ctrl/Cmd+Z 仍可撤销这次应用。',
      // Ryan 版 storage 的 confirm 不返回 ok：落盘成败以共享状态的
      // storageWarning 为准（confirm 内的写盘同步完成，调用后立即能读到）。
      variant: getHomeDiySnapshot().storageWarning ? 'destructive' : 'default',
    })
  }

  const handleDismiss = () => {
    if (!dismissPendingShare()) return
    toast({
      title: isImport ? '已取消导入' : '已忽略这条分享链接',
      description: '本地排版未作任何改动。',
    })
  }

  return (
    <Dialog
      open={pendingShare !== null}
      onOpenChange={(open) => {
        // Esc / 点遮罩关掉 = 暂不应用：本地排版不动，只是清掉挂起状态
        if (!open) handleDismiss()
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-6">
        <DialogHeader className="pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-violet-500" />
            <span>{isImport ? '应用导入的排版配置？' : '应用好友分享的排版？'}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isImport
              ? '这份导入的配置不会静默替换你的本地排版：下面是确认后会改动的地方。确认前会自动把当前排版备份到浏览器本地存储，应用后按 Ctrl/Cmd+Z 也可撤销。'
              : '这条分享链接不会静默替换你的本地排版：下面是确认后会改动的地方。确认前会自动把当前排版备份到浏览器本地存储，应用后按 Ctrl/Cmd+Z 也可撤销。'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-3">
          {pendingShare?.warning ? (
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400 pb-2">
              {pendingShare.warning}
            </p>
          ) : null}
          {diff.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {isImport ? '导入的排版与本地排版完全一致，无需改动。' : '分享的排版与本地排版完全一致，无需改动。'}
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs leading-relaxed">
              {diff.map((line) => (
                <li key={line} className="flex items-start gap-1.5">
                  <span aria-hidden className="text-violet-500 shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            暂不应用
          </Button>
          <Button size="sm" onClick={handleConfirm} className="bg-violet-600 hover:bg-violet-700 text-white font-medium">
            确认应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
