'use client'

/**
 * 概览页的账号卡：登录态展示资料摘要，匿名态给出登录与查看本机收藏。
 *
 * 匿名文案与按钮保持原文（E2E 固定断言），只调整外层排版。
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, LogIn, User } from 'lucide-react'
import type { Overview } from '@/app/me/me-view'

export function AccountCard({
  user,
  anonId,
  favoritesCount,
  anonymous,
}: {
  user: Overview['user'] | null
  anonId: string
  favoritesCount: number
  anonymous: boolean
}) {
  if (anonymous) {
    return (
      <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LogIn className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">当前是匿名身份</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              收藏与画像已保存在本机（{favoritesCount} 个收藏，匿名标识{' '}
              <span className="font-mono">{anonId.slice(0, 14)}…</span>）。登录后可跨设备同步，并把本机匿名数据合并到账号。
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/auth/signin?callbackUrl=/me">登录 / 创建账号</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/favorites">查看本机收藏</Link>
          </Button>
        </div>
      </section>
    )
  }

  const name = user?.username?.trim() || '已登录用户'
  const initial = name.slice(0, 1).toUpperCase()

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {user?.avatar ? (
            // 头像来源受限（http(s) 或站内路径），这里用原生 img 避免 next/image 域名白名单
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar}
              alt=""
              className="h-11 w-11 shrink-0 rounded-full border border-border/70 object-cover"
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
              {initial || <User className="h-4 w-4" aria-hidden />}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold" title={name}>
              {name}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={user?.email ?? undefined}>
              {user?.email ?? '未绑定邮箱'} · 身份 {user?.id?.slice(0, 10) ?? '—'}…
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
          <Link href="/me/account">
            管理账号
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  )
}
