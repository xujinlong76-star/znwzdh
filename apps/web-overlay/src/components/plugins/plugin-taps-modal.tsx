'use client'

/**
 * 远程插件市场订阅源管理中心 (Remote Hub Taps Modal)
 * 类似 Homebrew Taps 或 Obsidian Community Plugins，支持用户添加、订阅并同步第三方插件源。
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/registry/new-york/ui/input'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  fetchPluginTaps,
  addPluginTap,
  deletePluginTap,
  syncPluginTap,
  type HubPluginTap,
} from '@/lib/navhub-api'
import {
  Radio,
  Plus,
  Trash2,
  RefreshCw,
  Globe,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Layers,
  Loader2,
} from 'lucide-react'

interface PluginTapsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSynced?: () => void
}

export function PluginTapsModal({ open, onOpenChange, onSynced }: PluginTapsModalProps) {
  const [taps, setTaps] = useState<HubPluginTap[]>([])
  const [loading, setLoading] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // 新增表单状态
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')

  const loadTaps = async () => {
    setLoading(true)
    try {
      const res = await fetchPluginTaps()
      if (res.ok) {
        setTaps(res.items || [])
      }
    } catch {
      toast.error('加载 Taps 订阅源列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadTaps()
    }
  }, [open])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) {
      toast.warning('请填写订阅源名称与有效 URL')
      return
    }

    setAdding(true)
    try {
      const res = await addPluginTap({
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || undefined,
      })
      if (res.ok) {
        toast.success(`成功添加订阅源：“${res.tap.name}”`)
        setName('')
        setUrl('')
        setDescription('')
        loadTaps()
      }
    } catch (err) {
      toast.error((err as Error)?.message || '添加订阅源失败')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string, tapName: string) => {
    try {
      const res = await deletePluginTap(id)
      if (res.ok) {
        toast.success(`已移除订阅源：“${tapName}”`)
        setTaps((prev) => prev.filter((t) => t.id !== id))
      }
    } catch {
      toast.error('移除订阅源失败')
    }
  }

  const handleSync = async (id: string) => {
    setSyncingId(id)
    try {
      const res = await syncPluginTap(id)
      if (res.ok) {
        // 逐因报数：原来只说「发现 N 个、导入/更新 M 个」，既没有更新这条路径，
        // 也把「不合规 / 重名 / 写库失败 / 被上限截断」全藏进了 N-M 的差里。
        const breakdown = [`新增 ${res.importedCount} 个`]
        if (res.skippedDuplicate > 0) breakdown.push(`市场已有同名 ${res.skippedDuplicate} 个`)
        if (res.rejectedInvalid > 0) breakdown.push(`清单不合规 ${res.rejectedInvalid} 个`)
        if (res.failedWrite > 0) breakdown.push(`写入失败 ${res.failedWrite} 个`)
        if (res.truncated) {
          breakdown.push(`超出单次 ${res.importCap} 条上限，还有 ${res.fetchedCount - res.processedCount} 条没处理，请再次同步`)
        }
        const message = `同步完成：订阅源共 ${res.fetchedCount} 条 → ${breakdown.join('、')}`
        if (res.rejectedInvalid > 0 || res.failedWrite > 0 || res.truncated) {
          toast.warning(message)
        } else {
          toast.success(message)
        }
        loadTaps()
        onSynced?.()
      }
    } catch (err) {
      toast.error((err as Error)?.message || '同步订阅源失败')
    } finally {
      setSyncingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto p-4 sm:p-6 glass-surface border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="space-y-1.5 pb-3 border-b border-border/50 pr-8">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Radio className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">远程插件市场订阅源 (Remote Taps)</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                支持连接第三方团队或社区 GitHub 仓库作为插件源，实现跨源插件生态无缝同步与自动更新。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 添加新源表单 */}
        <form onSubmit={handleAdd} className="mt-4 p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
          <div className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>添加新订阅源</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <Input
                aria-label="订阅源名称"
                placeholder="订阅源名称（例如：社区极客扩展库）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8.5 text-xs bg-background"
                required
              />
            </div>
            <div>
              <Input
                aria-label="订阅源 JSON 链接"
                placeholder="订阅清单 URL (HTTPS JSON)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-8.5 text-xs bg-background font-mono"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Input
              aria-label="订阅源简介（选填）"
              placeholder="订阅源简短描述（选填）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-8.5 text-xs bg-background flex-1"
            />
            <Button
              type="submit"
              size="sm"
              disabled={adding}
              className="h-8.5 text-xs px-4 shrink-0 gap-1.5"
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>添加源</span>
            </Button>
          </div>
        </form>

        {/* 现有源列表 */}
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between px-1">
            <span>已配置的 Taps 源 ({taps.length})</span>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
          </div>

          {taps.length === 0 ? (
            <div className="py-8 text-center rounded-xl border border-dashed border-border/70 p-6 space-y-2">
              <Globe className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <div className="text-xs text-muted-foreground">暂未配置第三方 Taps 订阅源</div>
              <div className="text-[11px] text-muted-foreground/70">
                您可通过上方输入框添加自定义 GitHub Raw JSON 或团队内网 Hub 源。
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {taps.map((tap) => (
                <div
                  key={tap.id}
                  className="p-3.5 rounded-xl border border-border/60 bg-card hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">{tap.name}</span>
                      <Badge
                        variant="outline"
                        title="上次同步后，本源清单里在市场可见的条数（新增 + 已存在同名）；不含清单不合规与写入失败的条目"
                        className="text-[10px] bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
                      >
                        市场内 {tap.pluginCount ?? 0} 个插件
                      </Badge>
                      {tap.lastSyncedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          上次同步: {new Date(tap.lastSyncedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate max-w-md">
                      {tap.url}
                    </div>
                    {tap.description && (
                      <div className="text-[11px] text-muted-foreground leading-relaxed">
                        {tap.description}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={syncingId === tap.id}
                      onClick={() => handleSync(tap.id)}
                      className="h-8 text-xs gap-1.5 px-3 border-border/70"
                      title="立即从远程获取最新插件并同步至市场"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingId === tap.id ? 'animate-spin text-primary' : ''}`} />
                      <span>同步</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(tap.id, tap.name)}
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 px-2"
                      title="移除此订阅源"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 预设推荐 Taps */}
        <div className="mt-4 p-3 rounded-xl bg-muted/40 border border-border/40 text-xs space-y-2">
          <div className="font-semibold text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>安全指引与公共订阅推荐</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            NavHub 远程 Taps 遵循安全沙盒原则，全量导入过程由 SSRF 防护守护。
            建议仅订阅来自受信组织或个人的源，安装前可通过插件详情页查看全自动安全扫描评分。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
