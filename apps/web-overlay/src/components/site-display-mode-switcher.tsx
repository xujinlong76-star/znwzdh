'use client'

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  LayoutGrid,
  Grid3X3,
  List,
  Sparkles,
  Rows3,
  Image as ImageIcon,
  AlignLeft,
  RotateCcw,
  Monitor,
  LayoutDashboard,
  Gem,
  BookOpen,
  Terminal,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/new-york/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/registry/new-york/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useInitialViewMode,
  useIsBelowMd,
  useIsMobileViewport,
} from '@/components/initial-view-mode-context'
import { useHomeDIY, setHomeDiyPreview } from '@/lib/modular/use-home-diy'
import {
  CARD_DISPLAY_MODE_OPTIONS,
  getCardDisplayModeMeta,
  normalizeCardDisplayMode,
  VIEW_MODE_REGISTRY,
  type CanonicalCardDisplayMode,
  type ViewModeConfig,
} from '@/lib/modular/card-display-modes'
import { useDensity, type ContentDensity } from '@/components/density-provider'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

function ModeIcon({ mode, className }: { mode: CanonicalCardDisplayMode; className?: string }) {
  const cls = cn('h-4 w-4 shrink-0', className)
  switch (mode) {
    case 'bento':
      return <LayoutDashboard className={cls} />
    case 'glass-dock':
      return <Gem className={cls} />
    case 'magazine':
      return <BookOpen className={cls} />
    case 'terminal':
      return <Terminal className={cls} />
    case 'icon-wall':
      return <Grid3X3 className={cls} />
    case 'list':
      return <List className={cls} />
    case 'minimal':
      return <Sparkles className={cls} />
    case 'compact':
      return <Rows3 className={cls} />
    case 'rich':
      return <ImageIcon className={cls} />
    case 'directory':
      return <AlignLeft className={cls} />
    case 'standard':
    default:
      return <LayoutGrid className={cls} />
  }
}

/**
 * 52×34px 响应式主题 SVG 微型线框示意图（Raycast / Linear / Arc 风格）。
 * 纯语义矢量绘制，自动跟随亮/暗色主题与激活态主色，绝不依赖位图或固定色值。
 */
