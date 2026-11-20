'use client'

/**
 * 数据页危险区：删除全部云端数据 + 删除后确认区。
 *
 * 独立成组件并被 /me/data 按需加载（next/dynamic，ssr: false）：危险区在
 * 折叠线以下，且是本页唯一消费 `useFavorites` / `next-auth` signOut 的
 * 地方——整条收藏闭包（favorites-storage / triage / shelved / hibernation /
 * undo-stack / import-workbench / quicklinks / growth-lazy …）不应占数据页
 * 首屏预算（bundle 只降不升的硬约束；/me/data 曾超预算 2 KB）。
 *
 * 行为与原内联实现逐行一致：删除前先清本机收藏缓存（pushUndo: false，
 * 只清 navhub.favorites.v1，不碰回收站键）；删除成功后停在确认态，用户
 * 点「退出并返回用户中心」才登出回 /me（U-278：立即登出会跳首页，确认区
 * 永远渲染不到；服务端在 DELETE 返回前已吊销全部会话，推迟登出无风险）。
 */
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { signOut } from 'next-auth/react'
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react'

export function MeDataDangerZone({
  deleted,
  onDeleted,
  onError,
}: {
  /** true = 云端已删除，渲染确认区而非危险区 */
  deleted: boolean
  /** 云端删除成功后通知页面切换到确认态 */
  onDeleted: () => void
  /** 删除失败（或开始时清错）时把错误文本交给页面的错误条 */
  onError: (message: string | null) => void
}) {
  const { toast } = useToast()
  const favorites = useFavorites()
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return
    setDeleting(true)
    onError(null)
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || '删除失败')
      // 云端已清空：本机收藏缓存一并清掉，避免下次同步又把旧数据推回云端。
      // pushUndo: false——账号删除本身不进撤销（云端已清空，撤销无意义）。
      // 注意：这里只清收藏本体（navhub.favorites.v1），绝不碰回收站键
      // navhub.favorites.trash.v1——清账号是另一回事，回收站里的 30 天
      // 快照留给用户自己在回收站页处理，不由账号删除顺手抹掉。
      favorites.clear({ pushUndo: false })
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('navhub.growth.')) window.localStorage.removeItem(key)
      }
      onDeleted()
      toast({ title: '云端数据已删除', description: '登录账号已一并删除，邮箱与密码不再可用；重新注册是全新的空账号。' })
      // U-278：不在这里登出——立即登出会跳首页，确认区永远渲染不到。
      // 登出改由确认区「退出并返回用户中心」按钮触发（handleDeletedReturn）；
      // 服务端在 DELETE 返回前已 revokeAllSessions 并删了账号行，残留本地
      // 会话已无实际权限，推迟登出无风险。
    } catch (err) {
      onError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }, [confirmText, favorites, onDeleted, onError, toast])

  // U-278：确认区「退出并返回用户中心」按钮的唯一登出入口。删除成功后先停在
  // 确认态展示结果，用户点返回才登出回 /me（此时已是匿名态，会话在
  // 服务端早已吊销，登出只是清本地 cookie）。
  const handleDeletedReturn = useCallback(async () => {
    await signOut({ callbackUrl: '/me' })
  }, [])

  if (deleted) {
    return (
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold">云端数据已删除</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              收藏、历史、画像、LLM 配置、金库元信息与插件安装记录均已清除，登录账号已一并删除，邮箱与密码不再可用。
            </p>
            <Button variant="outline" size="sm" className="mt-3 w-full text-xs sm:w-auto" onClick={() => void handleDeletedReturn()}>
              退出并返回用户中心
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive-text">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          删除全部云端数据
        </h2>
        <span className="rounded-full border border-destructive/30 bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive-text">
          不可逆
        </span>
      </div>
      <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
        这是不可逆操作。输入 <span className="font-mono font-semibold text-destructive-text">DELETE</span> 解锁按钮。
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="输入 DELETE"
          className="h-9 w-full text-xs sm:w-44"
          aria-label="删除确认"
        />
        <Button
          variant="destructive"
          size="sm"
          className="w-full text-xs sm:w-auto"
          disabled={deleting || confirmText.trim().toUpperCase() !== 'DELETE'}
          onClick={() => void handleDelete()}
        >
          {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
          永久删除
        </Button>
      </div>
    </section>
  )
}
