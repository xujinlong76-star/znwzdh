'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  getActiveTryout,
  cancelThemeTryout,
  commitThemeTryout,
  type ThemeTryoutConfig,
} from '@/lib/plugins/theme-runtime'
import { Button } from '@/components/ui/button'
import { Sparkles, X, Check, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

export function ThemeTryoutRibbon() {
  const [tryout, setTryout] = useState<ThemeTryoutConfig | null>(null)

  useEffect(() => {
    // 初始化同步
    setTryout(getActiveTryout())

    const handleTryoutChange = (e: Event) => {
      const custom = e as CustomEvent<ThemeTryoutConfig | null>
      setTryout(custom.detail ?? getActiveTryout())
    }

    window.addEventListener('navhub_theme_tryout_changed', handleTryoutChange)
    return () => {
      window.removeEventListener('navhub_theme_tryout_changed', handleTryoutChange)
    }
  }, [])

  if (!tryout) return null

  const handleCancel = () => {
    cancelThemeTryout()
    toast.info('已恢复原本主题')
  }

  const handleCommit = () => {
    commitThemeTryout()
    toast.success(`已正式保存并应用主题：${tryout.name}`)
  }

  // 定位/宽度用内联样式：当前 Tailwind v4 构建漏生成了 bottom-5 与
  // w-[calc(100%-2rem)]，fixed 元素会停在文档流末尾，滚动后按钮落在视口外。
  return (
    <aside
      aria-label="主题试用状态栏"
      aria-live="polite"
      style={{ bottom: '1.25rem', width: 'calc(100% - 2rem)' }}
      className="fixed left-1/2 -translate-x-1/2 z-50 max-w-xl shadow-2xl rounded-2xl border border-primary/30 bg-background/95 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-md bg-primary/15 text-primary tracking-wide">
              免安装试用中
            </span>
            <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
              {tryout.name}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate hidden sm:block">
            当前处于纯前端沙箱预览，刷新或点击退出随时还原
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hidden md:inline-flex"
        >
          <Link href={`/marketplace/${encodeURIComponent(tryout.slug)}`}>
            详情
            <ExternalLink className="h-3 w-3 ml-1" />
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          className="h-8 px-2.5 text-xs border-border/80 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          退出试用
        </Button>
        <Button
          size="sm"
          onClick={handleCommit}
          className="h-8 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          保留应用
        </Button>
      </div>
    </aside>
  )
}
