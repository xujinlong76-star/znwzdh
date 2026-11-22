'use client'

/**
 * 0 收藏破冰空态：三选一快速起步卡片组 + 手动新建自定义收藏弹窗。
 *
 * 痛点：旧空态只有一段居中文字，让用户「自己抬头找右上角导入」或「回主页
 * 一个一个点星标」，无法在当前页面完成第一次有效行动。
 *
 * 三张行动微卡（无需抬头找按钮）：
 *  1. 一键搬家（主推荐）→ 唤起现有书签导入弹层（UniversalBookmarkModal）；
 *  2. 探索发现 → 直达 /，附 [标签云] / [趋势榜] 快捷入口；
 *  3. 手动新建 → 原地弹出轻量输入框（URL + 标题 + 文件夹），存第一条私密书签。
 *
 * 手动新建与站内收藏共用 LocalFavorite Schema（siteId/href/title/folderId/...），
 * 落库走 useFavorites().toggle()（与星标按钮同一入口），不新造存储通道。
 * 首次手动新建触发成长事件 recordCustomSiteAddedAction()（与站内自定义站同口径）。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Compass,
  Download,
  FolderPlus,
  Link2,
  Loader2,
  Sparkles,
  Tags,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { generateBookmarkId } from '@/lib/favorites-export-import'

/** 轻量 URL 校验：只放行 http/https 绝对地址（与 SSRF 守卫同口径）。 */
export function normalizeManualUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.toString()
}

export interface ManualAddResult {
  ok: boolean
  error?: string
}

export function FavoritesManualAddModal({
  open,
  onOpenChange,
  folders,
  onAdd,
  onCreateFolder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: Array<{ id: string; name: string }>
  onAdd: (item: { siteId: string; title: string; href: string; folderId: string | null }) => Promise<boolean> | boolean
  onCreateFolder?: (name: string) => Promise<string | null>
}) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [folderId, setFolderId] = useState<string>('__none__')
  const [newFolderName, setNewFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次打开重置，避免上次输入残留
  useEffect(() => {
    if (open) {
      setUrl('')
      setTitle('')
      setFolderId('__none__')
      setNewFolderName('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    const href = normalizeManualUrl(url)
    if (!href) {
      setError('请输入以 http:// 或 https:// 开头的完整网址')
      return
    }
    let resolvedFolderId: string | null = null
    if (folderId === '__new__') {
      const name = newFolderName.trim()
      if (!name) {
        setError('请填写新收藏夹名称，或改选已有收藏夹')
        return
      }
      if (!onCreateFolder) {
        setError('当前不支持新建收藏夹，请选择已有收藏夹')
        return
      }
      setBusy(true)
      const created = await onCreateFolder(name)
      setBusy(false)
      if (!created) {
        setError('新建收藏夹失败，请重试')
        return
      }
      resolvedFolderId = created
    } else if (folderId !== '__none__') {
      resolvedFolderId = folderId
    }

    const titleFinal = title.trim() || (() => {
      try {
        return new URL(href).hostname.replace(/^www\./, '')
      } catch {
        return href
      }
    })()

    setBusy(true)
    const ok = await onAdd({
      siteId: generateBookmarkId(href),
      title: titleFinal,
      href,
      folderId: resolvedFolderId,
    })
    setBusy(false)
    if (!ok) {
      setError('保存失败：本地存储不可写，请检查浏览器权限')
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-primary" aria-hidden />
            手动收藏自定义网址
          </DialogTitle>
          <DialogDescription className="text-xs">
            不局限于站内已收录站点：任何网址都能存进私密收藏。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label htmlFor="manual-add-url" className="text-xs font-medium text-foreground">
              网址 <span className="text-destructive-text">*</span>
            </label>
            <Input
              id="manual-add-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void submit()
              }}
              placeholder="https://example.com"
              inputMode="url"
              autoComplete="off"
              className="h-9 text-sm"
              aria-required="true"
              aria-invalid={error ? 'true' : undefined}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="manual-add-title" className="text-xs font-medium text-foreground">
              标题（可留空，默认取域名）
            </label>
            <Input
              id="manual-add-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void submit()
              }}
              placeholder="我的常用工具"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="manual-add-folder" className="text-xs font-medium text-foreground">
              收藏夹
            </label>
            <select
              id="manual-add-folder"
              value={folderId}
              onChange={(e) => {
                setFolderId(e.target.value)
                setError(null)
              }}
              className="h-9 w-full rounded-md border border-border/70 bg-background px-2 text-sm text-foreground"
            >
              <option value="__none__">未分类</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value="__new__">＋ 新建收藏夹…</option>
            </select>
          </div>

          {folderId === '__new__' && (
            <div className="space-y-1.5">
              <label htmlFor="manual-add-new-folder" className="text-xs font-medium text-foreground">
                新收藏夹名称
              </label>
              <Input
                id="manual-add-new-folder"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void submit()
                }}
                placeholder="例如：工作常用"
                autoComplete="off"
                className="h-9 text-sm"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive-text">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy} className="gap-1.5">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            存进收藏
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 破冰空态三卡。整卡可点击（button 元素），键盘 Enter/Space 直接触发，
 * 焦点环用 ring 而非仅描边，暗色下同样可见。
 */
export function FavoritesQuickStartEmpty({
  onImportClick,
  onManualAddClick,
}: {
  onImportClick: () => void
  onManualAddClick: () => void
}) {
  return (
    <section
      aria-label="快速起步"
      data-testid="favorites-quickstart-empty"
      className="mx-auto max-w-3xl px-2 py-8 sm:py-12"
    >
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">从这里开始收藏</h2>
        <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
          三种方式任选其一，30 秒内建立你的第一个零知识书签库。
        </p>
      </div>

      {/*
        2026-11-22 移动端右侧留白：右下角浮坞（猫 40px，贴边 6px）在 390px 下
        占 right 6~66px 区间。下面三张卡是整行宽按钮（一键搬家卡高 173px），
        纵向无论怎么调都会与浮坞相交——实测矩形交集 40x40。
        这里在 <sm 给网格右侧让出 68px，让卡片右缘收进浮坞左缘之内。
        sm 起三列布局，卡片本身变窄且浮坞在更靠右的位置，不再需要留白。
      */}
      <div className="grid gap-3 max-sm:pr-[68px] sm:grid-cols-3">
        {/* 1. 一键搬家（主推荐） */}
        <button
          type="button"
          onClick={onImportClick}
          data-testid="quickstart-import"
          className="group relative flex flex-col items-start gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            推荐
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Download className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold text-foreground">一键搬家</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            导入浏览器书签 / Markdown，30 秒把 Chrome/Edge 书签搬进零知识金库。
          </span>
          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary">
            开始导入
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </button>

        {/* 2. 探索发现 */}
        <Link
          href="/"
          data-testid="quickstart-explore"
          className="group flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/50 p-4 text-left transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
            <Compass className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold text-foreground">探索发现</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            去主页逛逛精选站点，顺手点星标即可收进来。
          </span>
          <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <Tags className="h-3 w-3" aria-hidden />
              标签云
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <TrendingUp className="h-3 w-3" aria-hidden />
              趋势榜
            </span>
          </span>
        </Link>

        {/* 3. 手动新建 */}
        <button
          type="button"
          onClick={onManualAddClick}
          data-testid="quickstart-manual"
          className="group flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/50 p-4 text-left transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <FolderPlus className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold text-foreground">手动新建</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            原地填写 URL + 标题 + 文件夹，立刻存进第一条私密书签。
          </span>
          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            ＋ 手动收藏自定义网址
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </button>
      </div>
    </section>
  )
}
