'use client'

/**
 * 数据主权：导出全部个人数据 / 注销并删除云端数据。
 *
 * 两个动作都走 BFF `/api/me/*`（会话签名身份），不接受客户端自报 userId。
 * 删除是不可逆操作：必须输入 DELETE 才能解锁按钮，且成功后提示本地缓存的处理方式。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { AlertTriangle, ArrowLeft, CheckCircle2, Database, Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react'

type ViewState = 'loading' | 'anonymous' | 'ready' | 'deleted'

export default function MeDataPage() {
  const { toast } = useToast()
  const favorites = useFavorites()
  const [state, setState] = useState<ViewState>('loading')
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' })
        const session = (await res.json().catch(() => ({}))) as { user?: { id?: string } }
        if (!alive) return
        setState(session?.user?.id ? 'ready' : 'anonymous')
      } catch {
        if (alive) setState('anonymous')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const handleExport = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      const res = await fetch('/api/me/export', { cache: 'no-store' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: '导出已开始下载', description: 'JSON 内不含 LLM 明文密钥与金库密文。' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [toast])

  const handleDelete = useCallback(async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || '删除失败')
      // 云端已清空：本机收藏缓存一并清掉，避免下次同步又把旧数据推回云端
      favorites.clear()
      setState('deleted')
      toast({ title: '云端数据已删除', description: '登录账号保留，重新登录后是空账号。' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }, [confirmText, favorites, toast])

  return (
    <Container as="main" id="main-content" className="py-4 sm:py-8 space-y-5">
      <section className="rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
              <Link href="/me">
                <ArrowLeft className="mr-1 h-4 w-4" />
                用户中心
              </Link>
            </Button>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              数据与隐私
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          你的收藏、搜索历史、画像、LLM 配置与金库元信息都归你所有：可以随时导出，也可以一次性删除。
        </p>
      </section>

      {state === 'loading' && (
        <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card/50" aria-busy="true" />
      )}

      {state === 'anonymous' && (
        <section className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 space-y-3">
          <p className="text-sm font-semibold">需要登录后管理云端数据</p>
          <p className="text-xs text-muted-foreground">
            匿名数据只保存在本机浏览器；登录后可导出与删除云端数据，也能把本机匿名数据合并到账号。
          </p>
          <Button asChild size="sm" className="text-xs">
            <Link href="/auth/signin?callbackUrl=/me/data">登录 / 创建账号</Link>
          </Button>
        </section>
      )}

      {state === 'deleted' && (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold">云端数据已删除</p>
              <p className="mt-1 text-xs text-muted-foreground">
                收藏、历史、画像、LLM 配置、金库元信息与插件安装记录均已清除，登录账号本身保留。
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 text-xs">
                <Link href="/me">返回用户中心</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {state === 'ready' && (
        <>
          {error && (
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
              {error}
            </section>
          )}

          <section className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">导出我的数据</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              包含收藏与文件夹、搜索历史、画像、设置、插件安装记录、金库版本信息。LLM 配置只保留模型与地址，
              不含密钥；金库只导出加密后的元信息。
            </p>
            <Button size="sm" className="text-xs" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
              下载 JSON
            </Button>
          </section>

          <section className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">数据说明</h2>
            </div>
            <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
              <li>收藏与文件夹：删除后不可恢复，本机收藏缓存也会清空。</li>
              <li>搜索历史与行为事件：画像会随之清空，之后按新行为重新积累。</li>
              <li>LLM 配置：个人模型密钥（加密存储）一并删除，系统回退到全局配置。</li>
              <li>插件安装与星标：安装记录清除，已安装的插件页面不受影响。</li>
              <li>登录账号保留：NextAuth 会话仍然有效，重新登录后是空账号。</li>
            </ul>
          </section>

          <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h2 className="text-sm font-semibold text-destructive">删除全部云端数据</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              这是不可逆操作。输入 <span className="font-mono font-semibold text-destructive">DELETE</span> 解锁按钮。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="输入 DELETE"
                className="h-8 w-40 text-xs"
                aria-label="删除确认"
              />
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                disabled={deleting || confirmText.trim().toUpperCase() !== 'DELETE'}
                onClick={() => void handleDelete()}
              >
                {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                永久删除
              </Button>
            </div>
          </section>
        </>
      )}

      <Footer />
    </Container>
  )
}
