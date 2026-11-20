'use client'

/**
 * 概览页的账号卡：登录态展示资料摘要，匿名态给出登录、快照导出、健康自检与查看本机收藏。
 *
 * 匿名态资产感知（Local-First 匿名安全舱）：
 * - 匿名标识收纳为右上角轻量标签（短码 + 复制），点击复制完整 UUID；
 * - 安全背书人话化：主文案「仅本机可见的端到端加密（E2EE）」，点击展开技术细节；
 * - 有成长数据时 3 格改为本机收藏 / 成长等级 / 离线安全舱，并显示登录防丢失提示；
 * - 本机离线数据快照导出（.json）；
 * - 本地存储占用与健康度探测（navigator.storage.estimate）。
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  Download,
  FolderHeart,
  HardDrive,
  LogIn,
  ShieldCheck,
  Trophy,
  User,
} from 'lucide-react'
import type { Overview } from '@/lib/me-types'
import { cn } from '@/lib/utils'
import { GROWTH_UPDATED_EVENT, growthSummary, loadGrowthProfile } from '@/lib/growth'
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
  const [growth, setGrowth] = useState<{
    level: number
    totalXp: number
    streak: number
    freezeCards: number
  } | null>(null)
  const [e2eeOpen, setE2eeOpen] = useState(false)
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

  // 成长档案：匿名态同样读本机成长数据，用于资产感知（有成长数据时 3 格改为
  // 收藏 / 成长等级 / 离线安全舱，并显示防丢失提示）。档案变化经事件广播即时刷新，
  // 与 GrowthPanel 同一数据源、同一读取范式。
  useEffect(() => {
    const refresh = () => {
      try {
        const profile = loadGrowthProfile()
        const summary = growthSummary(profile)
        setGrowth({
          level: summary.level,
          totalXp: profile.totalXp,
          streak: summary.streak,
          freezeCards: profile.freezeCards,
        })
      } catch {
        setGrowth(null)
      }
    }
    refresh()
    window.addEventListener(GROWTH_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(GROWTH_UPDATED_EVENT, refresh)
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

  // 有成长数据（XP > 0 或连续访问 > 0）时，3 格改为收藏 / 成长等级 / 离线安全舱，
  // 并显示防丢失提示；无成长数据的新用户保持原 3 格。
  const hasGrowth = growth !== null && (growth.totalXp > 0 || growth.streak > 0)
  const lossPreventionText =
    hasGrowth && growth
      ? growth.freezeCards > 0
        ? `登录即可永久锁定当前 Lv.${growth.level} 成长记录、${growth.freezeCards} 张冻结卡与本机偏好，换设备自动合并`
        : `登录即可永久锁定当前 Lv.${growth.level} 成长记录与本机偏好，换设备自动合并`
      : null

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
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-base font-semibold tracking-tight">当前是匿名身份</h2>
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Local-First 离线安全舱
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyAnonId()}
                    title="匿名设备标识，用于排查问题或合并"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    ID: {anonId ? `${anonId.slice(0, 9)}…` : '…'}
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-400" aria-hidden />
                    ) : (
                      <Copy className="h-3 w-3" aria-hidden />
                    )}
                    <span>{copied ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                数据默认保存在本机，登录后可跨设备同步并自动合并匿名期间的收藏与画像。
              </p>
            </div>
          </div>

          {/* 本机资产速览条：有成长数据时突出成长等级与离线安全舱，否则保持原 3 格 */}
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
            {hasGrowth && growth ? (
              <div className="rounded-xl border border-border/60 bg-background/70 px-2.5 py-2">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
                  <span className="truncate">成长等级</span>
                </span>
                <p
                  className="mt-1 truncate text-base font-semibold tabular-nums leading-tight"
                  title={`Lv.${growth.level} · ${growth.totalXp} XP`}
                >
                  Lv.{growth.level} · {growth.totalXp} XP
                </p>
              </div>
            ) : (
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
            )}
            <div className="rounded-xl border border-border/60 bg-background/70 px-2.5 py-2">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                <span className="truncate">{hasGrowth ? '离线安全舱' : '离线占用'}</span>
              </span>
              <p className="mt-1 truncate text-base font-semibold tabular-nums leading-tight">
                {storageText ?? '检测中'}
              </p>
            </div>
          </div>

          {/* 安全背书：主文案人话化，点击展开技术细节；UUID 已收纳至右上角轻量标签 */}
          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setE2eeOpen((v) => !v)}
              aria-expanded={e2eeOpen}
              className="flex w-full items-center gap-1.5 rounded text-left text-[11px] font-medium text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-emerald-400"
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="flex-1">仅本机可见的端到端加密（E2EE）</span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-transform',
                  e2eeOpen && 'rotate-180',
                )}
                aria-hidden
              />
            </button>
            {e2eeOpen && (
              <p className="mt-1.5 pl-5 text-[11px] leading-relaxed text-muted-foreground">
                E2EE 端到端密钥受本机设备环境隔离
              </p>
            )}
          </div>
        </div>

        {lossPreventionText && (
          <p className="relative mt-3 flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{lossPreventionText}</span>
          </p>
        )}

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
