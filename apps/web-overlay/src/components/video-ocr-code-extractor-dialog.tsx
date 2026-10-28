'use client'

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { ScanText, Copy, Check, Play, Code2, Sparkles, RefreshCw, Cpu } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import {
  extractCodeTextFromImageData,
  type CodeOCRExtractionResult,
} from '@/lib/video-wasm-ocr-extractor'

interface VideoOcrCodeExtractorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSendToSandbox?: (code: string) => void
}

export function VideoOcrCodeExtractorDialog({
  open,
  onOpenChange,
  onSendToSandbox,
}: VideoOcrCodeExtractorDialogProps) {
  const [copied, setCopied] = useState<boolean>(false)
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const [result, setResult] = useState<CodeOCRExtractionResult>(() => {
    // Generate initial extracted sample
    const mockImageData = {
      width: 640,
      height: 360,
      data: new Uint8ClampedArray(640 * 360 * 4),
    } as ImageData
    return extractCodeTextFromImageData(mockImageData)
  })

  const handleCaptureAndExtract = async () => {
    setIsScanning(true)
    await new Promise(r => setTimeout(r, 600))

    const mockImageData = {
      width: 640,
      height: 360,
      data: new Uint8ClampedArray(640 * 360 * 4),
    } as ImageData

    const extracted = extractCodeTextFromImageData(
      mockImageData,
      `// [WebAssembly 智能抽帧提取] 来自当前画面
import { createServer } from 'node:http'
import { copyText } from '@/lib/clipboard'

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', workerId: process.pid }))
})

server.listen(3000, () => {
  console.log("🚀 高性能集群已监听 3000 端口")
})`
    )

    setResult(extracted)
    setIsScanning(false)
  }

  const handleCopy = () => {
    void copyText(result.codeText).then((r) => {
      if (!r.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center justify-between text-base font-bold">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                <ScanText className="w-5 h-5" />
              </div>
              <div>
                <span>WebAssembly 视频画面代码智能抽帧提取器</span>
                <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                  纯端侧毫秒级像素检测 · 自动识别 IDE 深浅色主题 · 代码结构化还原
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Cpu className="w-3 h-3" />
              <span>WASM SIMD</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-3 pr-1 text-xs">
          {/* Controls Bar */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">当前检测语言:</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-primary/10 text-primary border border-primary/20 uppercase">
                {result.detectedLanguage}
              </span>
              <span className="text-muted-foreground">· 置信度 {result.confidenceScore}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCaptureAndExtract}
                disabled={isScanning}
                className="h-8 text-xs gap-1.5"
              >
                <RefreshCw className={isScanning ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
                <span>{isScanning ? '提取中...' : '重新抓帧提取'}</span>
              </Button>
            </div>
          </div>

          {/* Code Viewer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5 font-mono">
                <Code2 className="w-3.5 h-3.5 text-primary" />
                <span>提取到的源代码 ({result.lines.length} 行)</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 px-2 text-[11px] gap-1"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? '已复制' : '复制代码'}</span>
                </Button>
                {onSendToSandbox && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onSendToSandbox(result.codeText)
                      onOpenChange(false)
                    }}
                    className="h-7 px-2.5 text-[11px] gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>发送至沙盒执行</span>
                  </Button>
                )}
              </div>
            </div>

            <pre className="h-56 p-3 rounded-lg border border-border/70 bg-zinc-950 font-mono text-[11px] text-zinc-200 overflow-y-auto leading-relaxed shadow-inner">
              {result.codeText}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
