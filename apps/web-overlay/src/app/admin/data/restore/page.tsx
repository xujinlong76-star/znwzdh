'use client'

/**
 * 管理端：冷备恢复。
 *
 * 存在的理由：`POST /api/backup/restore` 上线至今**没有前端入口**，
 * 恢复只能手工 curl。后果不只是「不方便」——一个没人从界面上走过的功能，
 * 它的预演文案、错误提示、耗时表现都没人验证过（本轮就是靠压测才发现
 * 5 万条会超过代理超时）。
 *
 * 交互刻意分成三步，而不是「选文件 → 直接恢复」：
 *   1. 本地解析：立刻告诉用户「这个包里有几个分类、几个站点」，解析失败当场报；
 *   2. 预演（服务端 dryRun）：算出真正会新增多少、跳过多少（重复/非法 URL）；
 *   3. 执行：必须先勾选确认，才能点。恢复是整库写操作，不能一步到位。
 *
 * 为什么不自动在选文件后跑预演：预演也是一次完整校验（要读全库 URL 集合），
 * 用户可能只是想看看包里是什么。给一个显式按钮更符合预期，也避免误触。
 */

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, DatabaseBackup, FileJson, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/registry/new-york/ui/checkbox'
import { hubSend } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'

/** 冷备包最小结构（够判断「这是不是一个 NavHub 备份」即可，完整校验在服务端） */
interface ParsedBackup {
  version?: string
  generator?: string
  exportedAt?: number
  categories: unknown[]
  sites: unknown[]
}

interface DryRunResult {
  wouldRestore: { categories: number; sites: number }
  skipped: { duplicateCategories: number; invalidUrls: number; duplicateUrls: number }
  sample: { categories: string[]; sites: string[] }
  message: string
}

interface RestoreResult {
  message: string
  restored: { categories: number; sites: number }
  durationMs?: number
  reindexQueued?: boolean
}

/** 服务端只回错误类别（不回原始报错，避免泄漏备份里的具体值） */
const REASON_TEXT: Record<string, string> = {
  duplicate_key: '备份里有重复的主键（同一分类或站点出现了多次）',
  foreign_key: '备份引用了不存在的关联对象',
  not_null: '备份里有条目缺少必填字段',
  schema: '备份结构与当前数据库版本不匹配',
  unknown: '未知错误，请查看服务端日志',
}

