import type { VideoTranscriptItem } from '@/types/navigation'

export interface ClipExportOptions {
  startSec: number
  endSec: number
  includeSubtitles: boolean
  includeWatermark: boolean
  format: 'webm' | 'gif' | 'mp4'
  quality: '720p' | '1080p'
}

export interface RenderedClipPackage {
  filename: string
  durationSec: number
  byteLength: number
  blobUrl: string
  associatedSubtitles: VideoTranscriptItem[]
}

/**
 * Validates selected clip start and end timestamps.
 */
export function validateClipInterval(
  startSec: number,
  endSec: number,
  maxDurationSec: number = 300
): { valid: boolean; duration: number; error?: string } {
  if (startSec < 0) {
    return { valid: false, duration: 0, error: '开始时间不能小于 0 秒' }
  }
  if (endSec <= startSec) {
    return { valid: false, duration: 0, error: '结束时间必须大于开始时间' }
  }
  const duration = endSec - startSec
  if (duration > maxDurationSec) {
    return { valid: false, duration, error: `单次切片时长不能超过 ${maxDurationSec} 秒` }
  }
  if (duration < 3) {
    return { valid: false, duration, error: '切片时长至少需要 3 秒' }
  }
  return { valid: true, duration }
}

/**
 * Filters and extracts subtitles belonging to the selected clip time range.
 */
export function extractClipSubtitles(
  transcripts: VideoTranscriptItem[],
  startSec: number,
  endSec: number
): VideoTranscriptItem[] {
  return transcripts.filter((t) => {
    return (t.startSec >= startSec && t.startSec <= endSec) || (t.endSec >= startSec && t.endSec <= endSec)
  })
}

/**
 * Composites and exports the clip into a downloadable WebM / binary package.
 */
export async function renderVideoClipPackage(
  videoTitle: string,
  transcripts: VideoTranscriptItem[],
  options: ClipExportOptions
): Promise<RenderedClipPackage> {
  const { startSec, endSec, format } = options
  const durationSec = endSec - startSec
  const matchingSubs = extractClipSubtitles(transcripts, startSec, endSec)

  const safeTitle = videoTitle.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_').slice(0, 24)
  // 诚实口径（2026-11-10 审计）：浏览器端没有把视频帧真正合成 WebM/GIF 的
  // 管线，旧实现把一份 JSON 清单塞进 Blob、MIME 谎称 video/webm、文件名
  // 带 .webm 后缀让用户下载——文件根本播不了。现在如实导出「剪辑清单」
  // JSON（.clip.json）：含起止时间与字幕片段，可用于在剪辑软件里复现
  // 这段切片；UI 文案也同步改成导出清单，不再冒充视频文件。
  const filename = `clip_${safeTitle}_${Math.round(startSec)}s-${Math.round(endSec)}s.clip.json`

  const manifest = JSON.stringify({
    kind: 'navhub-clip-manifest',
    note: '这是剪辑清单，不是视频文件：浏览器内暂不支持直接生成 WebM/GIF，请用剪辑软件按起止时间复现。',
    title: videoTitle,
    startSec,
    endSec,
    durationSec,
    requestedFormat: format,
    subtitles: matchingSubs,
    exportedAt: new Date().toISOString(),
  })

  const blob = new Blob([manifest], { type: 'application/json' })
  const blobUrl = URL.createObjectURL(blob)

  return {
    filename,
    durationSec,
    byteLength: blob.size,
    blobUrl,
    associatedSubtitles: matchingSubs,
  }
}
