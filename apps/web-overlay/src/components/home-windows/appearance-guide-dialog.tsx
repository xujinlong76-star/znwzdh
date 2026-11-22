'use client'

/**
 * 「外观、排版与新手向导」统一小窗口（A4）：
 * 将原先工具栏右侧堆叠的低频按钮（视图模式 / 密度 / 字号 / 长辈模式 / 皮肤 / DIY 开关）
 * 与正文中大面积的 OnboardingCard + 顶部遮挡的 HomepageBanner 设首页引导统一收拢，
 * 用时点击弹出、用完关闭。
 */
import { useEffect, useState } from 'react'
import { Bookmark, Cat, Check, Compass, Palette, SlidersHorizontal, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/registry/new-york/ui/tabs'
import { Button } from '@/registry/new-york/ui/button'
import { ViewModeToggle } from '@/components/view-mode-toggle'
import { DensityToggle } from '@/components/density-toggle'
import { FontSizeToggle } from '@/components/font-size-toggle'
import { ElderModeToggle } from '@/components/elder-mode-toggle'
import { HighContrastToggle } from '@/components/high-contrast-toggle'
import { SceneSwitcher } from '@/components/scene-switcher'
import { SkinPicker } from '@/components/skin-picker'
import { ModeToggle } from '@/components/mode-toggle'
import { OnboardingCard } from '@/components/onboarding-card'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { trackDiyEvent } from '@/lib/navhub-api'
import {
  claimHomepageAction,
  HOMEPAGE_BANNER_DISMISSED_KEY,
  HOMEPAGE_CLAIM_XP,
  loadGrowthProfile,
} from '@/lib/growth-lazy'
import { useToast } from '@/components/ui/use-toast'

interface XiaomaomaoBridge {
  getState?: () => { alwaysDynamic: boolean; closed: boolean; play: boolean }
  setAlwaysDynamic?: (on: boolean) => boolean
  setCollapsed?: (closed: boolean) => boolean
  togglePlay?: (on?: boolean) => boolean
}

function getCatBridge(): XiaomaomaoBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { XIAOMAOMAO?: XiaomaomaoBridge }).XIAOMAOMAO
}

export interface AppearanceGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: 'appearance' | 'guide'
}