function reasonText(reason: unknown): string {
  if (typeof reason !== 'string') return REASON_TEXT.unknown
  return REASON_TEXT[reason] ?? `未知错误（${reason}）`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

type Busy = 'preview' | 'restore' | null

export default function RestoreBackupPage() {
  const [fileName, setFileName] = useState<string>('')
  const [fileBytes, setFileBytes] = useState<number>(0)
  const [backup, setBackup] = useState<ParsedBackup | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<DryRunResult | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failureReason, setFailureReason] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)

  const resetDownstream = useCallback(() => {
    setPreview(null)
    setResult(null)
    setError(null)
    setFailureReason(null)
    setConfirmed(false)
  }, [])

  const handleFile = useCallback(
    async (file: File | undefined) => {
      resetDownstream()
      setBackup(null)
      setParseError(null)
      setFileName('')
      setFileBytes(0)
      if (!file) return

      setFileName(file.name)
      setFileBytes(file.size)
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的 JSON 对象')
        if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.sites)) {
          // 与服务端同一条判据：缺数组就是错的包，别让它走到预演
          throw new Error('缺少 categories 或 sites 数组，可能不是 NavHub 冷备包')
        }
        setBackup({
          version: typeof parsed.version === 'string' ? parsed.version : undefined,
          generator: typeof parsed.generator === 'string' ? parsed.generator : undefined,
          exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : undefined,
          categories: parsed.categories as unknown[],
          sites: parsed.sites as unknown[],
        })
      } catch (err) {
        setParseError(err instanceof Error ? err.message : '文件读取失败')
      }
    },
    [resetDownstream],
  )

  const runPreview = useCallback(async () => {
    if (!backup) return
    setBusy('preview')
    setError(null)
    setFailureReason(null)
    setResult(null)
    try {
      const data = await hubSend<DryRunResult>('/api/backup/restore?dryRun=true', 'POST', backup)
      setPreview(data)
    } catch (err) {
      setError(describeDegrade(err).message)
    } finally {
      setBusy(null)
    }
  }, [backup])

  const runRestore = useCallback(async () => {
    if (!backup || !preview || !confirmed) return
    setBusy('restore')
    setError(null)
    setFailureReason(null)
    try {
      const data = await hubSend<RestoreResult>('/api/backup/restore?dryRun=false', 'POST', backup)
      setResult(data)
    } catch (err) {
      // 409 上带的是「类别」而不是原始报错，尽量把它翻成人话
      const message = describeDegrade(err).message
      setError(message)
      const reason = (err as { payload?: { reason?: string } })?.payload?.reason
      setFailureReason(reason ? reasonText(reason) : null)
    } finally {
      setBusy(null)
    }
  }, [backup, preview, confirmed])

  const exportedAtText = useMemo(() => {
    if (!backup?.exportedAt) return null
    const date = new Date(backup.exportedAt)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString('zh-CN')
  }, [backup])

  const canPreview = Boolean(backup) && busy === null
  const canRestore = Boolean(backup && preview && confirmed) && busy === null

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-semibold">恢复冷备</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          从 <code className="rounded bg-muted px-1">.nhbak.json</code> 冷备包恢复分类与站点。
          恢复会写入整库，建议先在「导出」页留一份当前数据的备份。
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-500">这是整库写操作</p>
          <p className="text-muted-foreground">
            已有 URL 会被跳过（不会覆盖），但新增条目会直接落库。中途失败会整体回滚，不留半套数据。
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · 选择备份文件</CardTitle>
          <CardDescription>本地解析，不会上传；点「预演」才会发给服务端</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="backup-file" className="text-sm font-medium">
              冷备包（JSON）
            </label>
            <input
              id="backup-file"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void handleFile(event.target.files?.[0])}
              className="block w-full cursor-pointer rounded-md border border-border bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
          </div>

          {parseError && (
            <p className="text-sm text-destructive" role="alert">
              解析失败：{parseError}
            </p>
          )}

          {backup && (
            <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">文件</dt>
                <dd className="truncate font-medium" title={fileName}>
                  {fileName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">大小</dt>
                <dd className="font-medium">{formatBytes(fileBytes)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">分类 / 站点</dt>
                <dd className="font-medium">
                  {backup.categories.length} / {backup.sites.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">导出时间</dt>
                <dd className="font-medium">{exportedAtText ?? '未标注'}</dd>
              </div>
            </dl>
          )}

          <Button onClick={() => void runPreview()} disabled={!canPreview}>
            {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileJson className="mr-2 h-4 w-4" aria-hidden />}
            {busy === 'preview' ? '预演中…' : '预演（不写库）'}
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · 预演结果</CardTitle>
            <CardDescription>{preview.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="将新增分类" value={preview.wouldRestore.categories} />
              <Stat label="将新增站点" value={preview.wouldRestore.sites} tone="primary" />
              <Stat label="重复分类" value={preview.skipped.duplicateCategories} muted />
              <Stat label="重复 URL" value={preview.skipped.duplicateUrls} muted />
            </div>

            {preview.skipped.invalidUrls > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-500">
                另有 {preview.skipped.invalidUrls} 条 URL 非法（不是 http/https），会被跳过。
              </p>
            )}

            {preview.sample.sites.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  查看前 {preview.sample.sites.length} 条样例
                </summary>
                <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                  {preview.sample.categories.map((title) => (
                    <li key={`cat-${title}`}>分类 · {title}</li>
                  ))}
                  {preview.sample.sites.map((url) => (
                    <li key={url} className="truncate">
                      站点 · {url}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-restore"
                  checked={confirmed}
                  onCheckedChange={(value: boolean | 'indeterminate') => setConfirmed(value === true)}
                />
                <label htmlFor="confirm-restore" className="text-sm leading-snug">
                  我确认要把 {preview.wouldRestore.sites} 个站点写入当前库，并已导出过现有数据
                </label>
              </div>
              <Button variant="destructive" onClick={() => void runRestore()} disabled={!canRestore}>
                {busy === 'restore' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <DatabaseBackup className="mr-2 h-4 w-4" aria-hidden />
                )}
                {busy === 'restore' ? '恢复中…（大包可能需要几十秒）' : '执行恢复'}
              </Button>
              {preview.wouldRestore.sites > 5000 && (
                <p className="text-xs text-muted-foreground">
                  条目超过 5000 时，请求可能接近代理超时上限；若失败请重试（恢复是幂等的，已导入的会被跳过）。
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="space-y-2 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive" role="alert">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              恢复失败，已整体回滚
            </p>
            <p className="text-sm text-muted-foreground">{error}</p>
            {failureReason && <p className="text-sm text-muted-foreground">原因：{failureReason}</p>}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-500/40">
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {result.message}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="新增分类" value={result.restored.categories} />
              <Stat label="新增站点" value={result.restored.sites} tone="primary" />
              <Stat label="耗时" value={result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : '—'} muted />
            </div>
            {result.reindexQueued && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                语义索引正在后台重建；在此之前，新恢复的站点可通过全文与拼音检索命中。
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  muted,
}: {
  label: string
  value: number | string
  tone?: 'primary'
  muted?: boolean
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === 'primary'
            ? 'text-lg font-semibold text-primary'
            : muted
              ? 'text-lg font-semibold text-muted-foreground'
              : 'text-lg font-semibold'
        }
      >
        {value}
      </div>
    </div>
  )
}
