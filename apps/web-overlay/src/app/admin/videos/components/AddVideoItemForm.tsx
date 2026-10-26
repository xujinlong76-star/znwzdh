'use client'

import React, { useState } from 'react'
import { Button } from "@/registry/new-york/ui/button"
import { Input } from "@/registry/new-york/ui/input"
import { Label } from "@/registry/new-york/ui/label"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import type { NavigationSubItem, VideoConfig } from '@/types/navigation'
import { Sparkles, Loader2, Check } from 'lucide-react'

export interface AddVideoItemFormProps {
  defaultValues?: Partial<NavigationSubItem>
  onSubmit: (values: NavigationSubItem) => Promise<void> | void
  onCancel: () => void
}

export function AddVideoItemForm({
  defaultValues,
  onSubmit,
  onCancel,
}: AddVideoItemFormProps) {
  const { toast } = useToast()
  const [resolveUrl, setResolveUrl] = useState('')
  const [isResolving, setIsResolving] = useState(false)
  const [resolvedSuccess, setResolvedSuccess] = useState(false)

  const [title, setTitle] = useState(defaultValues?.title || '')
  const [href, setHref] = useState(defaultValues?.href || '')
  const [description, setDescription] = useState(defaultValues?.description || '')
  const [icon, setIcon] = useState(defaultValues?.icon || '')
  const [videoType, setVideoType] = useState<string>(
    defaultValues?.videoConfig?.type || 'bilibili'
  )
  const [videoId, setVideoId] = useState(
    defaultValues?.videoConfig?.videoId || defaultValues?.videoConfig?.bvid || ''
  )
  const [aid, setAid] = useState(defaultValues?.videoConfig?.aid || '')
  const [cid, setCid] = useState(defaultValues?.videoConfig?.cid || '')
  const [author, setAuthor] = useState(defaultValues?.videoConfig?.author || '')
  const [durationSec, setDurationSec] = useState<number | undefined>(defaultValues?.videoConfig?.durationSec)
  const [publishedAt, setPublishedAt] = useState<string | number | undefined>(defaultValues?.videoConfig?.publishedAt)
  const [pinned, setPinned] = useState(defaultValues?.videoConfig?.pinned ?? true)
  const [submitting, setSubmitting] = useState(false)

  const handleResolve = async () => {
    const targetUrl = (resolveUrl || href).trim()
    if (!targetUrl) {
      toast({
        title: '提示',
        description: '请先输入 Bilibili 或 YouTube 视频链接',
      })
      return
    }

    setIsResolving(true)
    setResolvedSuccess(false)
    try {
      const res = await fetch('/api/videos/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.details || err.error || '解析失败')
      }

      const data = await res.json()
      if (data.success && data.data) {
        const item = data.data
        setTitle(item.title || '')
        setHref(item.href || targetUrl)
        setDescription(item.description || '')
        setIcon(item.icon || '')
        setVideoType(item.videoConfig?.type || 'bilibili')
        setVideoId(item.videoConfig?.bvid || item.videoConfig?.videoId || '')
        setAid(item.videoConfig?.aid || '')
        setCid(item.videoConfig?.cid || '')
        setAuthor(item.videoConfig?.author || '')
        setDurationSec(item.videoConfig?.durationSec)
        setPublishedAt(item.videoConfig?.publishedAt)
        setPinned(true)
        setResolvedSuccess(true)

        toast({
          title: '解析成功',
          description: `已自动填入：${item.title}`,
        })
      }
    } catch (err) {
      toast({
        title: '智能解析失败',
        description: (err as Error).message || '未能自动提取视频信息，请手动填写',
        variant: 'destructive',
      })
    } finally {
      setIsResolving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !href.trim()) return

    setSubmitting(true)
    try {
      const videoConfig: VideoConfig = {
        type: videoType === 'youtube' ? 'youtube' : 'bilibili',
        videoId: videoId.trim() || undefined,
        bvid: videoType === 'bilibili' && videoId.trim() ? videoId.trim() : undefined,
        aid: aid.trim() || undefined,
        cid: cid.trim() || undefined,
        author: author.trim() || undefined,
        durationSec: durationSec ? Number(durationSec) : undefined,
        publishedAt: publishedAt || undefined,
        harvestedAt: defaultValues?.videoConfig?.harvestedAt || Date.now(),
        lastVerifiedAt: Date.now(),
        qualityScore: defaultValues?.videoConfig?.qualityScore || 85,
        freshnessScore: defaultValues?.videoConfig?.freshnessScore || 85,
        sourceType: defaultValues?.videoConfig?.sourceType || 'manual',
        pinned,
        healthStatus: defaultValues?.videoConfig?.healthStatus || 'healthy',
        stats: defaultValues?.videoConfig?.stats,
      }

      const item: NavigationSubItem = {
        id: defaultValues?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `video_${Date.now()}`),
        title: title.trim(),
        href: href.trim(),
        description: description.trim() || undefined,
        icon: icon.trim() || undefined,
        enabled: defaultValues?.enabled ?? true,
        videoConfig,
      }

      await onSubmit(item)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-2">
      {/* 智能粘贴解析器 */}
      <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          <Sparkles className="h-3.5 w-3.5" />
          <span>一键智能解析（粘贴链接自动补全）</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="粘贴视频链接一键解析"
            placeholder="粘贴 B 站 (BV...) 或 YouTube 链接一键提取..."
            value={resolveUrl}
            onChange={(e) => setResolveUrl(e.target.value)}
            className="text-xs h-8 bg-background"
          />
          <Button
            type="button"
            size="sm"
            disabled={isResolving}
            onClick={handleResolve}
            className="h-8 text-xs shrink-0 gap-1 bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isResolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : resolvedSuccess ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>{isResolving ? '解析中...' : '智能解析'}</span>
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="video-title" className="text-xs font-medium">视频标题 *</Label>
        <Input
          id="video-title"
          placeholder="例如：Next.js 全栈开发精粹"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="video-href" className="text-xs font-medium">播放网页地址 *</Label>
        <Input
          id="video-href"
          placeholder="https://www.bilibili.com/video/BV..."
          value={href}
          onChange={(e) => setHref(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="video-platform" className="text-xs font-medium">平台类型</Label>
          <select
            id="video-platform"
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={videoType}
            onChange={(e) => setVideoType(e.target.value)}
          >
            <option value="bilibili">哔哩哔哩 (Bilibili)</option>
            <option value="youtube">YouTube</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="video-id" className="text-xs font-medium">平台唯一标识 (BV号 / 视频ID)</Label>
          <Input
            id="video-id"
            placeholder="BV1xx411c7xx 或 YouTube ID"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="video-author" className="text-xs font-medium">UP主 / 创作者</Label>
          <Input
            id="video-author"
            placeholder="例如：极客时间"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="video-icon" className="text-xs font-medium">封面图片 URL</Label>
          <Input
            id="video-icon"
            placeholder="https://... 或 /assets/images/..."
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="video-desc" className="text-xs font-medium">描述与核心知识点 (可选)</Label>
        <textarea
          id="video-desc"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="简要概括本视频涉及的核心架构或技术教程..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
        <div className="space-y-0.5">
          <div className="text-xs font-medium flex items-center gap-1.5">
            <span>📌 锁定防替换保护</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            锁定后，全自动热点采集与优胜劣汰轮换永不淘汰此视频
          </div>
        </div>
        <input
          type="checkbox"
          id="video-pinned"
          aria-label="锁定防替换保护"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? '保存中...' : defaultValues ? '更新视频' : '保存入库'}
        </Button>
      </div>
    </form>
  )
}
