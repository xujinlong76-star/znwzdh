'use client'

import React from 'react'
import { Sparkles, Compass, LayoutGrid } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { useHomeDIY, type HomeViewMode } from '@/lib/modular/use-home-diy'

interface ViewModeItem {
  id: HomeViewMode
  label: string
  desc: string
  icon: React.ReactNode
}

export function ViewModeToggle({ className }: { className?: string }) {
  const { viewMode, setViewMode } = useHomeDIY()

  const items: ViewModeItem[] = [
    {
      id: 'hybrid',
      label: '极客混合流 (推荐)',
      desc: '首屏极速组件展板 + 下方智能分类导航',
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
    },
    {
      id: 'classic',
      label: '经典全景流',
      desc: '纯粹分类目录树，全屏巡航海量站点',
      icon: <Compass className="w-4 h-4 text-blue-500" />,
    },
    {
      id: 'workbench',
      label: '沉浸工作台',
      desc: '将 12 栅格自由拖拽看板直接作为首页',
      icon: <LayoutGrid className="w-4 h-4 text-emerald-500" />,
    },
  ]

  const getCurrentIcon = () => {
    switch (viewMode) {
      case 'hybrid':
        return <Sparkles className="w-4 h-4 text-amber-500" />
      case 'workbench':
        return <LayoutGrid className="w-4 h-4 text-emerald-500" />
      default:
        return <Compass className="w-4 h-4 text-blue-500" />
    }
  }

  const getLabel = () => {
    switch (viewMode) {
      case 'hybrid':
        return '混合模式'
      case 'workbench':
        return '工作台'
      default:
        return '经典模式'
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-8.5 px-2 sm:px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors gap-1.5 ${className || ''}`}
          title={`当前首页排版形态：${getLabel()} (点击切换)`}
          aria-label={`首页视图形态：当前为${getLabel()}`}
        >
          {getCurrentIcon()}
          <span className="hidden xl:inline font-medium">{getLabel()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 p-1.5 shadow-xl bg-popover/95 backdrop-blur-md border border-border/80">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
          首页视窗形态模式
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => setViewMode(item.id)}
            className={`flex items-start gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer ${
              viewMode === item.id ? 'bg-accent font-medium' : 'hover:bg-accent/60'
            }`}
          >
            <div className="shrink-0 pt-0.5">{item.icon}</div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-foreground">{item.label}</span>
                {viewMode === item.id && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </div>
              <span className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">{item.desc}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