export function ModeSvgWireframe({
  mode,
  active,
  className,
}: {
  mode: CanonicalCardDisplayMode
  active: boolean
  className?: string
}) {
  const frameBg = active ? 'fill-primary/10 stroke-primary/45' : 'fill-muted/55 stroke-border'
  const surface = active ? 'fill-background stroke-primary/35' : 'fill-card stroke-border/80'
  const strong = active ? 'fill-primary' : 'fill-foreground/45 group-hover/opt:fill-primary/80'
  const soft = active ? 'fill-primary/35' : 'fill-muted-foreground/30 group-hover/opt:fill-primary/30'
  const divider = active ? 'stroke-primary/30' : 'stroke-border'

  return (
    <svg
      width="52"
      height="34"
      viewBox="0 0 52 34"
      fill="none"
      aria-hidden="true"
      data-mode-wireframe={mode}
      className={cn('h-[34px] w-[52px] shrink-0 overflow-visible', className)}
    >
      <rect x="0.5" y="0.5" width="51" height="33" rx="6" className={frameBg} strokeWidth="1" />

      {mode === 'standard' && (
        <>
          {[4, 19, 34].map((x) => (
            <g key={x}>
              <rect x={x} y="4.5" width="13.5" height="25" rx="2.5" className={surface} strokeWidth="0.75" />
              <rect x={x + 2} y="7" width="3.5" height="3.5" rx="1" className={strong} />
              <rect x={x + 6.5} y="7.75" width="5" height="1.8" rx="0.9" className={strong} />
              <rect x={x + 2} y="13" width="9.5" height="1.5" rx="0.75" className={soft} />
              <rect x={x + 2} y="16" width="7.5" height="1.5" rx="0.75" className={soft} />
              <rect x={x + 2} y="24.5" width="4" height="2" rx="1" className={soft} />
              <rect x={x + 7} y="24.5" width="4.5" height="2" rx="1" className={soft} />
            </g>
          ))}
        </>
      )}

      {mode === 'icon-wall' && (
        <>
          {[5, 16, 27, 38].map((x) =>
            [4.5, 18.5].map((y) => (
              <g key={`${x}-${y}`}>
                <rect x={x + 0.5} y={y} width="8" height="8" rx="2.2" className={strong} />
                <rect x={x + 1.5} y={y + 9.5} width="6" height="1.5" rx="0.75" className={soft} />
              </g>
            )),
          )}
        </>
      )}

      {mode === 'list' && (
        <>
          {[4.5, 13.5, 22.5].map((y) => (
            <g key={y}>
              <rect x="4" y={y} width="44" height="7" rx="2" className={surface} strokeWidth="0.75" />
              <rect x="6" y={y + 1.8} width="3.4" height="3.4" rx="0.9" className={strong} />
              <rect x="11.2" y={y + 2.5} width="9.5" height="2" rx="1" className={strong} />
              <rect x="22.5" y={y + 2.7} width="14.5" height="1.6" rx="0.8" className={soft} />
              <rect x="39" y={y + 2} width="7" height="3" rx="1.2" className={soft} />
            </g>
          ))}
        </>
      )}

      {mode === 'minimal' && (
        <>
          {[4, 19.5, 35].map((x) =>
            [4.5, 13.5, 22.5].map((y) => (
              <g key={`${x}-${y}`}>
                <rect x={x} y={y} width="13" height="6.5" rx="3.25" className={surface} strokeWidth="0.75" />
                <circle cx={x + 3.2} cy={y + 3.25} r="1.4" className={strong} />
                <rect x={x + 5.6} y={y + 2.5} width="5.4" height="1.5" rx="0.75" className={soft} />
              </g>
            )),
          )}
        </>
      )}

      {mode === 'compact' && (
        <>
          {[4, 27].map((x) =>
            [4.5, 13.5, 22.5].map((y) => (
              <g key={`${x}-${y}`}>
                <rect x={x} y={y} width="21" height="6.8" rx="2" className={surface} strokeWidth="0.75" />
                <rect x={x + 2} y={y + 1.7} width="3.4" height="3.4" rx="0.9" className={strong} />
                <rect x={x + 6.8} y={y + 2.5} width="9.5" height="1.8" rx="0.9" className={soft} />
                <circle cx={x + 18.4} cy={y + 3.4} r="1.1" className={soft} />
              </g>
            )),
          )}
        </>
      )}

      {mode === 'rich' && (
        <>
          {[4, 27.5].map((x) => (
            <g key={x}>
              <rect x={x} y="4.5" width="20.5" height="25" rx="2.8" className={surface} strokeWidth="0.75" />
              <rect x={x + 0.6} y="5.1" width="19.3" height="10.5" rx="2.2" className={active ? 'fill-primary/30' : 'fill-foreground/15'} />
              <rect x={x + 2.2} y="18.2" width="11.5" height="2" rx="1" className={strong} />
              <rect x={x + 2.2} y="21.8" width="15.5" height="1.5" rx="0.75" className={soft} />
              <rect x={x + 2.2} y="24.8" width="12" height="1.5" rx="0.75" className={soft} />
            </g>
          ))}
        </>
      )}

      {mode === 'directory' && (
        <>
          {[4.5, 27.5].map((x) =>
            [5, 13.5, 22].map((y) => (
              <g key={`${x}-${y}`}>
                <circle cx={x + 2} cy={y + 2} r="1.4" className={strong} />
                <rect x={x + 5} y={y + 1} width="13.5" height="1.8" rx="0.9" className={strong} />
                <rect x={x + 5} y={y + 4.2} width="10.5" height="1.3" rx="0.65" className={soft} />
                <line x1={x} y1={y + 7.2} x2={x + 19.5} y2={y + 7.2} className={divider} strokeWidth="0.65" />
              </g>
            )),
          )}
        </>
      )}

      {mode === 'bento' && (
        <>
          {[4, 27.5].map((x) => (
            <g key={x}>
              <rect x={x} y="4.5" width="20.5" height="25" rx="3" className={surface} strokeWidth="0.75" />
              <rect x={x + 0.6} y="5.1" width="19.3" height="2.4" rx="1.2" className={strong} />
              <rect x={x + 2.4} y="9.8" width="5.2" height="5.2" rx="1.5" className={strong} />
              <rect x={x + 12.2} y="10.6" width="6" height="2.2" rx="1.1" className={soft} />
              <rect x={x + 2.4} y="17.6" width="12" height="2" rx="1" className={strong} />
              <rect x={x + 2.4} y="21.2" width="15" height="1.4" rx="0.7" className={soft} />
              <rect x={x + 2.4} y="24.5" width="5.5" height="2.2" rx="1" className={soft} />
              <rect x={x + 9} y="24.5" width="5.5" height="2.2" rx="1" className={soft} />
            </g>
          ))}
        </>
      )}

      {mode === 'glass-dock' && (
        <>
          {[4, 19.5, 35].map((x) =>
            [4.2, 18.2].map((y) => (
              <g key={`${x}-${y}`}>
                <rect x={x} y={y} width="13" height="11.6" rx="2.6" className={surface} strokeWidth="0.75" />
                <circle cx={x + 6.5} cy={y + 4.4} r="2.6" className={strong} />
                <rect x={x + 2.6} y={y + 8.4} width="7.8" height="1.5" rx="0.75" className={soft} />
              </g>
            )),
          )}
        </>
      )}

      {mode === 'magazine' && (
        <>
          {[4, 27.5].map((x) => (
            <g key={x}>
              <rect x={x} y="4.5" width="20.5" height="25" rx="2.8" className={surface} strokeWidth="0.75" />
              <rect x={x + 0.5} y="5" width="2.4" height="24" rx="1.2" className={strong} />
              <rect x={x + 4.8} y="7.4" width="3.6" height="3.6" rx="1" className={strong} />
              <rect x={x + 9.6} y="8.2" width="8.5" height="1.9" rx="0.95" className={strong} />
              <rect x={x + 4.8} y="13.8" width="13.5" height="1.5" rx="0.75" className={soft} />
              <rect x={x + 4.8} y="16.8" width="11" height="1.5" rx="0.75" className={soft} />
              <line x1={x + 4.5} y1="21.5" x2={x + 19} y2="21.5" className={divider} strokeWidth="0.65" />
              <rect x={x + 4.8} y="24" width="5.5" height="2" rx="1" className={soft} />
              <circle cx={x + 17.5} cy="25" r="1.2" className={soft} />
            </g>
          ))}
        </>
      )}

      {mode === 'terminal' && (
        <>
          {[4, 27].map((x) =>
            [4.5, 13.5, 22.5].map((y) => (
              <g key={`${x}-${y}`}>
                <rect x={x} y={y} width="21" height="6.8" rx="1.8" className={surface} strokeWidth="0.75" />
                <path
                  d={`M${x + 2.4} ${y + 2.2} L${x + 4.2} ${y + 3.4} L${x + 2.4} ${y + 4.6}`}
                  className={active ? 'stroke-primary' : 'stroke-emerald-700 dark:stroke-emerald-400'}
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect x={x + 5.8} y={y + 2.5} width="6.2" height="1.8" rx="0.8" className={strong} />
                <line
                  x1={x + 13}
                  y1={y + 3.4}
                  x2={x + 16}
                  y2={y + 3.4}
                  className={divider}
                  strokeWidth="0.9"
                  strokeDasharray="1.1 1.1"
                />
                <rect x={x + 16.6} y={y + 2.5} width="2.8" height="1.8" rx="0.8" className={soft} />
              </g>
            )),
          )}
        </>
      )}
    </svg>
  )
}