export function AppearanceGuideDialog({
  open,
  onOpenChange,
  defaultTab = 'appearance',
}: AppearanceGuideDialogProps) {
  const { isEditingLayout, toggleEditingLayout } = useHomeDIY()
  const { toast } = useToast()
  const [tab, setTab] = useState<'appearance' | 'guide'>(defaultTab)
  const [claimedHomepage, setClaimedHomepage] = useState(false)
  const [hcAnnouncement, setHcAnnouncement] = useState('')
  const [catState, setCatState] = useState<{
    available: boolean
    alwaysDynamic: boolean
    closed: boolean
    play: boolean
  }>({
    available: false,
    // 与挂件默认一致（U-260：默认 false，60 秒闲置贴边才生效；打开小窗后由 getState 同步真实值）
    alwaysDynamic: false,
    closed: false,
    play: false,
  })

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab, open])

  useEffect(() => {
    const syncCat = () => {
      const api = getCatBridge()
      if (!api?.getState) return
      const s = api.getState()
      setCatState({
        available: true,
        alwaysDynamic: s.alwaysDynamic,
        closed: s.closed,
        play: s.play,
      })
    }
    syncCat()
    const handleCatEvent = () => syncCat()
    window.addEventListener('navhub:xiaomaomao-state', handleCatEvent)
    return () => window.removeEventListener('navhub:xiaomaomao-state', handleCatEvent)
  }, [open])

  // 高对比播报：本站内开关（工具栏 / 本弹窗）经同一事件总线同步，
  // 此处只监听事件播报一次；开关本身的状态与同步由 HighContrastToggle 管。
  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ on?: boolean }>).detail
      if (typeof detail?.on === 'boolean') {
        setHcAnnouncement(detail.on ? '已开启高对比' : '已关闭高对比')
      }
    }
    window.addEventListener('navhub:high-contrast-changed', announce)
    return () => window.removeEventListener('navhub:high-contrast-changed', announce)
  }, [open])

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(HOMEPAGE_BANNER_DISMISSED_KEY) === '1'
      setClaimedHomepage(dismissed || Boolean(loadGrowthProfile().homepageClaimedAt))
    } catch {
      // 存储不可用时仅按未领取态展示
    }
  }, [open])

  const handleClaimHomepage = () => {
    try {
      window.localStorage.setItem(HOMEPAGE_BANNER_DISMISSED_KEY, '1')
    } catch {
      // 容错：无痕或配额限制不阻断成长回调
    }
    setClaimedHomepage(true)
    claimHomepageAction()
    toast({
      title: '已标记为常用起始页',
      description: `感谢支持！Ctrl/⌘+D 可加入书签，或在浏览器设置中将本站设为主页（+${HOMEPAGE_CLAIM_XP} 经验）。`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] w-[calc(100vw-1.5rem)] max-h-[84vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <span>外观排版与新手向导</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            按需调节视觉风格、适老字号与 DIY 排版，或查看 3 步快速上手与设首页指南。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next === 'guide' ? 'guide' : 'appearance')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full grid-cols-2 shrink-0 h-auto p-1">
            <TabsTrigger value="appearance" className="min-h-9 gap-1.5 text-xs">
              <Palette className="h-3.5 w-3.5" />
              <span>外观与排版</span>
            </TabsTrigger>
            <TabsTrigger value="guide" className="min-h-9 gap-1.5 text-xs">
              <Compass className="h-3.5 w-3.5" />
              <span>新手向导与设首页</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="appearance" className="mt-0 space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">视图模式</p>
                    <p className="text-[11px] text-muted-foreground">简洁流 / 混合 / 沉浸工作台</p>
                  </div>
                  <ViewModeToggle />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">排版密度</p>
                    <p className="text-[11px] text-muted-foreground">紧凑 / 标准 / 宽敞</p>
                  </div>
                  <DensityToggle />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">字号大小</p>
                    <p className="text-[11px] text-muted-foreground">标准 / 大字 / 特大字</p>
                  </div>
                  <FontSizeToggle />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">长辈适老模式</p>
                    <p className="text-[11px] text-muted-foreground">特大字 + 宽松间距</p>
                  </div>
                  <ElderModeToggle />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">高对比</p>
                    <p className="text-[11px] text-muted-foreground">加深文字与边框，弱光下也看得清；与长辈模式可同时开启</p>
                  </div>
                  <HighContrastToggle />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">我的场景预设</p>
                    <p className="text-[11px] text-muted-foreground">一键切换工作区布局</p>
                  </div>
                  <SceneSwitcher />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold">皮肤与明暗主题</p>
                    <p className="text-[11px] text-muted-foreground">成套主题皮肤 / 深浅模式</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <SkinPicker />
                    <ModeToggle />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/70 p-3">
                <div className="flex items-start gap-2">
                  <Cat className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">桌面动态萌宠（小猫猫）</p>
                    <p className="text-[11px] text-muted-foreground">
                      {catState.available
                        ? '支持开启「全时动态」保持持续动效不休眠，或进入「满屏陪玩」。'
                        : '挂件按需加载中，加载完成后可直接在此开关动效。'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!catState.available}
                    variant={catState.alwaysDynamic ? 'default' : 'outline'}
                    onClick={() => {
                      const next = getCatBridge()?.setAlwaysDynamic?.(!catState.alwaysDynamic)
                      if (typeof next === 'boolean') {
                        setCatState((prev) => ({ ...prev, alwaysDynamic: next }))
                      }
                    }}
                    className="h-9 text-xs"
                  >
                    {catState.alwaysDynamic ? '全时动态：开' : '全时动态：关'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!catState.available}
                    variant={catState.play ? 'secondary' : 'outline'}
                    onClick={() => {
                      const next = getCatBridge()?.togglePlay?.(!catState.play)
                      if (typeof next === 'boolean') {
                        setCatState((prev) => ({ ...prev, play: next }))
                      }
                    }}
                    className="h-9 gap-1 text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{catState.play ? '退出陪玩' : '满屏陪玩'}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!catState.available}
                    variant="outline"
                    onClick={() => {
                      const next = getCatBridge()?.setCollapsed?.(!catState.closed)
                      if (typeof next === 'boolean') {
                        setCatState((prev) => ({ ...prev, closed: next }))
                      }
                    }}
                    className="h-9 text-xs"
                  >
                    {catState.closed ? '唤回小猫' : '收成圆标'}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">DIY 自由排版工坊</p>
                  <p className="text-[11px] text-muted-foreground">
                    开启后可自由隐藏、置顶、拖拽分类顺序与背景质感（快捷键 Ctrl/⌘+E）。
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={isEditingLayout ? 'default' : 'outline'}
                  onClick={() => {
                    // U-155：只在开启时计入分子；isEditingLayout=true 时文案是「退出 DIY」，
                    // 无条件上报会把退出也计入开启分子
                    if (!isEditingLayout) trackDiyEvent('diy_open_click')
                    toggleEditingLayout()
                    onOpenChange(false)
                  }}
                  className="h-10 shrink-0 gap-1.5 text-xs font-semibold"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>{isEditingLayout ? '退出 DIY' : '开启 DIY'}</span>
                </Button>
              </div>

              {/* 高对比切换播报：复用站内已有的 sr-only live-region 模式
                  （favorites/page、ai-copilot-drawer 同款 role="status"），
                  切换后读屏播报一次，平时不占视觉空间 */}
              <div role="status" aria-live="polite" className="sr-only">
                {hcAnnouncement}
              </div>
            </TabsContent>

            <TabsContent value="guide" className="mt-0 space-y-3">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bookmark className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        设成浏览器起始页 / 收藏夹（领 +{HOMEPAGE_CLAIM_XP} 经验）
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        按 <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Ctrl/⌘+D</kbd> 一键收藏，或在浏览器设置 → 启动时打开特定网页。
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={claimedHomepage ? 'secondary' : 'default'}
                    onClick={handleClaimHomepage}
                    className="h-9 shrink-0 gap-1 text-xs"
                  >
                    {claimedHomepage ? <Check className="h-3.5 w-3.5" /> : null}
                    <span>{claimedHomepage ? '已完成指引' : '我已收藏 / 设为首页'}</span>
                  </Button>
                </div>
              </div>

              <div className="[&>div]:mb-0">
                <OnboardingCard />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
