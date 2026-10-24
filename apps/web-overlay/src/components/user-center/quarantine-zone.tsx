'use client'

/**
 * 本机隔离区：自检/收藏写入留下的坏数据原文，给出「看见 → 对照 → 找回 → 清理」的完整出口。
 *
 * 为什么必须有这一块：巡检文案承诺「原文已整份留档，可在数据与隐私里对照找回」。
 * 留档本身只是把字节抄进另一个键，如果没有入口列出它们，用户唯一的取回方式就是
 * 打开 DevTools —— 那句承诺等于界面在说假话。
 *
 * 三条硬约束：
 * 1. 只在客户端读：`localStorage` 在服务端不存在，首帧必须与 SSR 一致（先不渲染，挂载后再取）；
 * 2. 恢复只走「合并」不走「替换」：坏数据里能解析出来的条目并回当前收藏，
 *    绝不因为恢复动作把用户现在好好在用的收藏覆盖掉；
 * 3. 删除需要点两次：这些副本是用户最后的原始字节，误删的成本远高于多一次点击。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { FAVORITES_STORAGE_KEY } from '@/lib/favorites-storage'
import {
  USER_SETTINGS_STORAGE_KEY,
  deleteQuarantineCopy,
  listQuarantineCopies,
  readQuarantineBytes,
  type QuarantineCopy,
} from '@/lib/user-settings'
import { Archive, Download, Eye, Loader2, RotateCcw, Trash2, X } from 'lucide-react'

/** 内联预览的字符上限：原文可能是几 MB，直接塞进 DOM 会把页面卡死 */
const PREVIEW_CHARS = 4000

function baseKeyLabel(baseKey: string): string {
  if (baseKey === FAVORITES_STORAGE_KEY) return '本机收藏'
  if (baseKey === USER_SETTINGS_STORAGE_KEY) return '偏好设置'
  return baseKey
}

function formatSavedAt(savedAt: number | null): string {
  if (savedAt === null) return '时间未知'
  try {
    return new Date(savedAt).toLocaleString()
  } catch {
    return '时间未知'
  }
}

