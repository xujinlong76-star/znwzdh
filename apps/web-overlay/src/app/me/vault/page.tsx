'use client'

/**
 * 云端金库（E2EE）管理页（第 5 批）。
 *
 * 只展示与操作「密文元信息」：加密与解密都在浏览器完成，主密码从不发往服务端。
 * 页面刻意不提供「查看内容」——服务端拿不到明文，前端也不该在管理页索取主密码。
 *
 * 三个动作：
 *   - 导出 / 导入加密备份：跳到收藏页已有的金库导出入口（同一套密文格式）；
 *   - 首页布局恢复：跳到模块化工作台；
 *   - 删除云端金库：两步确认；服务端区分「真删掉」与「本来就没有」，前端原样转述。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import {
  deleteCloudVault,
  fetchCloudVault,
  type CloudVaultData,
} from '@/lib/navhub-api'
import {
  AlertTriangle,
  ArrowRight,
  CloudOff,
  Download,
  KeyRound,
  Loader2,
  ShieldCheck,
  Upload,
} from 'lucide-react'

type ViewState = 'loading' | 'ready' | 'error'

function formatTime(ts: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

function cipherSize(payload: string): string {
  try {
    const bytes = new TextEncoder().encode(payload).length
    return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
  } catch {
    return '—'
  }
}

export default function VaultPage() {
  const { toast } = useToast()
  const identityReady = useIdentityReady()
  const [state, setState] = useState<ViewState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [vault, setVault] = useState<CloudVaultData | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async (identity: string) => {
    setState('loading')
    setError(null)
    let degraded = false
    const record = await fetchCloudVault(identity, () => {
      degraded = true
    })
    if (degraded) {
      setError('云端金库暂时取不到')
      setState('error')
      return
    }
    setVault(record)
    setState('ready')
  }, [])

  useEffect(() => {
    if (!identityReady.ready) return
    if (!identityReady.identity) {
      setState('ready')
      setVault(null)
      return
    }
    void load(identityReady.identity)
  }, [identityReady.ready, identityReady.identity, load])

  const handleDelete = useCallback(async () => {
    if (!identityReady.identity || deleting) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      const outcome = await deleteCloudVault(identityReady.identity)
      if (!outcome.ok) {
        toast({
          title: '删除云端金库失败',
          description: outcome.error || '请稍后重试',
          variant: 'destructive',
        })
        return
      }
      setConfirmDelete(false)
      if (outcome.deleted) {
        toast({
          title: '云端金库已删除',
          description: '服务端密文已移除；本机数据不受影响，下一次保存会重新上传。',
        })
      } else {
        // 服务端明确回答「本来就没有」：不能谎称「已删除」
        toast({ title: '云端本来就没有金库备份', description: '没有执行删除任何内容。' })
      }
      setVault(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, deleting, identityReady.identity, toast])

  const hasVault = Boolean(vault)

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="云端金库"
        icon={ShieldCheck}
        eyebrow="端到端加密"
        back={{ href: '/me', label: '用户中心' }}
        description="收藏夹密钥、首页布局等敏感数据以密文形式存储。主密码只在你的浏览器里使用，服务端只保存无法解开的密文。"
        actions={
          <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/favorites">
              金库导出 / 导入
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        }
      />

      {state === 'loading' && <SectionState variant="loading" rows={2} rowClassName="h-32" loadingLabel="正在读取云端金库状态" />}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="云端金库暂时取不到"
          description={error ?? '中枢暂时不可用，这不代表金库被删除。'}
          onRetry={() => void load(identityReady.identity ?? '')}
        />
      )}

      {state === 'ready' && (
        <div className="space-y-4 sm:space-y-5">
          <section aria-label="零知识说明" className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              零知识意味着什么
            </h2>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-xs leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
              <li className="break-words">加密与解密都在浏览器完成，主密码不离开本机，也不发往服务端。</li>
              <li className="break-words">服务端只保存密文与版本号，无法读取内容，也无法替你恢复。</li>
              <li className="break-words">忘记主密码等于无法解密：请保留一份自己的加密备份。</li>
            </ul>
          </section>

          {identityReady.isAnonymous && (
            <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
              当前是匿名身份：金库只绑定本浏览器。登录后会自动合并到账号，并在多设备间同步。
            </section>
          )}

          {hasVault ? (
            <section aria-label="金库状态" className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  云端已有一份加密备份
                </h2>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  已加密
                </span>
              </div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">版本</dt>
                  <dd className="mt-0.5 text-xs font-medium tabular-nums">v{vault?.version ?? 1}</dd>
                </div>
                <div className="min-w-0 rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">最近更新</dt>
                  <dd className="mt-0.5 truncate text-xs font-medium">{formatTime(vault?.updatedAt ?? 0)}</dd>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">密文大小</dt>
                  <dd className="mt-0.5 text-xs font-medium tabular-nums">{vault ? cipherSize(vault.payload) : '—'}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                管理页不展示密文内容；需要迁移或备份时，请从收藏页导出加密金库文件。
              </p>
            </section>
          ) : (
            <SectionState
              variant="empty"
              icon={CloudOff}
              title="云端还没有金库备份"
              description="在收藏页导出加密金库，或在首页保存布局后，这里会出现密文状态。"
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild size="sm" className="text-xs">
                    <Link href="/favorites">
                      <Download className="mr-2 h-3.5 w-3.5" />
                      去导出金库
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="text-xs">
                    <Link href="/custom">
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      打开工作台
                    </Link>
                  </Button>
                </div>
              }
            />
          )}

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <h2 className="text-sm font-semibold">迁移与备份</h2>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
                <Link href="/favorites">
                  <Download className="mr-2 h-3.5 w-3.5" />
                  导出加密金库
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
                <Link href="/favorites">
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  解密导入金库
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
                <Link href="/custom">首页布局工作台</Link>
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                删除云端金库
              </h2>
              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                不可逆
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              删除后服务端密文立即移除且无法恢复；本机数据不受影响，下一次保存会重新上传。
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                variant={confirmDelete ? 'destructive' : 'outline'}
                size="sm"
                className="w-full text-xs sm:w-auto"
                disabled={deleting || !hasVault}
                onClick={() => void handleDelete()}
              >
                {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                {confirmDelete ? '再次点击确认删除' : '删除云端金库'}
              </Button>
              {confirmDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs sm:w-auto"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  取消
                </Button>
              )}
            </div>
            {!hasVault && (
              <p className="mt-2 text-[11px] text-muted-foreground">云端当前没有备份，删除按钮不可用。</p>
            )}
          </section>
        </div>
      )}

      <Footer />
    </Container>
  )
}
