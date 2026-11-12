'use client'

import React, { useState } from 'react'
import {
  isDocumentPipSupported,
  createDocumentPipController,
} from '@/lib/video-document-pip'
import { buildVideoPipContent } from '@/lib/video-pip-content'
import { Button } from '@/registry/new-york/ui/button'
import { PictureInPicture } from 'lucide-react'

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
      // 标题/字幕/命令行都是外部可控文本，构建收在 lib/video-pip-content.ts：
      // 那里全程 createElement + textContent，这段内容不进 HTML 解析器
      pipDoc.body.appendChild(buildVideoPipContent(pipDoc, { videoTitle, currentSubtitle, lastCodeCommand }))
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