const DENSITY_PILLS: Array<{ id: ContentDensity; label: string }> = [
  { id: 'dense', label: '紧凑' },
  { id: 'comfortable', label: '标准' },
  { id: 'spacious', label: '宽松' },
]

export interface SiteDisplayModeSwitcherProps {
  /** `toolbar` = 顶栏弹出式视觉画廊面板（桌面 Popover / 移动端 Bottom Sheet）；`inline` = 外观设置小窗内直接平铺 */
  variant?: 'toolbar' | 'inline'
  className?: string
}

export function SiteDisplayModeSwitcher({
  variant = 'toolbar',
  className,
}: SiteDisplayModeSwitcherProps) {
  const initialViewMode = useInitialViewMode()
  const isBelowMd = useIsBelowMd()
  const isMobileViewport = useIsMobileViewport()
  const { mounted, cardDisplayMode, setCardDisplayMode } = useHomeDIY()
  const { density, setDensity } = useDensity()
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [hoveredMode, setHoveredMode] = useState<CanonicalCardDisplayMode | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 水合安全：挂载前消费服务端 Cookie 注入的初始模式，确保顶栏按钮文案与 SSR 100% 一致
  const currentMode = mounted
    ? normalizeCardDisplayMode(cardDisplayMode)
    : initialViewMode
  const currentMeta = getCardDisplayModeMeta(currentMode)
  const isCustomMode = currentMode !== 'standard'
  const mobileFallbackMeta =
    mounted && isMobileViewport && currentMeta.mobileFallbackId
      ? VIEW_MODE_REGISTRY[currentMeta.mobileFallbackId]
      : null

  const cancelPreviewTimer = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
  }, [])

  const clearPreview = useCallback(() => {
    cancelPreviewTimer()
    setHoveredMode(null)
    startTransition(() => setHomeDiyPreview(null))
  }, [cancelPreviewTimer])

  const restoreTriggerFocus = useCallback((force = false) => {
    window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (force || !active || active === document.body || active === document.documentElement) {
        triggerRef.current?.focus()
      }
    })
  }, [])

  useEffect(() => {
    return () => {
      cancelPreviewTimer()
      setHomeDiyPreview(null)
    }
  }, [cancelPreviewTimer])

  // 打开面板时把键盘漫游游标对准当前已选中的模式
  useEffect(() => {
    if (!open) return
    const idx = CARD_DISPLAY_MODE_OPTIONS.findIndex((opt) => opt.id === currentMode)
    const targetIdx = idx >= 0 ? idx : 0
    setFocusedIndex(targetIdx)
    const rafId = window.requestAnimationFrame(() => {
      optionRefs.current[targetIdx]?.focus()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [open, currentMode])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        clearPreview()
      }
    },
    [clearPreview],
  )

  const handlePreview = useCallback(
    (mode: CanonicalCardDisplayMode) => {
      cancelPreviewTimer()
      setHoveredMode(mode)
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null
        startTransition(() => setHomeDiyPreview({ cardDisplayMode: mode }))
      }, 110)
    },
    [cancelPreviewTimer],
  )

  const handleSelect = useCallback(
    (mode: CanonicalCardDisplayMode, shouldRestoreFocus = false) => {
      cancelPreviewTimer()
      setHoveredMode(null)
      const meta = getCardDisplayModeMeta(mode)
      setOpen(false)
      startTransition(() => {
        setHomeDiyPreview(null)
        setCardDisplayMode(mode)
      })
      toast({
        title: `已切换为「${meta.name}」展示模式`,
        description:
          mounted && isMobileViewport && meta.mobileFallbackId
            ? `手机端已自动适配为「${VIEW_MODE_REGISTRY[meta.mobileFallbackId].name}」，切回桌面端自动恢复。`
            : `${meta.description} · ${meta.densityLabel}`,
      })
      if (shouldRestoreFocus) {
        restoreTriggerFocus(true)
      }
    },
    [cancelPreviewTimer, isMobileViewport, mounted, restoreTriggerFocus, setCardDisplayMode, toast],
  )

  /**
   * 完整 WAI-ARIA radiogroup 键盘导航：
   * - ↑/↓/←/→：在 7 种模式间漫游并触发实时预览；
   * - Home / End：直达首/尾项；
   * - Enter / Space：确认选中、关闭面板并把焦点归还触发按钮；
   * - Esc：关闭面板、清除预览并归还焦点。
   */
  const handleOptionKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const total = CARD_DISPLAY_MODE_OPTIONS.length
    let nextIndex: number | null = null

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % total
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + total) % total
    } else if (e.key === 'Home') {
      nextIndex = 0
    } else if (e.key === 'End') {
      nextIndex = total - 1
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = CARD_DISPLAY_MODE_OPTIONS[index]
      if (opt) handleSelect(opt.id, variant === 'toolbar')
      return
    } else if (e.key === 'Escape' && variant === 'toolbar') {
      e.preventDefault()
      clearPreview()
      setOpen(false)
      restoreTriggerFocus()
      return
    }

    if (nextIndex !== null) {
      e.preventDefault()
      setFocusedIndex(nextIndex)
      const target = CARD_DISPLAY_MODE_OPTIONS[nextIndex]
      if (target) {
        optionRefs.current[nextIndex]?.focus()
        handlePreview(target.id)
      }
    }
  }

  const featuredOption = CARD_DISPLAY_MODE_OPTIONS[0]!
  const modeGroups: Array<{ key: 'visual' | 'productivity' | 'dense'; label: string; hint: string }> = [
    { key: 'visual', label: '视觉与质感', hint: '微光磁贴 · 立体晶格 · 社论画廊' },
    { key: 'productivity', label: '高效与桌面', hint: '图标启动台 · 终端命令行 · 清单条形' },
    { key: 'dense', label: '极简与高密', hint: '去框化目录 · 超高密药丸流' },
  ]
  const indexById = new Map(CARD_DISPLAY_MODE_OPTIONS.map((opt, idx) => [opt.id, idx]))

  const renderModeOptionButton = (
    opt: ViewModeConfig,
    index: number,
    options: { featured?: boolean; sheet?: boolean; compact?: boolean },
  ) => {
    const isSelected = currentMode === opt.id
    const isDesktopFirst = opt.mobileFallbackId !== null
    const isRovingTabStop = index === focusedIndex

    return (
      <button
        key={opt.id}
        ref={(el) => {
          optionRefs.current[index] = el
        }}
        type="button"
        role="radio"
        aria-checked={isSelected}
        tabIndex={isRovingTabStop ? 0 : -1}
        data-display-mode-option={opt.id}
        onMouseEnter={() => {
          if (!options.sheet) handlePreview(opt.id)
        }}
        onFocus={() => {
          setFocusedIndex(index)
          if (!options.sheet) handlePreview(opt.id)
        }}
        onKeyDown={(e) => handleOptionKeyDown(e, index)}
        onClick={() => handleSelect(opt.id, false)}
        className={cn(
          'group/opt flex min-w-0 items-center gap-2.5 rounded-xl border text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          options.featured && !options.sheet ? 'sm:col-span-2 px-2.5 py-2' : 'px-2 py-2',
          options.sheet && 'min-h-[60px] px-3 py-2.5',
          isSelected
            ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-inset ring-primary/25 shadow-2xs'
            : 'border-border/70 bg-card/75 hover:border-primary/40 hover:bg-accent/50',
        )}
      >
        <ModeSvgWireframe mode={opt.id} active={isSelected} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-xs font-semibold text-foreground">{opt.name}</span>
              {options.featured && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                  {opt.badge}
                </span>
              )}
              {!options.featured && opt.isNew && (
                <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-primary">
                  NEW
                </span>
              )}
              {isDesktopFirst && (
                <span
                  data-desktop-best-badge=""
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-muted/80 px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground"
                >
                  <Monitor className="h-2.5 w-2.5 shrink-0" />
                  <span>桌面端最佳</span>
                </span>
              )}
            </div>
            {isSelected && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-2.5 w-2.5" />
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">
            {opt.description}
          </p>

          {!options.compact && (
            <p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-muted-foreground">
              {opt.densityLabel}
            </p>
          )}
        </div>
      </button>
    )
  }

  const renderGalleryBody = ({
    compact = false,
    sheet = false,
  }: {
    compact?: boolean
    sheet?: boolean
  }) => (
    <div
      className="space-y-2.5"
      onMouseLeave={sheet ? undefined : clearPreview}
    >
      {/* 头部标题与实时预览状态 */}
      {!sheet && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold tracking-tight text-foreground">网址展示模式</span>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
              {CARD_DISPLAY_MODE_OPTIONS.length} 种风格
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {hoveredMode
              ? `预览：${getCardDisplayModeMeta(hoveredMode).name}`
              : '方向键切换 · Enter 确认'}
          </span>
        </div>
      )}

      {/* 手机端自动降级提示条（仅当 <640px 且用户选择了桌面专属模式时出现） */}
      {mobileFallbackMeta && (
        <div className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Monitor className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            当前手机屏自动适配为「{mobileFallbackMeta.name}」，切回桌面端自动恢复「{currentMeta.name}」。
          </span>
        </div>
      )}

      {/* WAI-ARIA radiogroup：1 默认推荐 + 3 分组严格对称 2 列网格（视觉 4 + 高效 4 + 极简 2，零孤项） */}
      <div
        role="radiogroup"
        aria-label="选择网址展示样式"
        className="space-y-2.5"
      >
        <div className={cn(sheet ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-1.5')}>
          {renderModeOptionButton(featuredOption, 0, { featured: true, sheet, compact })}
        </div>

        {modeGroups.map((grp) => {
          const items = CARD_DISPLAY_MODE_OPTIONS.filter((opt) => opt.group === grp.key)
          if (items.length === 0) return null
          return (
            <div key={grp.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 px-0.5">
                <span className="text-[11px] font-semibold text-foreground">{grp.label}</span>
                <span className="truncate text-[10px] text-muted-foreground">{grp.hint}</span>
              </div>
              <div className={cn(sheet ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-1.5')}>
                {items.map((opt) =>
                  renderModeOptionButton(opt, indexById.get(opt.id) ?? 0, {
                    featured: false,
                    sheet,
                    compact,
                  }),
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部快捷联动：间距密度 + 恢复默认 */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">间距</span>
          <div
            role="group"
            aria-label="快捷切换排版间距"
            className="inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5"
          >
            {DENSITY_PILLS.map((pill) => {
              const active = density === pill.id
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setDensity(pill.id)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer',
                    active
                      ? 'bg-background text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {pill.label}
                </button>
              )
            })}
          </div>
        </div>

        {isCustomMode && (
          <button
            type="button"
            onClick={() => handleSelect('standard', variant === 'toolbar')}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>恢复默认</span>
          </button>
        )}
      </div>
    </div>
  )

  if (variant === 'inline') {
    return (
      <div className={cn('rounded-xl border border-border/70 bg-card/70 p-3', className)}>
        {renderGalleryBody({ compact: true, sheet: false })}
      </div>
    )
  }

  const triggerButton = (
    <Button
      ref={triggerRef}
      type="button"
      variant="ghost"
      data-testid="site-display-mode-trigger"
      aria-label={`切换网址展示模式，当前为${currentMeta.name}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={mounted && isBelowMd ? () => handleOpenChange(true) : undefined}
      className={cn(
        'relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-0 transition-colors sm:w-auto sm:flex-row sm:gap-1.5 sm:px-2.5 md:w-11 md:px-0 xl:w-auto xl:px-2.5',
        isCustomMode
          ? 'border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/[0.14]'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        className,
      )}
    >
      <ModeIcon mode={currentMode} className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap text-[10px] leading-none sm:text-xs sm:font-medium">
        <span className="sm:hidden">展示</span>
        <span className="hidden sm:inline md:hidden">{currentMeta.shortName}</span>
        <span className="hidden xl:inline">{currentMeta.shortLabel}</span>
      </span>
      <ChevronDown
        className={cn(
          'hidden h-3 w-3 shrink-0 opacity-65 transition-transform duration-150 sm:inline-block md:hidden xl:inline-block',
          open && 'rotate-180',
        )}
      />
    </Button>
  )

  // 移动端（< 768px）：升级为原生底部抽屉 Bottom Sheet
  if (mounted && isBelowMd) {
    return (
      <>
        {triggerButton}
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetContent
            side="bottom"
            data-testid="site-display-mode-sheet"
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              restoreTriggerFocus()
            }}
            className="max-h-[84vh] overflow-y-auto rounded-t-2xl border-t border-border/80 bg-popover px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl"
          >
            <div aria-hidden="true" className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-border" />
            <SheetHeader className="mb-3 space-y-0.5 text-left">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-sm font-bold tracking-tight">网址展示模式</SheetTitle>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                  {CARD_DISPLAY_MODE_OPTIONS.length} 种风格
                </span>
              </div>
              <SheetDescription className="text-xs">
                选择最顺手的网址浏览形态，偏好跨刷新自动同步。
              </SheetDescription>
            </SheetHeader>
            {renderGalleryBody({ compact: false, sheet: true })}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  // 桌面端（>= 768px）：540px 宽对称分组 2 列卡片网格 Popover（实底防透字 + collisionPadding 防贴边）
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          切换网址展示样式（当前：{currentMeta.name} · {CARD_DISPLAY_MODE_OPTIONS.length} 种模式可选）
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          restoreTriggerFocus()
        }}
        className="w-[min(540px,calc(100vw-1.5rem))] max-h-[min(82vh,640px)] overflow-y-auto rounded-2xl border border-border bg-popover p-3.5 text-popover-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        {renderGalleryBody({ compact: false, sheet: false })}
      </PopoverContent>
    </Popover>
  )
}
