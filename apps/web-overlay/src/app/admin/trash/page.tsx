'use client'

/**
 * 管理端：回收站（软删除站点）。
 *
 * 删除不再是一次性动作：DELETE /api/sites/:id 只打 deleted_at 戳，
 * 这里是它的可见出口——恢复（含同 URL 冲突 409 处理）与彻底清除。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { useToast } from '@/components/ui/use-toast'
import { Trash2, Undo2, Loader2 } from 'lucide-react'

interface TrashedSite {
  id: string
  url: string
  title: string
  description: string | null
  categoryId: string
  tags: string[]
  updatedAt: number
}

interface RestoreError {
  status: number
  existingSiteId?: string
}

export default function AdminTrashPage() {
  const { toast } = useToast()
  const [items, setItems] = useState<TrashedSite[]>([])
  const [loading, setLoading] = useState(true)
  /** 每行独立的忙碌态：id -> 'restore' | 'purge' */
  const [busy, setBusy] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await hubGet<{ items: TrashedSite[] }>('/api/trash?limit=200')
      setItems(data.items ?? [])
    } catch {
      toast({ title: '加载失败', description: '中枢暂不可用，请稍后再试。', variant: 'destructive' })
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (site: TrashedSite) => {
    setBusy((b) => ({ ...b, [site.id]: 'restore' }))
    try {
      await hubSend(`/api/trash/${encodeURIComponent(site.id)}/restore`, 'POST')
      toast({ title: '已恢复', description: `「${site.title}」已回到导航列表。` })
      setItems((prev) => prev.filter((s) => s.id !== site.id))
    } catch (err) {
      // 409 = 同 URL 已被新站点占用（部分唯一索引 WHERE deleted_at IS NULL）
      const status = (err as RestoreError)?.status ?? 0
      if (status === 409) {
        toast({
          title: '无法恢复：URL 已被占用',
          description: '该网址已有一个新站点，恢复会造成重复。请先删除新站点再恢复，或放弃此条。',
          variant: 'destructive',
        })
      } else {
        toast({ title: '恢复失败', description: '请稍后重试。', variant: 'destructive' })
      }
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[site.id]
        return next
      })
    }
  }

  const purge = async (site: TrashedSite) => {
    setBusy((b) => ({ ...b, [site.id]: 'purge' }))
    try {
      await hubSend(`/api/trash/${encodeURIComponent(site.id)}`, 'DELETE')
      toast({ title: '已彻底删除', description: `「${site.title}」及其索引已永久清除，此操作不可恢复。` })
      setItems((prev) => prev.filter((s) => s.id !== site.id))
    } catch {
      toast({ title: '删除失败', description: '请稍后重试。', variant: 'destructive' })
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[site.id]
        return next
      })
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-2 flex items-center gap-2">
        <Trash2 className="h-5 w-5" /> 回收站
      </h1>
      <p className="text-xs text-muted-foreground mb-4">
        这里的站点已被删除但未消失：正常检索与列表都排除它们，直到你恢复或彻底清除。
        「彻底清除」不可恢复（连带标签关联与向量索引）。
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          回收站是空的。
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto no-scrollbar touch-pan-x">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">站点</th>
                <th className="text-left px-3 py-2 font-medium">网址</th>
                <th className="text-left px-3 py-2 font-medium">标签</th>
                <th className="text-left px-3 py-2 font-medium">更新时间</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((site) => {
                const action = busy[site.id]
                return (
                  <tr key={site.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{site.title}</div>
                      {site.description && (
                        <div className="text-xs text-muted-foreground max-w-[320px] truncate" title={site.description}>
                          {site.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[220px] truncate" title={site.url}>
                      {site.url}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {site.tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(site.updatedAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap flex justify-end gap-1.5">
                        <Button
                          size="sm" variant="outline"
                          disabled={Boolean(action)}
                          onClick={() => void restore(site)}
                        >
                          {action === 'restore' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />}
                          恢复
                        </Button>
                        <Button
                          size="sm" variant="destructive"
                          disabled={Boolean(action)}
                          onClick={() => {
                            if (window.confirm(`彻底删除「${site.title}」？此操作不可恢复（连带索引与向量）。`)) {
                              void purge(site)
                            }
                          }}
                        >
                          {action === 'purge' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
                          彻底删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
