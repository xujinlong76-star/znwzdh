'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from "@/registry/new-york/ui/button"
import { Compass, Home, Flame, Tags, Layers, Share2, Star, type LucideIcon } from 'lucide-react'
import { SearchPalette } from '@/components/search-palette'
import { RECOVERY_LINKS, type RecoveryIcon } from '@/lib/recovery-links'

/**
 * 404 页 = 恢复入口，不是终止页。
 *
 * 改动前这里只有「返回主页」和「技术生态图谱」两个出口，但文案却写着
 * 「您可以尝试搜索」—— 页面上根本没有搜索框（说了做不到）。
 * 对导航站来说 404 是最高频的失败面：外链失效、收藏里存了旧 id、
 * 手输路径打错一个字，用户此刻最需要的就是**立刻搜到正确的东西**。
 *
 * 因此这里：
 *  - 直接嵌入真实的搜索面板（文案里的「搜索」变成真的）
 *  - 用 usePathname() 明确告诉用户是哪个路径没找到（打错字时一眼可见）
 *  - 给出成组的恢复路径（数据来自 lib/recovery-links.ts，可被测试对着真实路由表校验）
 */

const ICONS: Record<RecoveryIcon, LucideIcon> = {
  home: Home,
  trending: Flame,
  tags: Tags,
  collections: Layers,
  graph: Share2,
  favorites: Star,
}

export default function NotFound() {
  const pathname = usePathname()
  const home = RECOVERY_LINKS[0]
  const rest = RECOVERY_LINKS.slice(1)

  return (
    <main id="main-content" className="flex flex-col items-center justify-center min-h-[80vh] p-4 text-center">
      <div className="max-w-2xl w-full p-6 sm:p-8 rounded-3xl border border-border/80 glass-surface shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto shadow-xs">
          <Compass className="w-8 h-8 animate-pulse" />
        </div>

        <div className="space-y-2">
          <div className="inline-block text-xs font-mono px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
            404 NOT FOUND
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            页面未找到
          </h1>
          {pathname && pathname !== '/' && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              你访问的{' '}
              <code className="px-1.5 py-0.5 rounded-md bg-muted/60 border border-border/60 font-mono break-all">
                {pathname}
              </code>{' '}
              不存在或已被移除。
            </p>
          )}
        </div>

        {/* 说了「可以尝试搜索」，就必须真的能搜 */}
        <div className="pt-1">
          <SearchPalette placeholder="没找到？直接搜导航…（中文 / 拼音 / 语义）" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
          {rest.map((link) => {
            const Icon = ICONS[link.icon]
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group flex items-start gap-2.5 rounded-xl border border-border/60 p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <Icon className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground group-hover:text-primary">
                    {link.label}
                  </span>
                  <span className="block text-xs text-muted-foreground leading-relaxed">
                    {link.description}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>

        <div className="flex items-center justify-center pt-1">
          <Button asChild size="sm" className="text-xs rounded-xl gap-1.5 shadow-xs">
            <Link href={home.href}>
              <Home className="w-3.5 h-3.5" />
              <span>{home.label}</span>
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
