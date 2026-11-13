'use client'

/**
 * 首访引导（3 步，可跳过，只出现一次）。
 *
 * 为什么不做遮罩式 tour：导航站的用户是来「找东西」的，任何阻断式引导都会被
 * 立刻关掉，甚至直接离开。这里做成**内容区顶部的一张卡片**：
 *   - 不遮挡任何内容，滚过去就看不见了；
 *   - 每步都能真的点进去（导入 / 搜索 / 收藏），不是纯文字说明；
 *   - 关掉后写 localStorage，设置页（/me/settings）有「重新查看新手引导」
 *     入口可清除该键重看（B11；键名见 lib/onboarding.ts，两边共用一把键）。
 *
 * 只讲三件「不知道就等于白来」的事：
 *   1. 可以把浏览器书签整包导入（大多数新用户的第一诉求）；
 *   2. 搜索支持 ⌘K / `/`，且能搜拼音与语义；
 *   3. 收藏后下次直接从这里打开（本地收藏，不需要登录）。
 *
 * 键盘类提示（⌘K、空格、↑↓）在 `pointer: coarse` 的设备上不渲染：触屏用户
 * 按不到键，留着就是噪声。判据用指针类型而不是断点宽度——640px 以上的平板
 * 同样是触屏，按宽度筛会漏掉它们。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { BookmarkPlus, Command, Star, X, ArrowRight } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { getModifierKey } from '@/lib/platform'
import { ONBOARDING_DISMISSED_VALUE, ONBOARDING_STORAGE_KEY } from '@/lib/onboarding'
import { spotlightHotkeyHint, useSpotlightShortcutMode } from '@/lib/user-preferences'

/**
 * CLS 修复（Lighthouse Wave 1，2026-11-13）：旧版用 useState(false) + useEffect
 * 读 localStorage——SSR 高度 0，水合后 473px 的引导卡插入、下推整页（CLS 0.132）。
 *
 * 改 useSyncExternalStore：server snapshot 返回 false（未关闭 → 可见），卡片直接进
 * SSR 首帧；client 快照首绘即读 localStorage，首访用户不闪不动。已关闭的用户
 * 服务端仍先渲染、客户端快照后收起（服务端不知道他关过，只能这样；收起是用户
 * 已确认的状态变化，不是首帧抖动）。
 *
 * 订阅：本标签页 dismiss 后发自定义事件（storage 事件只跨标签触发）；跨标签页
 * 走 storage 事件。getSnapshot 只读 localStorage、无副作用，返回值稳定。
 */
function subscribeOnboardingDismissed(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ONBOARDING_STORAGE_KEY) onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('navhub:onboarding-dismissed', onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('navhub:onboarding-dismissed', onChange)
  }
}

function getOnboardingDismissedSnapshot(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_DISMISSED_VALUE
  } catch {
    // 隐私模式下 localStorage 可能抛错：静默显示，不影响主流程
    return false
  }
}

export function OnboardingCard() {
  const dismissed = useSyncExternalStore(
    subscribeOnboardingDismissed,
    getOnboardingDismissedSnapshot,
    () => false,
  )
  // 修饰键（⌘/Ctrl）不能在渲染期读 navigator：服务端永远返回 'Ctrl'，
  // iPhone 客户端首绘若是 '⌘'，与 SSR 文本不一致 → React #418 水合失败
  // （键盘快捷键弹窗已用同一写法）。首绘固定 'Ctrl'，挂载后在 effect
  // 里校正——kbd 文案在卡片内换字，不推挤其他内容。
  const [modKey, setModKey] = useState<'⌘' | 'Ctrl'>('Ctrl')
  useEffect(() => {
    setModKey(getModifierKey())
  }, [])
  const shortcutHint = spotlightHotkeyHint(useSpotlightShortcutMode(), modKey)

  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, ONBOARDING_DISMISSED_VALUE)
    } catch {
      // 存不进去也无妨：本次会话已隐藏
    }
    try {
      window.dispatchEvent(new Event('navhub:onboarding-dismissed'))
    } catch {
      // 忽略
    }
  }

  if (dismissed) return null

  return (
    <section
      aria-label="新手引导"
      // 等高 min-h：Playwright 实测生产构建卡片高 473px（390px 宽）/ 256px（1350px 宽）；
      // 内容若因字体、快捷键提示晚到而先矮后高，min-h 托住外高、下面内容不跟着跳。
      className="mb-6 min-h-[473px] rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 sm:min-h-[256px] sm:p-5 animate-in fade-in slide-in-from-top-1 duration-300"
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
            2. 搜索
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            点顶部搜索框直接输入
            <span className="pointer-coarse:hidden">，或按 <kbd className="rounded border px-1">{shortcutHint}</kbd> 随时唤起</span>；支持拼音（qdjb）与自然语言。
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
