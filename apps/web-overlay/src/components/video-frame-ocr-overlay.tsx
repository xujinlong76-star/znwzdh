'use client'

import React, { useState } from 'react'
import {
  type FrameOcrResult,
  extractCodeFromCanvas,
} from '@/lib/video-frame-ocr'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import {
  ScanText,
  Copy,
  Check,
  Terminal,
  Play,
  Code2,
} from 'lucide-react'
import { copyText } from '@/lib/clipboard'

interface VideoFrameOcrDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoElement?: HTMLVideoElement | null
  onSendToSandbox?: (code: string, language: string) => void
}

export function VideoFrameOcrDialog({
  open,
  onOpenChange,
  videoElement,
  onSendToSandbox,
}: VideoFrameOcrDialogProps) {
  const [ocrResult, setOcrResult] = useState<FrameOcrResult | null>(null)
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)

  const handleCaptureAndOcr = async () => {
    setIsProcessing(true)
    try {
      const canvas = document.createElement('canvas')
      if (videoElement && videoElement.videoWidth) {
        canvas.width = videoElement.videoWidth
        canvas.height = videoElement.videoHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
        }
      } else {
        canvas.width = 640
        canvas.height = 360
      }

      const res = await extractCodeFromCanvas(canvas)
      setOcrResult(res)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCopy = () => {
    if (!ocrResult) return
    // 原实现无条件 setCopied(true)，等于凭空报喜
    void copyText(ocrResult.formattedCode).then((result) => {
      if (!result.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleRunInSandbox = () => {
    if (!ocrResult) return
    if (onSendToSandbox) {
      onSendToSandbox(ocrResult.formattedCode, ocrResult.language)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanText className="w-5 h-5 text-primary" />
            <span>端侧画面代码与命令提取 (Frame OCR)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            基于端侧轻量图像自适应二值化算法，直接从当前视频帧中提取讲师输入的命令行与配置代码。
          </p>

          {!ocrResult ? (
            <div className="p-8 border border-dashed rounded-lg text-center space-y-3">
              <Code2 className="w-8 h-8 text-muted-foreground mx-auto" />
              <div className="text-foreground font-medium">准备扫描当前视频帧</div>
              <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                建议将视频暂停在代码或终端完整显示的时刻以获得最佳提取准确度。
              </p>
              <Button size="sm" onClick={handleCaptureAndOcr} disabled={isProcessing}>
                {isProcessing ? '正在提取画面文字...' : '开始提取当前帧代码'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Language and confidence stats */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono font-semibold uppercase text-[10px]">
                    {ocrResult.language}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    识别可信度: {Math.round(ocrResult.confidence * 100)}%
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleCopy}>
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? '已复制' : '复制代码'}
                  </Button>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={handleRunInSandbox}>
                    <Play className="w-3.5 h-3.5" /> 在沙箱中运行
                  </Button>
                </div>
              </div>

              {/* Code viewer */}
              <div className="p-3 rounded-lg bg-zinc-950 font-mono text-[11px] text-zinc-200 border border-zinc-800 max-h-56 overflow-y-auto space-y-1">
                {ocrResult.lines.map((line) => (
                  <div key={line.lineNumber} className="flex gap-3 leading-relaxed">
                    <span className="text-zinc-600 select-none w-5 text-right shrink-0">
                      {line.lineNumber}
                    </span>
                    <span className={line.isCommand ? "text-cyan-400 font-bold" : line.isComment ? "text-zinc-500 italic" : "text-zinc-200"}>
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={handleCaptureAndOcr}>
                  重新提取当前帧
                </Button>
                <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                  完成
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
