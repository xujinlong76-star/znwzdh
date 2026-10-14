'use client'

import React, { useState } from 'react'
import { Button } from "@/registry/new-york/ui/button"
import { Input } from "@/registry/new-york/ui/input"
import { Label } from "@/registry/new-york/ui/label"
import type { NavigationSubItem, VideoConfig } from '@/types/navigation'

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
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !href.trim()) return

    setSubmitting(true)
    try {
      const videoConfig: VideoConfig = {
        type: videoType === 'youtube' ? 'youtube' : 'bilibili',
        videoId: videoId.trim() || undefined,
        bvid: videoType === 'bilibili' && videoId.trim() ? videoId.trim() : undefined,
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

      <div className="space-y-1.5">
        <Label htmlFor="video-icon" className="text-xs font-medium">封面图片 URL (可选)</Label>
        <Input
          id="video-icon"
          placeholder="https://... 或 /assets/images/..."
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="video-desc" className="text-xs font-medium">描述与核心知识点 (可选)</Label>
        <textarea
          id="video-desc"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="简要概括本视频涉及的核心架构或技术教程..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? '保存中...' : defaultValues ? '更新' : '添加'}
        </Button>
      </div>
    </form>
  )
}
