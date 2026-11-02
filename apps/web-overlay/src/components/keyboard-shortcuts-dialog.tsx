'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Command, Keyboard, Sparkles, Layout, Search, Zap } from 'lucide-react'
import { useHomeDIY, type HomeViewMode, type CanvasBackground } from '@/lib/modular/use-home-diy'
import { canonicalDensityLabel, useDensity } from '@/components/density-provider'
import { useToast } from '@/components/ui/use-toast'

interface KeyboardShortcutsDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** T 键的键盘入口：工具箱状态在 NavigationContent 手里，经这里接线 */
  onOpenTools?: () => void
}

const SHORTCUT_GROUPS = [
  {
    title: '检索与流转',
    icon: Search,
    shortcuts: [
      { key: '/ 或 ⌘K', desc: '极速呼出超级搜索与指令控制台 (Spotlight)' },
      { key: 'Space', desc: '聚焦卡片时触发沙箱速览与平替 (Peek)' },
      { key: '1 ~ 9', desc: '桌面常用启动坞数字键一键秒开' },
      { key: '^N / ^P', desc: '搜索结果上下项快速穿梭选择' },
      { key: 'Alt+C', desc: '极速复制当前聚焦项官网链接' },
      { key: 'T', desc: '打开开发者微工具箱 (Base64/JSON/UUID)' },
    ],
  },
  {
    title: '视窗与排版',
    icon: Layout,
    shortcuts: [
      { key: '1', desc: '切换为极客混合流 (Hybrid)' },
      { key: '2', desc: '切换为经典全景流 (Classic)' },
      { key: '3', desc: '切换为沉浸工作台 (Workbench)' },
      { key: 'E', desc: '开关首页 DIY 可视化排版工坊' },
      { key: 'D', desc: '循环切换内容密度 (紧凑 / 舒适 / 宽松)' },
      { key: 'B', desc: '循环切换画布背景 (微网格 / 科技点 / 极客网 / 极光 / 纯净)' },
      { key: '?', desc: '打开或关闭本快捷键指南' },
      { key: 'Esc', desc: '关闭当前浮层 / 退出全屏' },
    ],
  },
]

export function KeyboardShortcutsDialog({ open, onOpenChange, onOpenTools }: KeyboardShortcutsDialogProps) {
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
      const inDialog = typeof document !== 'undefined' && Boolean(
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

      // 按 T 打开开发者微工具箱
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        onOpenTools?.()
      }

      // 按 D 循环切换密度
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        const order = ['dense', 'comfortable', 'spacious'] as const
        const nextIndex = (order.indexOf(density as any) + 1) % order.length
        const next = order[nextIndex]
        setDensity(next)
        toast({
          title: `内容密度已切换: ${canonicalDensityLabel(next)}`,
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
  }, [isOpen, setIsOpen, setViewMode, toggleEditingLayout, density, setDensity, canvasBackground, setCanvasBackground, toast, onOpenTools])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-3rem)] overflow-y-auto sm:w-full p-4 sm:p-6 glass-surface subtle-mesh border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="pb-3 border-b border-border/50 pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-bold">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Keyboard className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <span>山羊胡快捷键全景指南</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            像操作专业 IDE 一样高效掌控山羊胡，随时随地双手盲操直达。
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-4">
          {SHORTCUT_GROUPS.map((group) => {
            const GroupIcon = group.icon
            return (
              <div key={group.title} className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground tracking-wider uppercase flex items-center gap-1.5">
                  <GroupIcon className="w-3.5 h-3.5 text-primary" />
                  <span>{group.title}</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {group.shortcuts.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-2 rounded-xl bg-card/60 hover:bg-card border border-border/60 text-xs transition-colors duration-150"
                    >
                      <span className="text-muted-foreground truncate mr-2">{item.desc}</span>
                      <kbd className="font-mono font-bold text-primary bg-background/90 px-2 py-0.5 rounded-lg border border-border/80 shadow-2xs shrink-0 ring-1 ring-inset ring-white/10">
                        {item.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="pt-2.5 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>随时按「?」呼出本窗口</span>
          </span>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Pro Keyboard Maestro</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
