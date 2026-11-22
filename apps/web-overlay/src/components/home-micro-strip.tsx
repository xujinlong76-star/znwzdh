'use client'

/**
 * 首页单行「动态微胶囊」功能条（A1 + A4 + AI 找站 + 设首页入口）：
 * 将原本各自占几百像素的大模块收敛到 1 行 ~36px 胶囊带中，保持核心站点卡片首屏可见：
 *  - 🎬 短剧热榜 / ▶ 继续追（点开迷你短剧小窗，保留 /drama 语义链接）
 *  - ✨ AI 智能找站（点开找站小窗，保留 /scenes 语义链接）
 *  - 🧩 热门插件精选（展示 2 个插件标签 + 更多精选小窗 + /marketplace 链接）
 *  - 👋 新手向导徽章（未完成/未忽略时显示，点开向导与设首页小窗）
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Clapperboard, Compass, Puzzle, Sparkles } from 'lucide-react'
import { useWatchlist } from '@/hooks/useWatchlist'
import { formatRelativeTime } from '@/lib/format-relative-time'
import { HorizontalScrollFade } from '@/components/horizontal-scroll-fade'
import type { CinemaInitialData } from '@/components/home-drama-cinema'
import {
  collectDramaContextSectionIds,
  dramaExposureAllowed,
  isDramaContextCategory,
  readDramaHotlistOptIn,
} from '@/lib/modular/workspace-presets'
import { useDramaHotlistOptIn } from '@/hooks/useDramaHotlistOptIn'
import type { HubPluginItem } from '@/lib/navhub-api'
import { MARKETPLACE_CATEGORIES_PATH } from '@/lib/plugins/marketplace-categories'
import { ONBOARDING_DISMISSED_VALUE, ONBOARDING_STORAGE_KEY } from '@/lib/onboarding'
import { HOMEPAGE_BANNER_DISMISSED_KEY } from '@/lib/growth-lazy'

const DramaMiniDialog = dynamic(
  () => import('@/components/home-windows/drama-mini-dialog').then((m) => m.DramaMiniDialog),
  { ssr: false, loading: () => null },
)
const PluginSpotlightDialog = dynamic(
  () => import('@/components/home-windows/plugin-spotlight-dialog').then((m) => m.PluginSpotlightDialog),
  { ssr: false, loading: () => null },
)
const AiFinderDialog = dynamic(
  () => import('@/components/home-windows/ai-finder-dialog').then((m) => m.AiFinderDialog),
  { ssr: false, loading: () => null },
)

export interface HomeMicroStripProps {
  cinemaInitial?: CinemaInitialData
  pluginItems: HubPluginItem[] | null
  showDramaCapsule?: boolean
  showAiCapsule?: boolean
  showGuideBadge?: boolean
  onOpenGuideTab?: () => void
  /** 当前场景 Tab（研发全栈 'dev' / AI 实验室 'ai' 时隐藏短剧推广胶囊，首屏瘦身） */
  activeWorkspace?: string
  initialSceneParam?: string | null
}

