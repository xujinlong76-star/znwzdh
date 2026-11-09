'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Plus, Tags } from 'lucide-react'

export interface CategorySuggestion {
  categoryId: string
  categoryTitle: string
  confidence: number
  matchReason: string
}

/**
 * 「添加网址到专属分类」弹窗。
 *
 * ## 为什么抽成独立组件（2026-11-09）
 *
 * 这个弹窗原先内联在 `navigation-content.tsx` 里，导致它的
 * `@radix-ui/react-dialog`（含 FocusScope / DismissableLayer / Portal 一整条链）
 * 被**静态打进首页首屏 chunk**。实测首页首屏 1171 KB 里有约 144 KB 是
 * Radix Dialog 相关代码，而这条交互的实际使用频率极低
 * （只有点分类上的「+ 添加网址」才会打开）。
 *
 * 同文件的 `KeyboardShortcutsDialog` 与 `SitePeekDialog` 早就是 `dynamic()`
 * 懒加载了，唯独这个弹窗漏了——口径不一致，不是有意为之。
 * 抽出来后由调用方 `dynamic(() => import(...), { ssr: false })` 加载，
 * 首屏不再为它付费。
 */
export function AddSiteDialog({
  open,
  onOpenChange,
  title,
  href,
  desc,
  onTitleChange,
  onHrefChange,
  onDescChange,
  suggestion,
  onPickSuggestion,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  href: string
  desc: string
  onTitleChange: (v: string) => void
  onHrefChange: (v: string) => void
  onDescChange: (v: string) => void
  suggestion: CategorySuggestion | null
  onPickSuggestion: (categoryId: string) => void
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="w-5 h-5 text-emerald-500" />
            <span>添加网址到专属分类</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            录入您想要收录的自定义网站，仅保存在当前设备的私人看板中。
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-3">
          <div>
            <label htmlFor="custom-site-title" className="text-xs font-medium text-foreground block mb-1">网站标题 *</label>
            <Input id="custom-site-title"
              placeholder="例如：My Internal Dashboard"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="custom-site-href" className="text-xs font-medium text-foreground block mb-1">网站网址 (URL) *</label>
            <Input id="custom-site-href"
              placeholder="例如：https://internal.company.io 或 192.168.1.100:8080"
              value={href}
              onChange={(e) => onHrefChange(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="custom-site-desc" className="text-xs font-medium text-foreground block mb-1">简要描述 (可选)</label>
            <Input id="custom-site-desc"
              placeholder="例如：公司内部指标监控看板"
              value={desc}
              onChange={(e) => onDescChange(e.target.value)}
            />
          </div>

          {/* 关键词分类推荐卡片：判据是字符串重合，界面上不许冒充 AI */}
          {suggestion && (
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <Tags className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-muted-foreground truncate">
                    按关键词推荐分类：
                    <strong className="text-foreground">{suggestion.categoryTitle}</strong>
                    （重合度 {Math.round(suggestion.confidence * 100)}%）
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {suggestion.matchReason} · 本地字符串匹配，不是 AI 判断
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => onPickSuggestion(suggestion.categoryId)}
                className="h-6 px-2 text-[11px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 shrink-0 font-medium"
              >
                选入该类
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!title.trim() || !href.trim()}
          >
            保存到分类
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
