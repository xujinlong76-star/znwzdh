'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Command, Keyboard, Sparkles } from 'lucide-react'
import { useHomeDIY, type CanvasBackground } from '@/lib/modular/use-home-diy'
import { canonicalDensityLabel, useDensity } from '@/components/density-provider'
import { useToast } from '@/components/ui/use-toast'
import { getModifierKey } from '@/lib/platform'
import { spotlightHotkeyHint, useSpotlightShortcutMode } from '@/lib/user-preferences'
import { isAnyDialogOpen, isEventTargetTyping } from '@/lib/keyboard-guards'

interface KeyboardShortcutsDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** T 键的键盘入口：工具箱状态在 NavigationContent 手里，经这里接线 */
  onOpenTools?: () => void
}

/**
 * 快捷键清单。Spotlight 那一条不写死平台键：macOS 是 ⌘K、Windows/Linux 是 Ctrl+K，
 * 用户还可能把呼出键改成「仅 /」。文案由 spotlightHotkeyHint 与真实生效键同源生成，
 * 避免指南教一个按不出来的键。
 */
function buildShortcutGroups(spotlightKey: string) {
  return [
  {
    title: '视窗与排版',
    shortcuts: [
      { key: 'Alt+1', desc: '切换为极客混合流 (Hybrid)' },
      { key: 'Alt+2', desc: '切换为经典全景流 (Classic)' },
      { key: 'Alt+3', desc: '切换为沉浸工作台 (Workbench)' },
      { key: 'Ctrl/Cmd+E', desc: '开关首页 DIY 可视化排版工坊' },
      { key: 'D', desc: '循环切换内容密度 (紧凑 / 舒适 / 宽松)' },
      { key: 'B', desc: '循环切换画布背景 (微网格 / 科技点 / 极客网 / 极光 / 纯净)' },
    ],
  },
  {
    title: '批量整理（仅多选模式）',
    shortcuts: [
      { key: 'M', desc: '进入 / 退出多选模式' },
      { key: 'Space / Enter', desc: '聚焦卡片时切换选中（不再速览 / 导航）' },
      { key: 'Ctrl/Cmd+A', desc: '全选当前可见站点' },
      { key: 'Esc', desc: '先清空选中，再退出多选模式' },
      { key: 'P', desc: '批量固定到工作台' },
      { key: 'E / Shift+E', desc: '复制 Markdown / 下载 .md' },
      { key: 'F', desc: '聚焦坞里的「收录至分类」' },
      { key: 'Delete', desc: '移除选中' },
    ],
  },
  {
    title: '检索与导航',
    shortcuts: [
      { key: spotlightKey, desc: '极速呼出超级搜索与指令控制台 (Spotlight)' },
      { key: '1–9', desc: '直接打开速览坞对应站点（数字直达）' },
      { key: 'Shift+1–9', desc: '在新标签页打开速览坞对应站点' },
      { key: 'Ctrl+Shift+1–0', desc: '打开自定义快拨位站点（卡片 ⋯ 菜单里绑定）' },
      { key: '→ / ←', desc: '在卡片内部进入与切换操作按钮 (WAI-ARIA)' },
      { key: 'Space', desc: '聚焦卡片时触发沙箱速览与微动作 (Peek)' },
      { key: 'T', desc: '打开开发者微工具箱 (Base64/JSON/UUID)' },
      { key: '?', desc: '打开或关闭本快捷键指南' },
      { key: 'Esc', desc: '关闭弹窗 / 退出速览' },
    ],
  },
  ]
}

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

  // 指南里的呼出键必须与真正生效的一致：平台（⌘/Ctrl）与用户偏好（⌘K / 仅 /）都算数
  const spotlightMode = useSpotlightShortcutMode()
  const [modKey, setModKey] = useState<'⌘' | 'Ctrl'>('Ctrl')
  useEffect(() => {
    setModKey(getModifierKey())
  }, [])
  const shortcutGroups = useMemo(
    () => buildShortcutGroups(spotlightHotkeyHint(spotlightMode, modKey)),
    [spotlightMode, modKey],
  )

  // 监听全局按键事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 正在打字时单字符快捷键一律让位（强判定见 lib/keyboard-guards.ts，
      // 与数字直达共用同一份：输入框内数字正常打字、中文组字中不误触）。
      if (e.isComposing || isEventTargetTyping(e)) return

      // 模态打开期间只保留「?」呼出本身：此时用户正在对话框里操作，
      // Alt+1/2/3 切视图、Ctrl/Cmd+E 开工坊、D 切密度、B 换背景这些全局键必须让位，
      // 否则在速览窗里按个 e 就把首页排版改了，属于按键劫持。
      // 判定用 role=dialog（Radix 与我们自己的浮层都会带），不用组件状态：
      // 快捷键是全局的，得能感知别的组件打开的浮层。
      if (isAnyDialogOpen() && e.key !== '?') return

      // 按 ? 或 Shift + / 呼出快捷键帮助
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setIsOpen(!isOpen)
        return
      }

      // 按 Alt + 1 / 2 / 3 切换视图。裸 1/2/3 已让给数字直达（开站），
      // 这里只认 Alt 修饰；解析用 e.code 不用 e.key——Alt+1 在 macOS 上
      // 的 e.key 是 '¡'，按 key 永远匹配不上。
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.code === 'Digit1') {
          e.preventDefault()
          setViewMode('hybrid')
          toast({ title: '已切换为极客混合流 (Hybrid)' })
        } else if (e.code === 'Digit2') {
          e.preventDefault()
          setViewMode('classic')
          toast({ title: '已切换为经典全景流 (Classic)' })
        } else if (e.code === 'Digit3') {
          e.preventDefault()
          setViewMode('workbench')
          toast({ title: '已切换为沉浸工作台 (Workbench)' })
        }
      }

      // 按 Ctrl/Cmd+E 开关 DIY 编排工坊（WCAG 2.1.4：单字符快捷键会与
      // 读屏软件冲突，裸按 E 已废止）。这是 Ctrl/Cmd+E 唯一的按键处理入口：
      // 工具栏只有一个「完成」按钮（handleFinishEditing）、导航区没有按键处理，
      // 不要再别处另起一个同样的绑定，否则两次 toggle 会互相抵消。
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        toggleEditingLayout()
      }

      // 按 T 打开开发者微工具箱。指南里一直宣传这个键，但处理分支此前从未实现，
      // 按 T 永远没反应 —— 广告了不存在的功能比没有这个功能更糟。
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
        // 文案与设置页/首页菜单同源（canonicalDensityLabel），不再另写一套叫法
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
          {shortcutGroups.map((group) => (
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
          <span className="font-mono text-[11px]">山羊胡 Pro Keyboard Maestro</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
