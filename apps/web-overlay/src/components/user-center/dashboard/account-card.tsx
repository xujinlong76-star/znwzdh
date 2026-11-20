'use client'

/**
 * 概览页的账号卡：登录态展示资料摘要，匿名态给出登录、快照导出、健康自检与查看本机收藏。
 *
 * 匿名文案与按钮保持原文（E2E 固定断言），扩展 Local-First 匿名安全舱：
 * - 完整匿名标识展示与一键剪贴板复制；
 * - 本机离线数据快照导出（.json）；
 * - 本地存储占用与健康度探测（navigator.storage.estimate）。
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ArrowRight,
  Check,
  Clapperboard,
  Copy,
  Download,
  FolderHeart,
  HardDrive,
  LogIn,
  ShieldCheck,
  User,
} from 'lucide-react'
import type { Overview } from '@/lib/me-types'
import { readLocalUserSettings } from '@/lib/user-settings'
import { FAVORITES_STORAGE_KEY, parseFavorites } from '@/lib/favorites-storage'
import { ANON_ID_STORAGE_KEY } from '@/lib/identity-keys'
import { LOCAL_FOLDERS_STORAGE_KEY, parseLocalFolders } from '@/lib/favorites-folders'
import { WATCHLIST_STORAGE_KEY } from '@/lib/watchlist'
import { countWatchlistEntries } from '@/components/user-center/dashboard/entry-groups'
import type { LocalFavorite } from '@/hooks/useFavorites'
import { copyFailureToast, copyText } from '@/lib/clipboard'
import { useToast } from '@/components/ui/use-toast'

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
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [storageText, setStorageText] = useState<string | null>(null)
  const [watchlistCount, setWatchlistCount] = useState<number>(0)
  const { toast } = useToast()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const count = countWatchlistEntries(window.localStorage.getItem(WATCHLIST_STORAGE_KEY))
        void Promise.resolve().then(() => setWatchlistCount(count))
      } catch {
        /* 存储不可读时保留默认 0，不影响身份卡展示 */
      }
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          const usage = est.usage ?? 0
          if (usage > 1024 * 1024) {
            setStorageText(`${(usage / (1024 * 1024)).toFixed(1)} MB`)
          } else {
            setStorageText(`${Math.max(1, Math.round(usage / 1024))} KB`)
          }
        })
        // 估算存储占用是纯装饰信息：隐私模式下 storage.estimate 会直接抛，
        // 吞掉即可，卡片其余内容照常可用。
        .catch(() => {
          /* 存储占用是装饰信息：隐私模式下 storage.estimate 会抛，吞掉不影响卡片其余内容 */
        })
    }
  }, [])

  const copyAnonId = useCallback(async () => {
    if (!anonId) return
    // 复制必须确认真的写进剪贴板：失败时不能亮「已复制」，按项目统一封装回报原因
    const result = await copyText(anonId)
    if (!result.ok) {
      const note = copyFailureToast(result)
      toast({ ...note, variant: 'destructive' })
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [anonId, toast])

  const exportLocalSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return
    const rawFav = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    const favItems = parseFavorites<LocalFavorite>(rawFav).items
    const localFolders = parseLocalFolders(window.localStorage.getItem(LOCAL_FOLDERS_STORAGE_KEY))
    const settings = readLocalUserSettings()
    let diyConfig: Record<string, unknown> = {}
    try {
      const rawDiy = window.localStorage.getItem('navhub_home_diy_config')
      if (rawDiy) diyConfig = JSON.parse(rawDiy)
    } catch {
      /* 容错处理：DIY 配置解析失败使用空对象 */
    }

    const payload = {
      appName: '山羊胡网址导航大全 (AI-Native Hub)',
      format: 'navhub-local-full-backup',
      version: 1,
      schemaVersion: '5.0',
      exportedAt: new Date().toISOString(),
      // 匿名身份以存储为准（用户可能刚在别的标签页重置过），prop 只作兜底
      anonId: window.localStorage.getItem(ANON_ID_STORAGE_KEY) || anonId,
      meta: {
        customCategoriesCount: Array.isArray(diyConfig.customCategories) ? diyConfig.customCategories.length : 0,
        customSitesCount: Array.isArray(diyConfig.customCategories)
          ? (diyConfig.customCategories as Array<{ items?: unknown[] }>).reduce((acc: number, c) => acc + (c.items?.length || 0), 0)
          : 0,
        favoritesCount: favItems.length || favoritesCount,
        recentVisitsCount: 0,
      },
      favorites: favItems,
      localFolders,
      settings,
      diyConfig,
      recentVisits: [],
      favoritesCount: favItems.length || favoritesCount,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `navhub-snapshot-${(anonId || 'anon').slice(0, 8)}-${Date.now()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }, [anonId, favoritesCount])

  if (anonymous) {
    return (
      <section className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-emerald-400/[0.04]"
        />
        <div className="relative space-y-3.5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/15">
              <LogIn className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold tracking-tight">当前是匿名身份</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Local-First 离线安全舱
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                数据默认保存在本机，登录后可跨设备同步并自动合并匿名期间的收藏与画像。
              </p>
            </div>
          </div>

          {/* 本机资产速览条：匿名态同样直观呈现本机数据规模 */}
          <div className="grid grid-cols-3 gap-2">
            <Link
              href="/favorites"
              className="group rounded-xl border border-border/60 bg-background/70 px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <FolderHeart className="h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-400" aria-hidden />
                <span className="truncate">本机收藏</span>
              </span>
              <p className="mt-1 text-base font-semibold tabular-nums leading-tight">{favoritesCount}</p>
            </Link>
            <Link
              href="/me/watchlist"
              className="group rounded-xl border border-border/60 bg-background/70 px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clapperboard className="h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
                <span className="truncate">追剧清单</span>
              </span>
              <p className="mt-1 text-base font-semibold tabular-nums leading-tight">{watchlistCount}</p>
            </Link>
            <div className="rounded-xl border border-border/60 bg-background/70 px-2.5 py-2">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                <span className="truncate">离线占用</span>
              </span>
              <p className="mt-1 truncate text-base font-semibold tabular-nums leading-tight">
                {storageText ?? '检测中'}
              </p>
            </div>
          </div>

          {/* 精简为单行匿名标识与安全说明（消除原两行重复展示 UUID） */}
          <div className="min-w-0 space-y-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="shrink-0 text-[11px] text-muted-foreground">匿名标识</span>
                <code
                  title={anonId}
                  className="anon-badge block min-w-0 flex-1 truncate rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90 selection:bg-primary/20"
                >
                  {anonId}
                </code>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyAnonId()}
                className="h-6 shrink-0 gap-1 px-2 text-[11px] hover:bg-muted"
                title="复制完整匿名标识到剪贴板"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 text-muted-foreground" />
                    <span>复制</span>
                  </>
                )}
              </Button>
            </div>
            <p className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
              E2EE 端到端密钥受本机设备环境隔离
            </p>
          </div>
        </div>

        <div className="relative mt-4 flex flex-wrap items-center gap-2 pt-1">
          <Button asChild size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/auth/signin?callbackUrl=/me">登录 / 创建账号</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1 text-xs sm:flex-none">
            <Link href="/favorites">查看本机收藏</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportLocalSnapshot}
            className="flex-1 text-xs sm:flex-none"
            title="将本机收藏、设置与匿名状态导出为 JSON 文件备份"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            导出快照 .json
          </Button>
        </div>
      </section>
    )
  }

  const name = user?.username?.trim() || '已登录用户'
  const initial = name.slice(0, 1).toUpperCase()

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      {/* 底光：只做氛围，从左上淡淡铺开，不与内容争注意力 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-sky-400/[0.06]"
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          {user?.avatar && !avatarFailed ? (
            <img
              src={user.avatar}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setAvatarFailed(true)}
              className="h-12 w-12 shrink-0 rounded-full border border-border/70 bg-background object-cover ring-2 ring-primary/15"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-semibold text-primary ring-2 ring-primary/10">
              {initial || <User className="h-4 w-4" aria-hidden />}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold" title={name}>
                {name}
              </h2>
              {user?.source && (
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {user.source}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                云端同步中
              </span>
            </div>
            <p
              className="mt-0.5 truncate text-[11px] text-muted-foreground"
              title={`${user?.email ?? '未绑定邮箱'} · 身份 ${user?.id ?? '—'}…`}
            >
              {user?.email ?? '未绑定邮箱'} · 身份 {user?.id?.slice(0, 10) ?? '—'}…
            </p>
            {storageText && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                本地缓存占用：{storageText}
              </p>
            )}
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
