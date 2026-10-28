'use client'

/**
 * 同步与健康摘要：把概览里「不可见」的状态集中展示。
 * 只陈述可验证事实（画像更新时间、金库版本、AI 配置是否存在、设置更新时间），
 * 自检/修复动作放在账号页，避免概览页出现过重的操作区。
 *
 * 视觉（美化批次）：每行加状态点（实心=已启用、空心=未启用），
 * 「一眼扫出哪几项还是空的」取代逐行读文字。
 *
 * 空态引导：空心行在标签下补一行可聚焦跳转，把「尚未建立」这类死路
 * 换成「去哪一步能改变这个状态」；实心行不额外占高度，也不新增提示框。
 * 引导链接命中区下限 24px（WCAG 2.5.8 AA 的目标尺寸），11px 文字本身只有
 * 约 13px 高，靠 min-h 撑开而不用负 margin 叠压邻居——空态行因此略高于实心行。
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Activity, ArrowRight, Bot, CheckCircle2, CircleDashed, ShieldCheck, Sparkles, UserCheck } from 'lucide-react'
import type { Overview } from '@/lib/me-types'

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString('zh-CN')
  } catch {
    return '—'
  }
}

function Row({
  icon,
  label,
  value,
  ok,
  next,
}: {
  icon: React.ReactNode
  label: string
  value: string
  ok: boolean
  next?: { href: string; label: string }
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={
              ok
                ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500'
                : 'h-1.5 w-1.5 shrink-0 rounded-full border border-foreground/25'
            }
          />
          {icon}
          <span className="truncate">{label}</span>
        </span>
        {next && !ok ? (
          <span className="flex min-w-0 pl-3.5">
            <Link
              href={next.href}
              className="inline-flex min-h-6 items-center gap-1 rounded-sm text-[11px] text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {next.label}
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            </Link>
          </span>
        ) : null}
      </span>
      <span className={ok ? 'shrink-0 text-xs font-medium text-foreground' : 'shrink-0 text-xs text-muted-foreground'}>
        {value}
      </span>
    </li>
  )
}

export function SyncHealthCard({
  profile,
  vault,
  llmConfig,
  settingsUpdatedAt,
  aliases,
}: {
  profile: Overview['profile']
  vault: Overview['vault']
  llmConfig: Overview['llmConfig']
  settingsUpdatedAt: number
  aliases: string[]
}) {
  return (
    <section aria-label="同步与健康" className="flex h-full flex-col rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          同步与健康
        </h2>
        <Button asChild variant="outline" size="sm" className="text-xs">
          <Link href="/me/account">账户自检</Link>
        </Button>
      </div>
      <ul className="mt-2 flex-1 divide-y divide-border/60">
        <Row
          icon={<Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          label="个性化画像"
          value={profile.exists ? `更新于 ${formatDate(profile.updatedAt)}` : '尚未建立'}
          ok={profile.exists}
          next={{ href: '/', label: '去搜索或收藏，画像会自动形成' }}
        />
        <Row
          icon={<ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          label="E2EE 金库"
          value={vault.exists ? `版本 v${vault.version ?? 1}` : '未启用'}
          ok={vault.exists}
          next={{ href: '/me/vault', label: '看金库加密范围与备份' }}
        />
        <Row
          icon={<Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          label="个人 AI 配置"
          value={llmConfig.exists ? '已配置' : '跟随系统默认'}
          ok={llmConfig.exists}
          next={{ href: '/preferences', label: '填自己的模型与密钥' }}
        />
        <Row
          icon={<UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          label="已合并匿名身份"
          value={aliases.length > 0 ? `${aliases.length} 个` : '无'}
          ok={aliases.length > 0}
          next={{ href: '/me/data', label: '把本机匿名数据并入账号' }}
        />
        <Row
          icon={<CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          label="偏好设置"
          value={settingsUpdatedAt ? `更新于 ${formatDate(settingsUpdatedAt)}` : '使用默认值'}
          ok={Boolean(settingsUpdatedAt)}
          next={{ href: '/me/settings', label: '改任一开关即写入' }}
        />
      </ul>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        以上状态来自云端最近一次写入；断网时可能滞后，不代表数据丢失。
      </p>
    </section>
  )
}
