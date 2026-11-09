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
  Copy,
  Download,
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
  const { toast } = useToast()

  useEffect(() => {
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
      <section className="relative overflow-hidden rounded-2xl border border-dashed border-border/70 bg-card/60 p-4 shadow-sm backdrop-blur-sm sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LogIn className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight">当前是匿名身份</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Local-First 离线安全舱
              </span>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              收藏与画像已保存在本机（{favoritesCount} 个收藏，匿名标识{' '}
              <span className="font-mono">{anonId.slice(0, 14)}…</span>）。登录后可跨设备同步，并把本机匿名数据合并到账号。
            </p>

            {/* 完整匿名标识与复制 */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="text-[11px] text-muted-foreground">完整标识：</span>
              <code className="anon-badge max-w-full truncate rounded-md border border-border/60 bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-foreground/90 selection:bg-primary/20">
                {anonId}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyAnonId()}
                className="h-6 gap-1 px-2 text-[11px] hover:bg-muted"
                title="复制完整匿名标识到剪贴板"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 text-muted-foreground" />
                    <span>复制标识</span>
                  </>
                )}
              </Button>
            </div>

            {/* 存储健康度指示 */}
            <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <HardDrive className="h-3 w-3 text-primary/70" />
                本地离线占用：{storageText ?? '检测中...'}
              </span>
              <span className="text-border" aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-3 w-3" />
                E2EE 端到端密钥受设备环境隔离
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/auth/signin?callbackUrl=/me">登录 / 创建账号</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/favorites">查看本机收藏</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportLocalSnapshot}
            className="w-full text-xs sm:w-auto"
            title="将本机收藏、设置与匿名状态导出为 JSON 文件备份"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            导出本机快照 .json
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
