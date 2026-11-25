'use client'

import React, { useState, useEffect } from 'react'
import {
  type VideoOfflinePackage,
  type StorageQuotaInfo,
  getStorageQuotaEstimate,
  listOfflinePackages,
  saveVideoPackageMetadata,
  deleteOfflineVideo,
} from '@/lib/video-offline-storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import {
  DownloadCloud,
  HardDrive,
  Trash2,
  CheckCircle2,
} from 'lucide-react'

interface VideoOfflineManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentVideoId?: string
  currentVideoTitle?: string
}

export function VideoOfflineManager({
  open,
  onOpenChange,
  currentVideoId,
  currentVideoTitle,
}: VideoOfflineManagerProps) {
  const [packages, setPackages] = useState<VideoOfflinePackage[]>([])
  const [quota, setQuota] = useState<StorageQuotaInfo>({ usageBytes: 0, quotaBytes: 1, percentUsed: 0 })
  const [isSaving, setIsSaving] = useState<boolean>(false)

  const [storageError, setStorageError] = useState<string | null>(null)

  const reload = async () => {
    // IndexedDB 可能因为配额/隐私模式拒绝请求；吞掉并给可见提示，
    // 避免 useEffect 里裸调用产生未捕获 Promise rejection。
    try {
      const q = await getStorageQuotaEstimate()
      setQuota(q)
      const pkgs = await listOfflinePackages()
      setPackages(pkgs)
      setStorageError(null)
    } catch {
      setStorageError('本机存储不可用，离线缓存列表暂时无法读取')
    }
  }

  useEffect(() => {
    if (open) {
      void reload()
    }
  }, [open])

  // 只保存元数据（标题/时间戳），不下载视频字节：浏览器端没有真实的
  // 视频下载管线，此前这里用 20%→100% 的模拟进度 + 写死的 45MB 假装
  // 下载完成并打上加密徽章。保存后仅用于「离线缓存」列表。
  const handleSaveForLater = async () => {
    if (!currentVideoId || isSaving) return
    setIsSaving(true)
    const newPkg: VideoOfflinePackage = {
      videoId: currentVideoId,
      title: currentVideoTitle || '离线缓存视频',
      totalBytes: 0,
      cachedBytes: 0,
      totalChunks: 0,
      cachedChunks: 0,
      downloadedAt: Date.now(),
      isComplete: false,
      encrypted: false,
    }

    try {
      await saveVideoPackageMetadata(newPkg)
      setStorageError(null)
    } catch {
      setStorageError('保存失败：本机存储不可用或空间不足')
      setIsSaving(false) // 失败也必须解除 busy，否则按钮永久卡死
      return
    }
    setIsSaving(false)
    void reload()
  }

  const handleDelete = async (videoId: string) => {
    try {
      await deleteOfflineVideo(videoId)
      setStorageError(null)
    } catch {
      setStorageError('删除失败：本机存储不可用')
      return
    }
    void reload()
  }

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  const isCurrentSaved = packages.some(p => p.videoId === currentVideoId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <DownloadCloud className="w-5 h-5 text-primary" />
            <span>离线缓存</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {storageError ? <p role="alert" className="rounded-md bg-destructive/15 px-2 py-1.5 text-destructive-text">{storageError}</p> : null}
          {/* Storage Quota Card */}
          <div className="p-3 rounded-lg border bg-muted/40 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
                本地离线存储配额
              </span>
              <span className="font-mono text-muted-foreground">
                {formatSize(quota.usageBytes)} / {formatSize(quota.quotaBytes)} ({quota.percentUsed}%)
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(2, quota.percentUsed)}%` }}
              />
            </div>
          </div>

          {/* Current Video Download Section */}
          {currentVideoId && (
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground truncate max-w-[220px]">
                  {currentVideoTitle || '当前视频'}
                </span>
              </div>

              {isCurrentSaved ? (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-emerald-500 font-medium flex items-center gap-1 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 已保存到离线缓存
                  </span>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5"
                  disabled={isSaving}
                  onClick={handleSaveForLater}
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  保存到离线缓存
                </Button>
              )}
            </div>
          )}

          {/* Downloaded Packages List */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-muted-foreground">离线缓存列表 ({packages.length})</div>
            {packages.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground text-xs">
                暂无保存的视频。保存后可在这里快速找回（仅保存元数据，不下载视频）。
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {packages.map((pkg) => (
                  <div
                    key={pkg.videoId}
                    className="flex items-center justify-between p-2 rounded-lg border bg-card text-xs hover:border-border transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-medium text-foreground truncate max-w-[240px]">
                        {pkg.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        已保存 · {new Date(pkg.downloadedAt).toLocaleDateString(undefined, { timeZone: 'Asia/Shanghai' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-400 hover:text-red-300"
                        onClick={() => handleDelete(pkg.videoId)}
                        title="删除离线缓存"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
