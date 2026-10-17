'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Command, Keyboard, Sparkles } from 'lucide-react'
import { useHomeDIY, type HomeViewMode, type CanvasBackground } from '@/lib/modular/use-home-diy'
import { useDensity } from '@/components/density-provider'
import { useToast } from '@/components/ui/use-toast'

interface KeyboardShortcutsDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const SHORTCUT_GROUPS = [
  {
    title: '视窗与排版',
    shortcuts: [
      { key: '1', desc: '切换为极客混合流 (Hybrid)' },
      { key: '2', desc: '切换为经典全景流 (Classic)' },
      { key: '3', desc: '切换为沉浸工作台 (Workbench)' },
      { key: 'E', desc: '开关首页 DIY 可视化排版工坊' },
      { key: 'D', desc: '循环切换内容密度 (紧凑 / 舒适 / 宽松)' },
      { key: 'B', desc: '循环切换画布背景 (微网格 / 科技点 / 极客网 / 极光 / 纯净)' },
    ],
  },
  {
    title: '检索与导航',
    shortcuts: [
      { key: '/', desc: '极速聚焦智能检索引擎 (Search Palette)' },
      { key: 'Space', desc: '聚焦卡片时触发沙箱速览与微动作 (Peek)' },
      { key: 'T', desc: '打开开发者微工具箱 (Base64/JSON/UUID)' },
      { key: '?', desc: '打开或关闭本快捷键指南' },
      { key: 'Esc', desc: '关闭弹窗 / 退出速览' },
    ],
  },
]

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = typeof open === 'boolean'
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = useCallback((v: boolean) => {
    if (isControlled) {
      onOpenChange?.(v)
    } else {
      setInternalOpen(v)
    }
  }, [isControlled, onOpenChange])

  const {
    viewMode,
    setViewMode,
    toggleEditingLayout,
    canvasBackground,
    setCanvasBackground,
  } = useHomeDIY()

  const { density, setDensity } = useDensity()
  const { toast } = useToast()

  // 监听全局按键事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中触发快捷键
      const target = e.target as HTMLElement | null
      const isInput = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )

      if (isInput) return

      // 模态打开期间只保留「?」呼出本身：此时用户正在对话框里操作，
      // 1/2/3 切视图、E 开工坊、D 切密度、B 换背景这些全局键必须让位，
      // 否则在速览窗里按个 e 就把首页排版改了，属于按键劫持。
      // 判定用 role=dialog（Radix 与我们自己的浮层都会带），不用组件状态：
      // 快捷键是全局的，得能感知别的组件打开的浮层。
      const inDialog = typeof document !== 'undefined' && Boolean(
        // 排除 aria-hidden：常驻 DOM 的抽屉关闭态也带 role=dialog，
        // 不排除会让全局快捷键在移动端永久失效
        document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"])'),
      )
      if (inDialog && e.key !== '?') return

      // 按 ? 或 Shift + / 呼出快捷键帮助
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setIsOpen(!isOpen)
        return
      }

      // 按 1 / 2 / 3 切换视图
      if (e.key === '1') {
        e.preventDefault()
        setViewMode('hybrid')
        toast({ title: '已切换为极客混合流 (Hybrid)' })
      } else if (e.key === '2') {
        e.preventDefault()
        setViewMode('classic')
        toast({ title: '已切换为经典全景流 (Classic)' })
      } else if (e.key === '3') {
        e.preventDefault()
        setViewMode('workbench')
        toast({ title: '已切换为沉浸工作台 (Workbench)' })
      }

      // 按 E 开关 DIY 编排工坊
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        toggleEditingLayout()
      }

      // 按 D 循环切换密度
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        const order = ['dense', 'comfortable', 'spacious'] as const
        const nextIndex = (order.indexOf(density as any) + 1) % order.length
        const next = order[nextIndex]
        setDensity(next)
        toast({
          title: `内容密度已切换: ${next === 'dense' ? '极简紧凑 (0.75x)' : next === 'spacious' ? '宽松呼吸 (1.25x)' : '舒适标准 (1.0x)'}`,
        })
      }

      // 按 B 循环切换背景画布
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        const bgs: CanvasBackground[] = ['mesh', 'dots', 'grid', 'aurora', 'clean']
        const nextIndex = (bgs.indexOf(canvasBackground) + 1) % bgs.length
        const nextBg = bgs[nextIndex]
        setCanvasBackground(nextBg)
        toast({
          title: `画布背景已切换: ${nextBg}`,
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, setIsOpen, setViewMode, toggleEditingLayout, density, setDensity, canvasBackground, setCanvasBackground, toast])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-3rem)] overflow-y-auto sm:w-full p-4 sm:p-6">
        <DialogHeader className="pb-3 border-b border-border/50 pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Keyboard className="w-5 h-5 text-primary" />
            <span>NavSphere 快捷键全景指南</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            像操作专业 IDE 一样高效掌控 NavSphere，随时随地单手盲操。
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
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
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>随时按「?」呼出本窗口</span>
          </span>
          <span className="font-mono text-[11px]">NavSphere Pro Keyboard Maestro</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
