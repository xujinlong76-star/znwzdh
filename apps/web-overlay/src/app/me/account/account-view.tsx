'use client'

/**
 * 「账号与身份」页：资料编辑、身份说明、匿名合并结果、账户数据自检。
 *
 * 身份与资料都走既有 BFF：`GET /api/me` 取概览，`PATCH /api/me/profile` 保存资料，
 * `POST /api/me/diagnostics` 做云端 + 本机联合自检。匿名合并由 SessionSync 自动
 * 幂等完成，这里只展示已合并数量与机制说明，不提供手动合并按钮。
 */
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { useMeOverview } from '@/hooks/use-me-overview'
import type { Overview } from '@/app/me/me-view'
import {
  runClientStorageDiagnostics,
  type DiagnosticCheckItem,
} from '@/lib/user-settings'
import { Activity, CheckCircle2, Edit3, KeyRound, Loader2, ShieldCheck, User, XCircle } from 'lucide-react'

export function AccountView() {
  const { toast } = useToast()
  const { state, overview, error, reload } = useMeOverview()
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState('')
  const [avatar, setAvatar] = useState('')
  const [saving, setSaving] = useState(false)
  const [diagRunning, setDiagRunning] = useState(false)
  const [diagChecks, setDiagChecks] = useState<DiagnosticCheckItem[] | null>(null)
  const [diagRepaired, setDiagRepaired] = useState(0)

  const startEdit = useCallback((data: Overview) => {
    setUsername(data.user?.username ?? '')
    setAvatar(data.user?.avatar ?? '')
    setEditing(true)
  }, [])

  const saveProfile = useCallback(async () => {
    if (!overview || saving) return
    const trimmedName = username.trim()
    if (!trimmedName || trimmedName.length > 40) {
      toast({ title: '昵称长度需在 1 ~ 40 个字符之间', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmedName, avatar: avatar.trim() || null }),
        cache: 'no-store',
      })
      let data: { ok?: boolean; user?: Overview['user']; error?: string } = {}
      try {
        data = (await res.json()) as typeof data
      } catch {
        // 非 JSON 错误响应：交给下方 !res.ok 分支提示
      }
      if (!res.ok || !data.user) throw new Error(data.error || '更新个人资料失败')
      setEditing(false)
      toast({ title: '个人资料已更新' })
      await reload()
    } catch (err) {
      toast({
        title: '更新个人资料失败',
        description: err instanceof Error ? err.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [avatar, overview, reload, saving, toast, username])

  const runDiagnostics = useCallback(async () => {
    if (diagRunning || !overview) return
    setDiagRunning(true)
    try {
      const clientReport = runClientStorageDiagnostics()
      const combined: DiagnosticCheckItem[] = [...clientReport.checks]
      let totalRepaired = clientReport.repairedCount

      const res = await fetch('/api/me/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })
      if (res.ok) {
        const cloud = (await res.json()) as { repairedCount?: number; checks?: DiagnosticCheckItem[] }
        if (Array.isArray(cloud.checks)) combined.push(...cloud.checks)
        totalRepaired += Number(cloud.repairedCount ?? 0)
      }

      setDiagChecks(combined)
      setDiagRepaired(totalRepaired)
      toast({
        title: totalRepaired > 0 ? `自检完成：已自动修复 ${totalRepaired} 项异常` : '健康自检通过：0 项异常',
        description: '本机存储结构、偏好设置与云端数据引用均已核验一致。',
      })
    } catch {
      toast({ title: '自检执行失败', description: '请稍后重试', variant: 'destructive' })
    } finally {
      setDiagRunning(false)
    }
  }, [diagRunning, overview, toast])

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="账号与身份"
        icon={User}
        eyebrow="账户"
        back={{ href: '/me', label: '用户中心' }}
        description="修改展示资料、查看身份与匿名数据合并结果，并对账户数据做一次联合自检。"
      />

      {state === 'loading' && (
        <div aria-busy="true" className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl border border-border/70 bg-card/50" />
          <div className="h-28 animate-pulse rounded-2xl border border-border/70 bg-card/50" />
        </div>
      )}

      {state === 'error' && (
        <section className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-6" role="alert">
          <p className="text-sm font-semibold">账号信息暂时取不到</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {error ?? '这不代表账号异常，稍后重试即可。'}
          </p>
          <Button size="sm" variant="outline" className="w-full text-xs sm:w-auto" onClick={() => void reload()}>
            重试
          </Button>
        </section>
      )}

      {state === 'anonymous' && (
        <section className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 sm:p-6">
          <p className="text-sm font-semibold">当前是匿名身份</p>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            匿名数据只保存在本机浏览器；登录后会自动合并到账号，并支持跨设备同步。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild size="sm" className="w-full text-xs sm:w-auto">
              <Link href="/auth/signin?callbackUrl=/me/account">登录 / 创建账号</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
              <Link href="/favorites">查看本机收藏</Link>
            </Button>
          </div>
        </section>
      )}

      {state === 'ready' && overview && (
        <div className="space-y-4 sm:space-y-5">
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Edit3 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  展示资料
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  昵称用于账号展示；头像支持 https:// 或站内 / 路径。
                </p>
              </div>
              {!editing && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => startEdit(overview)}
                >
                  编辑资料
                </Button>
              )}
            </div>

            {!editing ? (
              <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">昵称</dt>
                  <dd className="mt-0.5 truncate text-xs font-medium">{overview.user?.username ?? '—'}</dd>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">邮箱</dt>
                  <dd className="mt-0.5 truncate text-xs font-medium">{overview.user?.email ?? '未绑定'}</dd>
                </div>
                <div className="min-w-0 rounded-xl border border-border/60 bg-background/50 px-3 py-2 sm:col-span-2">
                  <dt className="text-[11px] text-muted-foreground">头像</dt>
                  <dd className="mt-0.5 truncate text-xs font-medium" title={overview.user?.avatar ?? undefined}>
                    {overview.user?.avatar ?? '未设置'}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="account-username" className="block text-xs font-medium text-muted-foreground">
                    昵称
                  </label>
                  <Input
                    id="account-username"
                    value={username}
                    maxLength={40}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="account-avatar" className="block text-xs font-medium text-muted-foreground">
                    头像 URL
                  </label>
                  <Input
                    id="account-avatar"
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value)}
                    placeholder="https://example.com/avatar.png"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button size="sm" className="text-xs" disabled={saving} onClick={() => void saveProfile()}>
                    {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    保存资料
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              身份与匿名数据
            </h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">当前身份</dt>
                <dd className="min-w-0 truncate font-mono text-[11px]" title={overview.identity}>
                  {overview.identity}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">身份来源</dt>
                <dd className="font-medium">{overview.user?.source ?? 'local'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">已合并匿名身份</dt>
                <dd className="font-medium">{overview.aliases.length} 个</dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              登录后本机匿名收藏、历史与画像会自动合并到账号（幂等，只执行一次）。合并结果会体现在上方数量与最近操作里。
            </p>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Activity className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  账户数据自检
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">本机存储结构 + 云端数据引用联合校验</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={diagRunning}
                onClick={() => void runDiagnostics()}
              >
                {diagRunning ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                {diagRunning ? '自检中…' : '开始自检'}
              </Button>
            </div>

            {diagChecks && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  {diagChecks.length} 项检查 · 自动修复 {diagRepaired} 项
                </p>
                <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                  {diagChecks.map((check) => (
                    <li key={check.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                      <span className="flex min-w-0 items-start gap-2">
                        {check.status === 'failed' ? (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                        ) : (
                          <CheckCircle2
                            className={
                              check.status === 'repaired'
                                ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500'
                                : 'mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500'
                            }
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block break-words font-medium">{check.label}</span>
                          <span className="block break-words text-[11px] text-muted-foreground">{check.detail}</span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              账号数据
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              导出全部个人数据、或永久删除云端数据都在「数据与隐私」页，删除前需要输入 DELETE 二次确认。
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3 text-xs">
              <Link href="/me/data">前往数据与隐私</Link>
            </Button>
          </section>
        </div>
      )}

      <Footer />
    </Container>
  )
}
