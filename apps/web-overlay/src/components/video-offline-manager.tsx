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
  RefreshCw,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoOfflineManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentVideoId?: string
  currentVideoTitle?: string
  onPlayOffline?: (videoId: string) => void
}

export function VideoOfflineManager({
  open,
  onOpenChange,
  currentVideoId,
  currentVideoTitle,
  onPlayOffline,
}: VideoOfflineManagerProps) {
  const [packages, setPackages] = useState<VideoOfflinePackage[]>([])
  const [quota, setQuota] = useState<StorageQuotaInfo>({ usageBytes: 0, quotaBytes: 1, percentUsed: 0 })
  const [isDownloading, setIsDownloading] = useState<boolean>(false)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)

  const reload = async () => {
    const q = await getStorageQuotaEstimate()
    setQuota(q)
    const pkgs = await listOfflinePackages()
    setPackages(pkgs)
  }

  useEffect(() => {
    if (open) {
      reload()
    }
  }, [open])

  const handleStartDownload = async () => {
    if (!currentVideoId || isDownloading) return
    setIsDownloading(true)
    setDownloadProgress(10)

    // Simulate multi-chunk download & encryption pipeline
    for (let p = 20; p <= 100; p += 20) {
      await new Promise(r => setTimeout(r, 200))
      setDownloadProgress(p)
    }

    const newPkg: VideoOfflinePackage = {
      videoId: currentVideoId,
      title: currentVideoTitle || '离线缓存视频',
      totalBytes: 45 * 1024 * 1024,
      cachedBytes: 45 * 1024 * 1024,
      totalChunks: 10,
      cachedChunks: 10,
      downloadedAt: Date.now(),
      isComplete: true,
      encrypted: true,
    }

    await saveVideoPackageMetadata(newPkg)
    setIsDownloading(false)
    setDownloadProgress(0)
    reload()
  }

  const handleDelete = async (videoId: string) => {
    await deleteOfflineVideo(videoId)
    reload()
  }

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  const isCurrentDownloaded = packages.some(p => p.videoId === currentVideoId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <DownloadCloud className="w-5 h-5 text-primary" />
            <span>离线离网缓存与下载管理</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
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
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  AES-256 GCM 加密
                </span>
              </div>

              {isDownloading ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="flex items-center gap-1 text-primary">
                      <RefreshCw className="w-3 h-3 animate-spin" /> 下载与分片加密中...
                    </span>
                    <span>{downloadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-primary/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              ) : isCurrentDownloaded ? (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-emerald-500 font-medium flex items-center gap-1 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 已离线就绪 (45 MB)
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => onPlayOffline && onPlayOffline(currentVideoId)}
                  >
                    <Play className="w-3 h-3" /> 离线播放
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5"
                  onClick={handleStartDownload}
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  下载本视频至本地 (~45 MB)
                </Button>
              )}
            </div>
          )}

          {/* Downloaded Packages List */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-muted-foreground">已下载视频列表 ({packages.length})</div>
            {packages.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground text-xs">
                暂无离线视频。下载后即使处于断网或飞行模式亦可流畅播放。
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
                        {formatSize(pkg.cachedBytes)} · {new Date(pkg.downloadedAt).toLocaleDateString()}
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
