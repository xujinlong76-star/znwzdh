'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Keyboard, Sparkles } from 'lucide-react'

export interface KeyboardShortcutGroup {
  title: string
  shortcuts: Array<{ key: string; desc: string }>
}

export function KeyboardShortcutsDialogContent({
  groups,
  onOpenChange,
}: {
  groups: KeyboardShortcutGroup[]
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-3rem)] overflow-y-auto sm:w-full p-4 sm:p-6">
        <DialogHeader className="pb-3 border-b border-border/50 pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Keyboard className="w-5 h-5 text-primary" />
            <span>山羊胡快捷键全景指南</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            像操作专业 IDE 一样高效掌控山羊胡，随时随地单手盲操。
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-5">
          {groups.map((group) => (
            <div key={group.title} className="space-y-2.5">
              <h4 className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                <span className="w-1 h-3 rounded-full bg-primary" />
                <span>{group.title}</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.shortcuts.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border border-border/40 text-xs"
                  >
                    <span className="text-muted-foreground truncate mr-2">{item.desc}</span>
                    <kbd className="font-mono font-bold text-foreground bg-background px-2 py-0.5 rounded border border-border/70 shadow-2xs shrink-0">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-pinned" />
            <span>随时按「?」呼出本窗口</span>
          </span>
          <span className="font-mono text-[11px]">山羊胡 Pro Keyboard Maestro</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
