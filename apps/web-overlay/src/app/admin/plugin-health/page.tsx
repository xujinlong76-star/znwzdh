'use client'

/**
 * 管理端：插件网址智能体检与 AI 自愈指挥中心。
 *
 * 与既有页面分工：
 *   - `/admin`：全站基础设施时序大盘与链路健康概览
 *   - `/admin/plugins`：插件上架/审核/驳回状态机操作台
 *   - `/admin/plugin-health`：全市场网址包真实探活、L2 防劫持检测与 AI 平替自愈
 */

import Link from 'next/link'
import { ArrowLeft, BookOpen, ChevronRight, Gauge, LayoutDashboard, ShieldAlert, Sparkles, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PluginUrlHealthPanel } from '@/components/plugins/plugin-url-health-panel'

export default function AdminPluginHealthPage() {
  return (
    <div className="space-y-6">
      {/* 顶部面包屑与全站快速导览 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground border-b pb-3">
        <nav className="flex items-center gap-1.5 flex-wrap" aria-label="面包屑导航">
          <Link href="/admin" className="hover:text-foreground transition-colors flex items-center gap-1">
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>管理后台</span>
          </Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
          <Link href="/admin/plugins" className="hover:text-foreground transition-colors">
            插件生态治理
          </Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-foreground font-medium">网址智能体检与 AI 自愈</span>
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs px-2.5">
            <Link href="/admin">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              运维大盘
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs px-2.5">
            <Link href="/admin/plugins">
              <BookOpen className="h-3.5 w-3.5 mr-1" />
              插件列表
            </Link>
          </Button>
        </div>
      </div>

      {/* 头部视觉横幅 */}
      <header className="rounded-xl border bg-gradient-to-r from-primary/10 via-card to-background/80 p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Gauge className="h-4 w-4" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">插件网址智能体检与 AI 自愈</h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
              针对全市场网址包执行真实探活、L2 文本级信息熵与停放防劫持研判；坏链由后端大模型给出平替方案
              （模型不可用时自动降级为平台生态基准），并附 Wayback 历史快照入口供人工核对。
            </p>
          </div>
        </div>

        {/* 核心能力徽章条 */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
          <Badge variant="outline" className="text-[11px] bg-background/60 gap-1 py-0.5">
            <ShieldAlert className="h-3 w-3 text-emerald-500" />
            L1 逐跳 SSRF 探活
          </Badge>
          <Badge variant="outline" className="text-[11px] bg-background/60 gap-1 py-0.5">
            <Sparkles className="h-3 w-3 text-sky-500" />
            L2 Shannon 信息熵防劫持
          </Badge>
          <Badge variant="outline" className="text-[11px] bg-background/60 gap-1 py-0.5">
            <Wand2 className="h-3 w-3 text-violet-500" />
            L3 大模型智能平替
          </Badge>
          <Badge variant="outline" className="text-[11px] bg-background/60 gap-1 py-0.5">
            <Badge variant="secondary" className="h-3.5 px-1 text-[9px] rounded-full mr-0.5">
              Archive
            </Badge>
            Wayback 历史快照
          </Badge>
          <Badge variant="outline" className="text-[11px] bg-background/60 gap-1 py-0.5">
            一键净网补丁回写
          </Badge>
        </div>
      </header>

      {/* 核心工作台 */}
      <PluginUrlHealthPanel />
    </div>
  )
}
