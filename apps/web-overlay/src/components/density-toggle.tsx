'use client'

import React from 'react'
import { Rows3, LayoutGrid, Maximize2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { useDensity, type ContentDensity } from './density-provider'

export function DensityToggle({ className }: { className?: string }) {
  const { density, setDensity, densityLabel } = useDensity()

  const items: Array<{ id: ContentDensity; label: string; desc: string; icon: React.ReactNode }> = [
    {
      id: 'dense',
      label: '极客密排 (75%)',
      desc: '紧凑高效，单屏展示海量站点',
      icon: <Rows3 className="w-4 h-4 text-cyan-500" />,
    },
    {
      id: 'comfortable',
      label: '舒适平衡 (100%)',
      desc: '标准间距，平衡呼吸感与屏效',
      icon: <LayoutGrid className="w-4 h-4 text-primary" />,
    },
    {
      id: 'spacious',
      label: '画廊沉浸 (125%)',
      desc: '宽幅留白，适合大屏与触控展板',
      icon: <Maximize2 className="w-4 h-4 text-indigo-500" />,
    },
  ]

  const currentIcon = () => {
    switch (density) {
      case 'dense':
        return <Rows3 className="w-4 h-4 text-cyan-500" />
      case 'spacious':
        return <Maximize2 className="w-4 h-4 text-indigo-500" />
      default:
        return <LayoutGrid className="w-4 h-4" />
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors ${className || ''}`}
          title={`当前内容密度：${densityLabel} (点击切换)`}
          aria-label={`内容密度切换：当前为${densityLabel}`}
        >
          {currentIcon()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-xl bg-popover/95 backdrop-blur-md border border-border/80">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
          内容排版密度矩阵
        </DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => setDensity(item.id)}
            className={`flex items-start gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer ${
              density === item.id ? 'bg-accent font-medium' : 'hover:bg-accent/60'
            }`}
          >
            <div className="shrink-0 pt-0.5">{item.icon}</div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-foreground">{item.label}</span>
                {density === item.id && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </div>
              <span className="text-xs text-muted-foreground mt-0.5">{item.desc}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
