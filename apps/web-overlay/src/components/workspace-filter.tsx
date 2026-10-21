'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Code2, Palette, Bot, Compass, Coffee } from 'lucide-react'
import {
  DAYPART_PLACEHOLDER,
  daypartText,
  describeDaypart,
  type DaypartHint,
} from '@/lib/daypart'

export type WorkspaceId = 'all' | 'dev' | 'design' | 'ai' | 'efficiency'

interface WorkspaceConfig {
  id: WorkspaceId
  label: string
  icon: React.ComponentType<{ className?: string }>
  desc: string
}

export const WORKSPACES: WorkspaceConfig[] = [
  { id: 'all', label: '全部探索', icon: Compass, desc: '全库漫游' },
  { id: 'dev', label: '研发全栈', icon: Code2, desc: '开发/部署/代码/API' },
  { id: 'design', label: 'UI & 设计', icon: Palette, desc: '素材/图标/画板/灵感' },
  { id: 'ai', label: 'AI 实验室', icon: Bot, desc: '大模型/代码助手/绘画' },
  { id: 'efficiency', label: '效率创作', icon: Coffee, desc: '知识库/协作/在线工具' },
]

interface WorkspaceFilterProps {
  active: WorkspaceId
  onChange: (id: WorkspaceId) => void
  counts?: Record<WorkspaceId, number>
}

export function WorkspaceFilter({ active, onChange, counts }: WorkspaceFilterProps) {
  // 时段提示只能等挂载之后再算。
  // 首页是服务端渲染的，服务端时区（CI / 容器通常是 UTC）与用户时区不一样，
  // 在渲染体里直接取 new Date().getHours() 会让「服务端写进 HTML 的那句话」
  // 与「客户端首帧算出来的那句话」对不上 —— React 判定水合不匹配，
  // 丢掉服务端 HTML 重渲染并在控制台报错。
  // 首帧两边都渲染 DAYPART_PLACEHOLDER（不含时间信息，因此不会说错话）。
  const [timeHint, setTimeHint] = useState<DaypartHint | null>(null)
  useEffect(() => {
    setTimeHint(describeDaypart(new Date().getHours()))
  }, [])

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 py-2.5 border-b border-border/40">
      <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none touch-pan-x overscroll-x-contain [mask-image:linear-gradient(to_right,black_90%,transparent_100%)] sm:[mask-image:none]">
        {WORKSPACES.map((ws) => {
          const Icon = ws.icon
          const isActive = active === ws.id
          return (
            <button
              key={ws.id}
              onClick={() => onChange(ws.id)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                  : 'bg-muted/40 hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/50 hover:border-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{ws.label}</span>
              {counts && counts[ws.id] !== undefined && (
                <span className={`text-xs ml-0.5 px-1.5 py-0.5 rounded-full font-mono ${isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-background/80 text-muted-foreground border border-border/40'}`}>
                  {counts[ws.id]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/40 border border-border/40">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-semibold text-foreground text-xs">
            {daypartText(timeHint ?? DAYPART_PLACEHOLDER)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground/80">自适应工作区</span>
      </div>
    </div>
  )
}
