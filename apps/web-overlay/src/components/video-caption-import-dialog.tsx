'use client'

import React, { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Upload, FileText, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'
import type { VideoTranscriptItem } from '@/types/navigation'
import {
  detectCaptionFormat,
  parseCaptions,
  type CaptionParseError,
} from '@/lib/video-transcript-sync'

interface VideoCaptionImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoTitle: string
  /** 已导入字幕条数（>0 时显示替换 / 删除入口）。 */
  importedCueCount: number
  onImport: (cues: VideoTranscriptItem[], format: 'srt' | 'vtt') => void
  onDeleteImported: () => void
}

/**
 * 字幕导入对话框：粘贴 SRT / WebVTT 文本，或上传 .srt / .vtt 文件。
 * 格式不对时逐行指出问题（行号 + 原因），不导入、不静默丢弃；
 * 无字幕的视频不做语音转写，这里也明确写出来。
 */
export function VideoCaptionImportDialog({
  open,
  onOpenChange,
  videoTitle,
  importedCueCount,
  onImport,
  onDeleteImported,
}: VideoCaptionImportDialogProps) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [errors, setErrors] = useState<CaptionParseError[]>([])
  const [successCount, setSuccessCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const format = detectCaptionFormat(text)
  const formatLabel =
    format === 'srt' ? '已识别：SRT' : format === 'vtt' ? '已识别：WebVTT' : text.trim() ? '未识别出字幕格式' : '粘贴或上传后自动识别 SRT / WebVTT'

  const resetState = () => {
    setText('')
    setFileName('')
    setErrors([])
    setSuccessCount(null)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setErrors([])
    setSuccessCount(null)
    const reader = new FileReader()
    reader.onload = () => {
      setText(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      setErrors([{ line: 0, message: '读取文件失败，请重新选择 .srt 或 .vtt 文件' }])
    }
    reader.readAsText(file)
  }

  const handleImport = () => {
    const result = parseCaptions(text)
    if (result.errors.length > 0 || result.cues.length === 0) {
      setErrors(
        result.errors.length > 0
          ? result.errors
          : [{ line: 1, message: '没有解析出任何字幕条目，请检查字幕文本是否完整' }],
      )
      setSuccessCount(null)
      return
    }
    setErrors([])
    setSuccessCount(result.cues.length)
    onImport(result.cues, result.format === 'srt' ? 'srt' : 'vtt')
  }

  const handleClose = (next: boolean) => {
    if (!next) resetState()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入字幕：{videoTitle}</DialogTitle>
          <DialogDescription>
            粘贴 SRT / WebVTT 文本，或上传 .srt / .vtt 文件。导入后这条视频的字幕就能被搜索，点命中行可跳到对应时间点。
            无字幕的视频不会自动生成字幕，也不会做语音转写。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {importedCueCount > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                已导入 {importedCueCount} 条字幕，可搜索
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 text-xs text-destructive-text hover:text-destructive-text"
                onClick={() => {
                  onDeleteImported()
                  setSuccessCount(null)
                }}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> 删除已导入字幕
              </Button>
            </div>
          )}

          <div>
            <label htmlFor="caption-paste" className="text-xs font-medium">
              粘贴字幕文本
            </label>
            <textarea
              id="caption-paste"
              value={text}
              onChange={e => {
                setText(e.target.value)
                setErrors([])
                setSuccessCount(null)
              }}
              rows={8}
              placeholder={'示例（SRT）：\n1\n00:00:01,000 --> 00:00:04,000\n你好，这里是视频的第一句话\n\n示例（WebVTT）：\nWEBVTT\n\n00:01.000 --> 00:04.000\n你好，这里是视频的第一句话'}
              className="mt-1 w-full rounded-md border border-border/50 bg-card px-3 py-2 text-xs leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground" role="status">
              {formatLabel}
              {fileName ? ` · 文件：${fileName}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".srt,.vtt,text/plain"
              className="hidden"
              onChange={handleFileChange}
              aria-label="上传字幕文件"
            />
            <Button
              variant="outline"
              className="min-h-11 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5 mr-1" /> 上传 .srt / .vtt 文件
            </Button>
            <Button className="min-h-11 text-xs" onClick={handleImport} disabled={!text.trim()}>
              <FileText className="w-3.5 h-3.5 mr-1" /> 导入字幕
            </Button>
          </div>

          {successCount !== null && errors.length === 0 && (
            <p className="flex items-center gap-1.5 rounded-lg border border-green-600/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400" role="status">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              已导入 {successCount} 条字幕，现在可以搜索这条视频里说过的话了。
            </p>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2" role="alert">
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive-text">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                字幕格式有问题，未导入。请按下面提示逐行修正后重试：
              </p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/90">
                {errors.slice(0, 10).map((err, idx) => (
                  <li key={`${err.line}-${idx}`} className="leading-relaxed">
                    {err.line > 0 ? `第 ${err.line} 行：` : ''}
                    {err.message}
                  </li>
                ))}
                {errors.length > 10 && <li>……还有 {errors.length - 10} 处问题</li>}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
