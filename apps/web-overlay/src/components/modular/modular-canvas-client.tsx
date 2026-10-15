'use client'

import dynamic from 'next/dynamic'
import { LayoutGrid } from 'lucide-react'

export const ModularCanvasClient = dynamic(
  () => import('./modular-canvas').then((m) => m.ModularCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full min-h-[420px] flex items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 animate-pulse">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <LayoutGrid className="w-8 h-8 animate-spin opacity-50 text-primary" />
          <span className="text-sm font-medium">正在装配模块化工作台...</span>
        </div>
      </div>
    ),
  }
)
