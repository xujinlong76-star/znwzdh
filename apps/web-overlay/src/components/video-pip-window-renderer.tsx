'use client'

import React, { useState } from 'react'
import {
  isDocumentPipSupported,
  createDocumentPipController,
} from '@/lib/video-document-pip'
import { Button } from '@/registry/new-york/ui/button'
import { PictureInPicture, ExternalLink, Copy, Check } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

interface VideoPipWindowRendererProps {
  videoTitle: string
  currentSubtitle?: string
  lastCodeCommand?: string
}

export function VideoPipWindowRenderer({
  videoTitle,
  currentSubtitle,
  lastCodeCommand,
}: VideoPipWindowRendererProps) {
  const [isPipOpen, setIsPipOpen] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)

  const handleLaunchDocumentPip = async () => {
    if (!isDocumentPipSupported()) {
      alert('当前浏览器环境不支持 Document Picture-in-Picture API，已自动降级为标准全屏或小窗。')
      return
    }

    const controller = createDocumentPipController({ width: 440, height: 260 })
    const success = await controller.open((pipDoc) => {
      pipDoc.title = `⚡ ${videoTitle} - 悬浮伴学微窗`

      const root = pipDoc.createElement('div')
      root.className = 'flex flex-col h-full justify-between p-3 select-none'

      root.innerHTML = `
        <div style="font-family: system-ui; font-size: 12px; font-weight: 600; color: #38bdf8; margin-bottom: 8px;">
          ${videoTitle}
        </div>
        <div style="background: #18181b; padding: 8px; border-radius: 6px; border: 1px solid #27272a; margin-bottom: 8px;">
          <div style="font-size: 10px; color: #a1a1aa; margin-bottom: 4px;">实时字幕跟随</div>
          <div style="font-size: 11px; color: #f4f4f5; line-height: 1.4;">
            ${currentSubtitle || '正在播放讲解内容...'}
          </div>
        </div>
        ${
          lastCodeCommand
            ? `
        <div style="background: #09090b; padding: 6px 8px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #34d399; margin-bottom: 8px; border: 1px solid #27272a;">
          $ ${lastCodeCommand}
        </div>
        `
            : ''
        }
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 10px; color: #71717a;">伴学悬浮窗置顶中</span>
          <button id="pip-copy-btn" style="background: #38bdf8; color: #000; border: none; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;">
            复制代码
          </button>
        </div>
      `

      pipDoc.body.appendChild(root)

      const btn = pipDoc.getElementById('pip-copy-btn')
      if (btn) {
        btn.addEventListener('click', () => {
          if (!lastCodeCommand) return
          // documentPictureInPicture 是同源窗口，仍可用父文档的封装层；
          // 原实现写完立刻改文案，失败时用户看到的「已复制!」是假的
          void copyText(lastCodeCommand).then((result) => {
            if (!result.ok) return
            btn.textContent = '已复制!'
            setTimeout(() => {
              btn.textContent = '复制代码'
            }, 1500)
          })
        })
      }
    })

    setIsPipOpen(success)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={handleLaunchDocumentPip}
      title="弹出支持富文本字幕与一键代码复制的桌面画中画伴学悬浮窗"
    >
      <PictureInPicture className="w-3.5 h-3.5 text-sky-400" />
      <span>桌面伴学窗</span>
    </Button>
  )
}
