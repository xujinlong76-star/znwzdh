'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  validatePlugin,
  publishPlugin,
  type HubPluginItem,
} from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { pluginDetailHref } from '@/lib/plugins/detail-href'
import { copyText } from '@/lib/clipboard'
import {
  Package,
  Download,
  Copy,
  Send,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

export interface ExportPluginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: 'site-pack' | 'workspace-preset'
  defaultName: string
  defaultSlug?: string
  defaultDescription?: string
  defaultAuthor?: string
  defaultTags?: string[]
  payload: any
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-plugin'
}

export function ExportPluginModal({
  open,
  onOpenChange,
  kind,
  defaultName,
  defaultSlug,
  defaultDescription,
  defaultAuthor,
  defaultTags = [],
  payload,
}: ExportPluginModalProps) {
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [slug, setSlug] = useState(defaultSlug || slugify(defaultName))
  const [version, setVersion] = useState('1.0.0')
  const [author, setAuthor] = useState(defaultAuthor || '山羊胡贡献者')
  const [description, setDescription] = useState(defaultDescription || '')
  const [tagsInput, setTagsInput] = useState(defaultTags.join(', '))
  const [publishing, setPublishing] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setName(defaultName)
      setSlug(defaultSlug || slugify(defaultName))
      setDescription(defaultDescription || '')
      setTagsInput(defaultTags.join(', '))
    }
  }, [open, defaultName, defaultSlug, defaultDescription])

  const parsedTags = tagsInput
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)

  const buildManifest = () => ({
    schemaVersion: '1.0',
    manifestVersion: 1,
    kind,
    name: name.trim() || '未命名插件',
    slug: slug.trim() || slugify(name),
    version: version.trim() || '1.0.0',
    description: description.trim() || '由山羊胡用户工作区导出的声明式插件。',
    author: author.trim() || '匿名贡献者',
    authorKind: 'user' as const,
    license: 'MIT',
    tags: parsedTags.length > 0 ? parsedTags : ['社区投稿'],
    payload,
  })

  // 预检校验
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      setValidating(true)
      try {
        const manifest = buildManifest()
        const res = await validatePlugin(manifest)
        if (res.ok) {
          setValidationErrors([])
        } else {
          setValidationErrors(res.errors || [res.error || '清单校验未通过'])
        }
      } catch {
        // 网络异常容错
      } finally {
        setValidating(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [name, slug, version, author, description, tagsInput, open])

  // 下载清单 JSON
  const handleDownload = () => {
    const manifest = buildManifest()
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug || 'plugin'}.navhub-plugin.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('已下载插件清单 JSON 文件')
  }

  // 复制清单 JSON
  const handleCopy = async () => {
    const manifest = buildManifest()
    const res = await copyText(JSON.stringify(manifest, null, 2))
    if (res.ok) {
      toast.success('已复制清单 JSON 到剪贴板')
    } else {
      toast.error('复制失败', { description: res.reason })
    }
  }

  // 投递审核
  const handlePublish = async () => {
    if (validationErrors.length > 0) {
      toast.error('请先修正清单格式错误')
      return
    }
    setPublishing(true)
    try {
      const manifest = buildManifest()
      const res = await publishPlugin(manifest)
      toast.success(`投稿成功！插件「${res.name}」已提交进入待审队列。`, {
        description: '审核通过后将自动上架插件市场。',
      })
      onOpenChange(false)
      router.push(pluginDetailHref(res.slug, res.status))
    } catch (err: any) {
      toast.error('投递失败', {
        description: err?.message || '请检查同名插件冲突或重试',
      })
    } finally {
      setPublishing(false)
    }
  }

  const resourceCount =
    kind === 'site-pack'
      ? payload?.sites?.length ?? 0
      : payload?.boards?.length ?? payload?.layout?.length ?? 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            <span>导出为标准插件清单 (Export to Plugin)</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            自动将当前{kind === 'workspace-preset' ? '工作台画布排版' : '网址收藏'}提取打包为标准纯声明式 JSON，可下载分享或投稿上架。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          {/* 类型与资源概览徽章 */}
          <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3 border border-border/50">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px] font-medium">
                {pluginKindLabel(kind)}
              </Badge>
              <span className="text-muted-foreground">
                包含 {resourceCount} 个{kind === 'site-pack' ? '精选站点' : '工作台看板'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              规范标准: 山羊胡 Plugin Spec 1.0
            </span>
          </div>

          {/* 表单字段 */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="export-plugin-name" className="block font-medium text-foreground mb-1">
                  插件名称 *
                </label>
                <Input
                  id="export-plugin-name"
                  aria-label="插件名称"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!defaultSlug) setSlug(slugify(e.target.value))
                  }}
                  placeholder="例如：前端全栈百宝箱"
                  maxLength={50}
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div>
                <label htmlFor="export-plugin-slug" className="block font-medium text-foreground mb-1">
                  唯一标识 (Slug) *
                </label>
                <Input
                  id="export-plugin-slug"
                  aria-label="唯一标识 (Slug)"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder="例如：front-end-arsenal"
                  maxLength={64}
                  className="h-8 text-xs font-mono bg-background"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="export-plugin-author" className="block font-medium text-foreground mb-1">
                  作者署名
                </label>
                <Input
                  id="export-plugin-author"
                  aria-label="作者署名"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="您的昵称或 GitHub 用户名"
                  maxLength={30}
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div>
                <label htmlFor="export-plugin-version" className="block font-medium text-foreground mb-1">
                  首发版本号
                </label>
                <Input
                  id="export-plugin-version"
                  aria-label="首发版本号"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                  maxLength={20}
                  className="h-8 text-xs font-mono bg-background"
                />
              </div>
            </div>

            <div>
              <label htmlFor="export-plugin-description" className="block font-medium text-foreground mb-1">
                插件描述
              </label>
              <Textarea
                id="export-plugin-description"
                aria-label="插件描述"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简要说明该插件的适用场景与包含的特色资源..."
                rows={2}
                maxLength={200}
                className="text-xs bg-background resize-none"
              />
            </div>

            <div>
              <label htmlFor="export-plugin-tags" className="block font-medium text-foreground mb-1">
                分类标签（逗号分隔）
              </label>
              <Input
                id="export-plugin-tags"
                aria-label="分类标签（逗号分隔）"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="例如：前端, 工具, 效率"
                maxLength={80}
                className="h-8 text-xs bg-background"
              />
            </div>
          </div>

          {/* 实时校验状态反馈 */}
          <div className="pt-1">
            {validating ? (
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-primary" />
                <span>实时预检格式中...</span>
              </div>
            ) : validationErrors.length > 0 ? (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-2.5 text-destructive text-[11px] space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>清单校验未通过：</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>清单符合山羊胡纯声明式 JSON 架构，校验 100% 通过</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row sm:justify-between items-center gap-2 pt-2 border-t border-border/60">
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="text-xs h-8 flex-1 sm:flex-initial"
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              复制 JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="text-xs h-8 flex-1 sm:flex-initial"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              下载 .json
            </Button>
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-8"
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handlePublish}
              disabled={publishing || validating || validationErrors.length > 0}
              className="text-xs h-8 bg-primary text-primary-foreground shadow-xs flex-1 sm:flex-initial"
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              {publishing ? '投递中...' : '投稿至插件市场'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