export function QuarantineZone() {
  const { toast } = useToast()
  const favorites = useFavorites()
  const [copies, setCopies] = useState<QuarantineCopy[]>([])
  const [mounted, setMounted] = useState(false)
  const [viewingKey, setViewingKey] = useState<string | null>(null)
  const [viewingText, setViewingText] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setCopies(listQuarantineCopies())
  }, [])

  useEffect(() => {
    setMounted(true)
    refresh()
  }, [refresh])

  const closePreview = useCallback(() => {
    setViewingKey(null)
    setViewingText(null)
  }, [])

  const togglePreview = useCallback(
    (key: string) => {
      if (viewingKey === key) {
        closePreview()
        return
      }
      const raw = readQuarantineBytes(key)
      if (raw === null) {
        toast({
          title: '这份原文读不出来',
          description: '浏览器不允许访问本地存储（隐私模式或权限被拒）。原文仍留在机器上，没有删除。',
          variant: 'destructive',
        })
        return
      }
      setViewingKey(key)
      setViewingText(raw)
    },
    [closePreview, toast, viewingKey],
  )

  const handleDownload = useCallback(
    (copy: QuarantineCopy) => {
      const raw = readQuarantineBytes(copy.key)
      if (raw === null) {
        toast({ title: '下载失败：原文读不出来', variant: 'destructive' })
        return
      }
      const blob = new Blob([raw], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${copy.baseKey}.corrupt-${copy.savedAt ?? 'unknown'}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    [toast],
  )

  const handleRestore = useCallback(
    (copy: QuarantineCopy) => {
      const raw = readQuarantineBytes(copy.key)
      if (raw === null) {
        toast({ title: '恢复失败：原文读不出来', variant: 'destructive' })
        return
      }
      setBusyKey(copy.key)
      const result = favorites.importJson(raw)
      setBusyKey(null)
      if (!result.ok) {
        toast({
          title: '这份隔离数据没能并回收藏',
          description: result.error ?? '存储不可用（隐私模式或配额已满），原副本保留。',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: result.imported > 0 ? `已并回 ${result.imported} 条收藏` : '这份隔离数据里没有可并回的收藏',
        description:
          '按站点去重合并，现有收藏不会因此被删除；' +
          (result.skippedInvalid > 0 ? `另有 ${result.skippedInvalid} 条缺少站点标识或链接，未能并回；` : '') +
          '副本仍保留在隔离区，确认无误后可手动删除。',
      })
    },
    [favorites, toast],
  )

  const handleDelete = useCallback(
    (copy: QuarantineCopy) => {
      if (pendingDelete !== copy.key) {
        setPendingDelete(copy.key)
        return
      }
      setBusyKey(copy.key)
      const ok = deleteQuarantineCopy(copy.key)
      setBusyKey(null)
      setPendingDelete(null)
      if (!ok) {
        toast({
          title: '删除失败',
          description: '浏览器不允许写删本地存储（隐私模式或权限被拒），副本原样保留。',
          variant: 'destructive',
        })
        refresh()
        return
      }
      if (viewingKey === copy.key) closePreview()
      toast({ title: '隔离副本已删除', description: '这份原文已从本机移除，无法再找回。' })
      refresh()
    },
    [closePreview, pendingDelete, refresh, toast, viewingKey],
  )

  // 挂载前不渲染：服务端拿不到 localStorage，渲染「没有副本」会把空态谎报给 SSR 首帧。
  if (!mounted || copies.length === 0) return null

  return (
    <section
      aria-label="本机隔离数据副本"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Archive className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          本机隔离区
        </h2>
        <span className="text-[11px] text-muted-foreground">{copies.length} 份原文副本 · 仅存于这台设备</span>
      </div>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
        数据读不出来时，原文会整份留到这里的副本键下，主键不会被自动改写。可以先下载或展开对照，
        确认能解析的收藏再并回当前列表。
      </p>

      <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background/40">
        {copies.map((copy) => {
          const isViewing = viewingKey === copy.key
          return (
            <li key={copy.key} className="px-3 py-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-xs font-medium">{baseKeyLabel(copy.baseKey)}原文副本</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {formatSavedAt(copy.savedAt)} · {copy.chars.toLocaleString()} 字符 ·{' '}
                    <span className="break-all font-mono">{copy.key}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {copy.restorable ? '可解析：能直接并回本机收藏' : '仅存档：这份原文仍解析不出来，只能下载后人工处理'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    aria-expanded={isViewing}
                    onClick={() => togglePreview(copy.key)}
                  >
                    {isViewing ? <X className="mr-1.5 h-3.5 w-3.5" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                    {isViewing ? '收起' : '查看原文'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => handleDownload(copy)}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    下载
                  </Button>
                  {copy.restorable && copy.baseKey === FAVORITES_STORAGE_KEY ? (
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={busyKey === copy.key || favorites.storageBlocked !== null}
                      onClick={() => handleRestore(copy)}
                    >
                      {busyKey === copy.key ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      并回收藏
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant={pendingDelete === copy.key ? 'destructive' : 'ghost'}
                    className="h-7 text-[11px]"
                    disabled={busyKey === copy.key}
                    onClick={() => handleDelete(copy)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {pendingDelete === copy.key ? '确认删除' : '删除'}
                  </Button>
                </div>
              </div>
              {isViewing && viewingText !== null ? (
                <pre aria-live="polite" tabIndex={0} className="mt-2 max-h-52 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {viewingText.length > PREVIEW_CHARS
                    ? `${viewingText.slice(0, PREVIEW_CHARS)}\n…（共 ${viewingText.length.toLocaleString()} 字符，完整内容请用「下载」）`
                    : viewingText}
                </pre>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
