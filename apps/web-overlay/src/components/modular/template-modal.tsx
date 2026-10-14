'use client'

import { PRESET_TEMPLATES } from '@/lib/modular/registry'
import { X, LayoutTemplate, Check, Sparkles } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface TemplateModalProps {
  isOpen: boolean
  onClose: () => void
  onApplyTemplate: (templateId: string) => void
}

export function TemplateModal({ isOpen, onClose, onApplyTemplate }: TemplateModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl bg-background border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <LayoutTemplate className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">套用官方预设模版</h2>
              <p className="text-xs text-muted-foreground">根据你的角色偏好快速切换最佳模块组合</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* 模版卡片流 */}
        <div className="p-6 space-y-3.5">
          {PRESET_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              className="group p-4 rounded-xl border border-border/70 hover:border-indigo-500/50 bg-card/60 hover:bg-card transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">{tpl.name}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                    {tpl.widgets.length} 个推荐模块
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {tpl.description}
                </p>
              </div>

              <Button
                size="sm"
                className="h-8 px-4 text-xs rounded-lg gap-1.5 shrink-0 shadow-xs"
                onClick={() => {
                  onApplyTemplate(tpl.id)
                  onClose()
                }}
              >
                <Check className="w-3.5 h-3.5" />
                <span>立即套用</span>
              </Button>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 bg-muted/30 border-t border-border/40 text-xs text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>套用模版将自动保存至本地，您仍可在此基础上自由增删和调整大小。</span>
        </div>
      </div>
    </div>
  )
}
