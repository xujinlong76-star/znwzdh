'use client'

import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import type { HubPluginItem } from '@/lib/navhub-api'
import { pluginDetailHref } from '@/lib/plugins/detail-href'

export interface PluginAuditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plugin: HubPluginItem
}

export function PluginAuditModal({ open, onOpenChange, plugin }: PluginAuditModalProps) {
  if (!plugin.aiAudit) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md p-4 sm:p-5 glass-surface border-border/80 shadow-2xl rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="space-y-1 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">AI 智能严审认证报告</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                插件「{plugin.name}」已通过山羊胡全自动代码沙盒与合规性审查
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-muted/40 border border-border/60">
            <div>
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span>综合质量与安全评分</span>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-bold"
                >
                  {plugin.aiAudit.level.toUpperCase()} 级准入
                </Badge>
              </div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                {plugin.aiAudit.score} <span className="text-xs font-normal text-muted-foreground">/ 100 分</span>
              </div>
            </div>
            <Badge
              variant="outline"
              className="text-xs font-semibold px-2.5 py-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/30 self-start sm:self-auto"
            >
              安全等级：优良 (Verified)
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-card border border-border/50">
              <div className="text-[10px] text-muted-foreground">静态安全沙箱</div>
              <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                100% 声明式隔离
              </div>
            </div>
            <div className="p-2 rounded-lg bg-card border border-border/50">
              <div className="text-[10px] text-muted-foreground">协议安全合规</div>
              <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                全量 HTTPS 认证
              </div>
            </div>
            <div className="p-2 rounded-lg bg-card border border-border/50">
              <div className="text-[10px] text-muted-foreground">AI 伦理反欺诈</div>
              <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                零注入 · 零违禁词
              </div>
            </div>
            <div className="p-2 rounded-lg bg-card border border-border/50">
              <div className="text-[10px] text-muted-foreground">语义相关性</div>
              <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                主题与内容对齐
              </div>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground/80 flex flex-wrap gap-1 items-center justify-between pt-1 font-mono">
            <span>认证时间：{new Date(plugin.aiAudit.auditedAt).toLocaleString()}</span>
            <span>契约版本：v1.0</span>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row justify-end gap-2">
            <Link
              href={pluginDetailHref(plugin.slug, plugin.status)}
              className="w-full sm:w-auto justify-center inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-all"
              onClick={() => onOpenChange(false)}
            >
              <span>查看插件详情</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
