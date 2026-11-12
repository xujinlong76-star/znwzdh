/**
 * 卡片 ⋯ 菜单：不依赖拖拽的移动/复制/删除入口（WCAG 2.2 2.5.7）。
 *
 * 这是拖拽的**等效替代**，不是点缀：触屏用户拖不动、键盘用户
 * 不想按空格拖时，全靠它完成上移/下移/移到顶部/移到末尾/复制/删除。
 * 所以它不跟拖拽共用代码路径——拖拽库坏了它照样能用。
 *
 * 实现照搬 modular-item 尺寸菜单的既有模式（portal 到 body + fixed
 * 定位 + roving 焦点 + Esc 关 + 点外部关），不引 dropdown-menu：
 * 那个组件在 overlay 源码里并不存在（只有 apps/web 镜像里有），
 * 引它会在 overlay 类型检查里断掉。
 */
'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, EyeOff, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CardMoveDirection } from '@/lib/modular/diy-drag'

export interface DiyCardMenuProps {
  title: string
  /** 该卡在当前显示列表里的序号（0 起） */
  index: number
  /** 当前显示列表的总卡数 */
  total: number
  onMove: (direction: CardMoveDirection) => void
  onCopy: () => void
  onDelete: () => void
  /** 触发按钮的尺寸（三种卡片形态各不相同） */
  sizeClass?: string
}

interface MenuEntry {
  key: string
  label: string
  icon: React.ReactNode
  disabled: boolean
  run: () => void
  danger?: boolean
}

export function DiyCardMenu({
  title,
  index,
  total,
  onMove,
  onCopy,
  onDelete,
  sizeClass = 'h-6.5 w-6.5 rounded-full',
}: DiyCardMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const openedRef = useRef(false)

  const entries: MenuEntry[] = [
    {
      key: 'top',
      label: '移到顶部',
      icon: <ArrowUpToLine className="w-3.5 h-3.5" />,
      disabled: index <= 0,
      run: () => onMove('top'),
    },
    {
      key: 'up',
      label: '上移',
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      disabled: index <= 0,
      run: () => onMove('up'),
    },
    {
      key: 'down',
      label: '下移',
      icon: <ArrowDown className="w-3.5 h-3.5" />,
      disabled: index >= total - 1,
      run: () => onMove('down'),
    },
    {
      key: 'bottom',
      label: '移到末尾',
      icon: <ArrowDownToLine className="w-3.5 h-3.5" />,
      disabled: index >= total - 1,
      run: () => onMove('bottom'),
    },
    {
      key: 'copy',
      label: '复制链接',
      icon: <Copy className="w-3.5 h-3.5" />,
      disabled: false,
      run: onCopy,
    },
    {
      key: 'delete',
      label: '隐藏此站点',
      // 隐藏是移入回收站、可还原：垃圾桶图标会读成「删除」，EyeOff 才对得上动作
      icon: <EyeOff className="w-3.5 h-3.5" />,
      disabled: false,
      run: onDelete,
      danger: true,
    },
  ]

  // portal 定位：卡片自带 overflow-hidden，菜单 absolute 会被裁掉，
  // 与尺寸菜单同一招——挂 body 上按触发器实测位置放。
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const MENU_H = 260
    const MENU_W = 176
    const place = () => {
      const btn = triggerRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const top = spaceBelow < MENU_H + 12 && r.top > MENU_H + 12 ? r.top - MENU_H - 6 : r.bottom + 6
      const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
      setPos({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open ])

  // 打开后把焦点交给第一项；关闭时还给触发按钮
  useEffect(() => {
    if (!open) {
      if (openedRef.current) {
        openedRef.current = false
        triggerRef.current?.focus()
      }
      return
    }
    if (openedRef.current) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')
    if (first) {
      openedRef.current = true
      first.focus()
    }
  }, [open, pos])

  // 点外部关（挂载延迟一帧，避免触发那次 pointerdown 被自己关掉）
  useEffect(() => {
    if (!open) return
    const handleOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsidePointerDown)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', handleOutsidePointerDown)
    }
  }, [open])

  // Esc 关菜单（捕获阶段，避免同时触发卡片的操作区 Esc）
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return // 交给上面的 document 捕获监听
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'),
    )
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    const focusItem = (next: number) => {
      e.preventDefault()
      items[(next + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') focusItem(current + 1)
    else if (e.key === 'ArrowUp') focusItem(current - 1)
    else if (e.key === 'Home') focusItem(0)
    else if (e.key === 'End') focusItem(items.length - 1)
    else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const closeAndRun = (entry: MenuEntry) => {
    setOpen(false)
    entry.run()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        tabIndex={-1}
        data-card-action=""
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`更多操作：${title}`}
        title="更多操作：移动、复制、隐藏"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className={cn(
          sizeClass,
          'inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        )}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`更多操作：${title}`}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-[120] w-44 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95"
          >
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => closeAndRun(entry)}
                className={cn(
                  'text-left text-xs px-2 py-1.5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-30 disabled:pointer-events-none',
                  entry.danger
                    ? 'text-destructive-text hover:bg-destructive/15'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