export function HomeMicroStrip({
  cinemaInitial,
  pluginItems,
  showDramaCapsule = true,
  showAiCapsule = true,
  showGuideBadge = true,
  onOpenGuideTab,
  activeWorkspace,
  initialSceneParam = null,
}: HomeMicroStripProps) {
  const { ready: watchlistReady, entries: watchlistEntries } = useWatchlist()
  const [dramaOpen, setDramaOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [guidePending, setGuidePending] = useState(false)

  useEffect(() => {
    try {
      const onboardingDismissed =
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_DISMISSED_VALUE
      const homepageClaimed = window.localStorage.getItem(HOMEPAGE_BANNER_DISMISSED_KEY) === '1'
      setGuidePending(!(onboardingDismissed && homepageClaimed))
    } catch {
      // 存储受限时保留轻量向导入口
      setGuidePending(true)
    }
  }, [])

  useEffect(() => {
    if (initialSceneParam) {
      setAiOpen(true)
    }
  }, [initialSceneParam])

  const latestWatch = watchlistReady && watchlistEntries.length > 0 ? watchlistEntries[0] : null
  // B1 收尾：胶囊时间 meta——只写该剧真实改进度的时间。还没开始看
  // （episode = 0）或 lastProgressAt 非法时不写，绝不渲染“—”。
  const latestWatchProgress =
    latestWatch &&
    latestWatch.episode > 0 &&
    typeof latestWatch.lastProgressAt === 'number' &&
    Number.isFinite(latestWatch.lastProgressAt) &&
    latestWatch.lastProgressAt > 0
      ? formatRelativeTime(latestWatch.lastProgressAt)
      : null
  const topPlugins = pluginItems?.slice(0, 2) ?? []
  /*
   * 短剧热榜默认移出全局首屏（2026-11-22）：
   * 只有「影音娱乐/短剧分类上下文」或「DIY 显式开启」才放行。
   * 不再按 workspace === dev/ai 硬编码隐藏——那会误伤 DIY 在该场景的显式开启。
   */
  const diyOptIn = useDramaHotlistOptIn()
  const dramaContextIds = collectDramaContextSectionIds([])
  const inDramaCategoryContext =
    dramaContextIds.size > 0 ||
    isDramaContextCategory(String(activeWorkspace ?? '')) ||
    activeWorkspace === 'short-drama'
  const showDrama =
    showDramaCapsule &&
    dramaExposureAllowed({ inDramaCategoryContext, diyOptIn })

  // 通告条与各胶囊是并列的渲染门槛：通告条默认关不能连带藏掉
  // DIY 开启或分类上下文下的短剧热榜。
  const pluginVisible = Boolean(topPlugins.length) || Boolean(pluginItems)
  const guideVisible = showGuideBadge && Boolean(guidePending && onOpenGuideTab)
  const announceVisible = true
  const hasAnything = showDrama || pluginVisible || guideVisible

  return (
    <>
      <HorizontalScrollFade
        className="mb-2.5"
        scrollClassName="flex items-center gap-1.5 py-0.5 text-xs"
        ariaLabel="首页快捷功能小窗入口"
        showArrows={false}
      >
        {showDrama ? (
          <div className="inline-flex h-8 shrink-0 items-center rounded-full border border-amber-500/30 bg-amber-500/8 px-2.5 text-amber-800 dark:text-amber-300">
            <button
              type="button"
              onClick={() => setDramaOpen(true)}
              className="inline-flex items-center gap-1 font-medium hover:underline cursor-pointer"
            >
              <Clapperboard className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[170px] truncate">
                {latestWatch ? `继续追《${latestWatch.title}》` : '今日短剧热榜'}
                {latestWatchProgress ? ` · ${latestWatchProgress}` : ''}
              </span>
            </button>
            <span aria-hidden="true" className="mx-1.5 opacity-40">|</span>
            <Link
              href="/drama"
              className="shrink-0 text-[11px] opacity-85 hover:opacity-100 hover:underline"
            >
              专区
            </Link>
          </div>
        ) : null}

        {showAiCapsule ? (
          <div className="inline-flex h-8 shrink-0 items-center rounded-full border border-primary/25 bg-primary/8 px-2.5 text-primary">
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="inline-flex items-center gap-1 font-medium hover:underline cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>AI 找站</span>
            </button>
            <span aria-hidden="true" className="mx-1.5 opacity-40">|</span>
            <Link
              href="/scenes"
              className="shrink-0 text-[11px] opacity-85 hover:opacity-100 hover:underline"
            >
              场景
            </Link>
          </div>
        ) : null}

        <div className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/45 px-2.5 text-foreground">
          <button
            type="button"
            onClick={() => setPluginsOpen(true)}
            className="inline-flex items-center gap-1 font-medium hover:text-primary cursor-pointer"
          >
            <Puzzle className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>插件精选</span>
          </button>
          {topPlugins.map((plugin) => (
            <Link
              key={plugin.slug}
              href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
              className="hidden sm:inline-block max-w-[110px] truncate rounded-full bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary"
            >
              {plugin.name}
            </Link>
          ))}
          <span aria-hidden="true" className="opacity-35">|</span>
          <Link
            href="/marketplace"
            className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-primary"
          >
            市场
          </Link>
          <Link
            href={MARKETPLACE_CATEGORIES_PATH}
            className="sr-only"
          >
            插件分类目录
          </Link>
        </div>

        {showGuideBadge && guidePending && onOpenGuideTab ? (
          <button
            type="button"
            onClick={onOpenGuideTab}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-2.5 font-medium text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300 cursor-pointer"
          >
            <Compass className="h-3.5 w-3.5 shrink-0" />
            <span>向导与设首页</span>
          </button>
        ) : null}
        {announceVisible ? (
          <span className="sr-only">快捷入口通告</span>
        ) : null}
      </HorizontalScrollFade>

      {dramaOpen ? (
        <DramaMiniDialog open={dramaOpen} onOpenChange={setDramaOpen} initial={cinemaInitial} />
      ) : null}
      {pluginsOpen ? (
        <PluginSpotlightDialog open={pluginsOpen} onOpenChange={setPluginsOpen} items={pluginItems} />
      ) : null}
      {aiOpen ? (
        <AiFinderDialog open={aiOpen} onOpenChange={setAiOpen} sceneTrigger={initialSceneParam} />
      ) : null}
    </>
  )
}
