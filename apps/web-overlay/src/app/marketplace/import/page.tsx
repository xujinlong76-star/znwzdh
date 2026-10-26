'use client'

/**
 * 插件导入向导：把跨实例互传的 `.navhub-plugin.json` 文件导入本机市场。
 *
 * 与「社区发布」（/marketplace/publish → 待审队列）的区别：
 *   - 导入是用户对自己实例的直接操作，导入即上架（source=import）；
 *   - 同名插件已存在时中枢返回 409，绝不静默覆盖已有版本。
 *
 * 文件获取途径：其他实例的插件详情页提供「导出清单文件」下载按钮（双通道分发）。
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { getIdentity } from '@/lib/identity'
import { importPlugin, installPlugin } from '@/lib/navhub-api'
import { setActiveTheme } from '@/lib/plugins/theme-runtime'
import { stageWorkspacePreset } from '@/lib/plugins/preset-staging'
import { ArrowLeft, FileUp, Loader2, Upload, Globe } from 'lucide-react'

export default function MarketplaceImportPage() {
  const { toast } = useToast()
  const identity = useMemo(() => getIdentity(), [])
  const [jsonText, setJsonText] = useState('')
  const [fileName, setFileName] = useState('')
  const [slug, setSlug] = useState('')
  const [installNow, setInstallNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ slug: string; name: string; installed: boolean } | null>(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [fetchingUrl, setFetchingUrl] = useState(false)

  const handleFetchRemoteUrl = async () => {
    let url = remoteUrl.trim()
    if (!url) return
    if (url.includes('github.com/') && url.includes('/blob/')) {
      url = url.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/')
    }
    setFetchingUrl(true)
    setError(null)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} 读取失败`)
      const text = await res.text()
      JSON.parse(text)
      setJsonText(text)
      setFileName(url.split('/').pop() || 'remote-plugin.json')
      toast({ title: '清单读取成功', description: '已成功获取远程清单并填入，请检查后上架' })
    } catch (err: any) {
      setError(err?.message || '无法从指定 URL 读取有效 JSON 清单')
    } finally {
      setFetchingUrl(false)
    }
  }

  const onPickFile = async (file: File | null | undefined) => {
    if (!file) return
    setFileName(file.name)
    setError(null)
    try {
      setJsonText(await file.text())
    } catch {
      setError('文件读取失败，请重试或直接粘贴 JSON 内容')
    }
  }

  const handleImport = async () => {
    setError(null)
    setResult(null)
    let manifest: unknown
    try {
      manifest = JSON.parse(jsonText)
    } catch {
      setError('JSON 无法解析：请确认内容是完整的插件清单文件')
      return
    }
    setBusy(true)
    try {
      const res = (await importPlugin(manifest, slug.trim() || undefined, identity)) as unknown as {
        slug?: string
        name?: string
      }
      const importedSlug = res?.slug ?? ''
      const importedName = res?.name ?? '插件'
      let installed = false
      if (installNow && importedSlug) {
        try {
          await installPlugin(importedSlug, identity)
          // 客户端消费（与详情页安装弹窗同语义）：theme 立即激活；
          // workspace-preset 暂存，由 /custom 工作台画布消费后自动落进布局
          const meta = manifest as { kind?: string; payload?: any }
          if (meta?.kind === 'theme') {
            setActiveTheme({
              slug: importedSlug,
              name: importedName,
              tokens: meta.payload?.tokens,
              accent: meta.payload?.accent,
            })
          } else if (meta?.kind === 'workspace-preset' && meta.payload) {
            stageWorkspacePreset(importedSlug, importedName, meta.payload)
          }
          installed = true
        } catch (installError) {
          // 上架已经成功了：安装失败只是差最后一步，提示用户去详情页手动补装
          toast({
            title: '已导入，但自动安装未完成',
            description: (installError as Error)?.message ?? '请到插件详情页手动安装',
            variant: 'destructive',
          })
        }
      }
      setResult({ slug: importedSlug, name: importedName, installed })
      toast({ title: '导入成功', description: `「${importedName}」已直接上架` })
    } catch (err) {
      setError((err as Error)?.message ?? '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6 max-w-3xl mx-auto">
        {/* 顶部展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero p-6 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回插件市场</span>
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
            <FileUp className="w-6 h-6 text-primary shrink-0" />
            导入插件文件
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
            选择或粘贴来自其他山羊胡实例的
            <code className="mx-1 px-1 py-0.5 rounded bg-muted/70 text-[11px] font-mono">.navhub-plugin.json</code>
            文件。导入的插件会直接上架到本机市场（同名插件已存在时会被拒绝，不会覆盖）。
          </p>
        </div>

        {/* 文件选择 */}
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-input bg-background text-sm cursor-pointer hover:bg-accent transition-colors">
              <Upload className="w-4 h-4" />
              选择 .json 文件
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0])}
              />
            </label>
            {fileName && <span className="text-xs text-muted-foreground font-mono">{fileName}</span>}
          </div>

          {/* GitHub / Remote URL Import */}
          <div className="p-3.5 rounded-xl border border-border/60 bg-background/50 space-y-2">
            <span className="text-xs font-medium text-foreground block">
              或从 GitHub / 远程 URL 直接抓取清单
            </span>
            <div className="flex gap-2">
              <input
                type="url"
                // 可访问名取上方那行可见文字（"或从 GitHub / 远程 URL 直接抓取清单"）：
                // placeholder 是**示例**而不是名字，读屏进去只会念「编辑框」。
                aria-label="清单文件的远程 URL 或 GitHub 链接"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://raw.githubusercontent.com/.../plugin.json 或 GitHub 文件链接"
                className="flex-1 h-8.5 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={fetchingUrl || !remoteUrl.trim()}
                onClick={handleFetchRemoteUrl}
                className="h-8.5 text-xs px-3 shrink-0"
              >
                {fetchingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Globe className="w-3.5 h-3.5 mr-1" />}
                读取清单
              </Button>
            </div>
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">或者直接粘贴 JSON 内容</summary>
            <textarea
              aria-label="插件清单 JSON"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{"manifestVersion":1,"kind":"site-pack","name":"我的收藏包",...}'
              className="mt-2 w-full min-h-40 rounded-lg border border-input bg-background p-3 text-base sm:text-xs font-mono leading-relaxed"
            />
          </details>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">自定义 slug（可选，留空自动生成）</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-site-pack"
                className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-base sm:text-sm font-mono"
              />
            </label>
            <label className="flex items-end gap-2 text-xs pb-1.5">
              <input
                type="checkbox"
                checked={installNow}
                onChange={(e) => setInstallNow(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span>导入后立即安装</span>
            </label>
          </div>

          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 leading-relaxed">
              导入失败：{error}
            </p>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                「{result.name}」已导入并上架{result.installed ? '，且已完成安装' : ''}。
              </p>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                  <Link href={`/marketplace/${encodeURIComponent(result.slug)}`}>查看详情</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setResult(null)
                    setJsonText('')
                    setFileName('')
                    setSlug('')
                  }}
                >
                  再导入一个
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={() => void handleImport()} disabled={busy || !jsonText.trim()} className="gap-1.5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              导入并上架
            </Button>
            <span className="text-[11px] text-muted-foreground">
              清单会先经过契约校验，非法内容会被拒绝并说明原因
            </span>
          </div>
        </div>

        <Footer />
      </div>
    </Container>
  )
}
