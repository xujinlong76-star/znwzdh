'use client'

/**
 * 首访引导（3 步，可跳过，只出现一次）。
 *
 * 为什么不做遮罩式 tour：导航站的用户是来「找东西」的，任何阻断式引导都会被
 * 立刻关掉，甚至直接离开。这里做成**内容区顶部的一张卡片**：
 *   - 不遮挡任何内容，滚过去就看不见了；
 *   - 每步都能真的点进去（导入 / 搜索 / 收藏），不是纯文字说明；
 *   - 关掉后写 localStorage，设置页可重新打开（清除该键即可）。
 *
 * 只讲三件「不知道就等于白来」的事：
 *   1. 可以把浏览器书签整包导入（大多数新用户的第一诉求）；
 *   2. 搜索支持 ⌘K / `/`，且能搜拼音与语义；
 *   3. 收藏后下次直接从这里打开（本地收藏，不需要登录）。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookmarkPlus, Command, Star, X, ArrowRight } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { getModifierKey } from '@/lib/platform'
import { spotlightHotkeyHint, useSpotlightShortcutMode } from '@/lib/user-preferences'

const STORAGE_KEY = 'navhub:onboarding:v1'

export function OnboardingCard() {
  const [visible, setVisible] = useState(false)
  const shortcutHint = spotlightHotkeyHint(useSpotlightShortcutMode(), getModifierKey())

  useEffect(() => {
    // 必须等挂载后再读 localStorage：服务端渲染时没有它，
    // 直接放进初始 state 会造成 hydration 不一致（服务端 true / 客户端 false）。
    try {
      if (localStorage.getItem(STORAGE_KEY) !== 'done') setVisible(true)
    } catch {
      // 隐私模式下 localStorage 可能抛错：静默不显示，不影响主流程
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'done')
    } catch {
      // 存不进去也无妨：本次会话已隐藏
    }
  }

  if (!visible) return null

  return (
    <section
      aria-label="新手引导"
      className="mb-6 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 sm:p-5 animate-in fade-in slide-in-from-top-1 duration-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">三步把这里变成你的起始页</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            不用登录也能用；收藏与布局都存在本机。
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={dismiss}
          aria-label="关闭新手引导"
          title="关闭（不再显示）"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        <li className="rounded-xl border border-border/60 bg-background/70 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
            1. 导入浏览器书签
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            支持 Chrome / Edge / Firefox 导出的 HTML、OneTab 文本与 Markdown。
          </p>
          <Button asChild size="sm" variant="outline" className="mt-2 h-7 gap-1 text-xs">
            <Link href="/import">
              去导入
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </li>

        <li className="rounded-xl border border-border/60 bg-background/70 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Command className="h-3.5 w-3.5 text-primary" />
            2. 用键盘搜索
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            按 <kbd className="rounded border px-1">{shortcutHint}</kbd> 唤起；支持拼音（qdjb）与自然语言。
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 gap-1 text-xs"
            onClick={() => {
              // 不实现全局快捷键分发：直接聚焦搜索输入框，语义等价且更可靠
              const input = document.querySelector<HTMLInputElement>('input[data-search-input]')
              input?.focus()
            }}
          >
            试试搜索
            <ArrowRight className="h-3 w-3" />
          </Button>
        </li>

        <li className="rounded-xl border border-border/60 bg-background/70 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Star className="h-3.5 w-3.5 text-primary" />
            3. 收藏常用站点
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            卡片上的星标加入收藏；下次从「我的收藏」一键打开。
          </p>
          <Button asChild size="sm" variant="outline" className="mt-2 h-7 gap-1 text-xs">
            <Link href="/favorites">
              看看收藏
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </li>
      </ol>

      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={dismiss}>
          我知道了，不再显示
        </Button>
      </div>
    </section>
  )
}
