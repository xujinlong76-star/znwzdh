'use client'

import dynamic from 'next/dynamic'
import { LayoutGrid } from 'lucide-react'

export const ModularCanvasClient = dynamic(
  () => import('./modular-canvas').then((m) => m.ModularCanvas),
  {
    ssr: false,
    loading: () => (
      // 占位至少一屏：本地布局要等 chunk 下载 + effect 读取，按 420px 占位会让
      // 页脚先出现在折叠线内，内容挂载后被顶到 2000px 开外（实测 CLS 0.43）。
      <div className="w-full min-h-[100vh] flex items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 animate-pulse">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <LayoutGrid className="w-8 h-8 animate-spin opacity-50 text-primary" />
          <span className="text-sm font-medium">正在装配模块化工作台...</span>
        </div>
      </div>
    ),
  }
)
