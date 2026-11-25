'use client'

/**
 * 用户中心「全局设置」表单（纯展示）。
 *
 * 与 `/me` 概览分离：设置页负责编辑，概览只保留摘要。控件沿用仓库现有风格
 * （select + 双态按钮），避免为一个表单引入新的 UI 依赖。
 */
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  isOnboardingDismissed,
  resetOnboarding,
} from '@/lib/onboarding'
import {
  CARD_DENSITY_OPTIONS,
  RETENTION_DAY_OPTIONS,
  SEARCH_ENGINE_OPTIONS,
  SPOTLIGHT_SHORTCUT_OPTIONS,
  type CardDensityMode,
  type HistoryRetentionDays,
  type SearchEngineId,
  type SpotlightShortcutMode,
  type ThemePreference,
  type UserSettingsModel,
  type UserSettingsPatch,
} from '@/lib/user-settings'
import { useTriageSettings, writeTriageSettings } from '@/hooks/useTriageSettings'
import { useHibernationSettings, writeHibernationSettings } from '@/hooks/useHibernationSettings'
import {
  TRIAGE_INBOX_HOUR_OPTIONS,
  TRIAGE_READ_DAY_OPTIONS,
  type TriageInboxHours,
  type TriageReadDays,
} from '@/lib/favorites-triage'
import {
  HIBERNATION_THRESHOLD_DAY_OPTIONS,
  type HibernationThresholdDays,
} from '@/lib/favorites-hibernation'
import type { FeatureKey } from '@/lib/site-settings'
import { Settings2, Zap, ChevronDown, Command, Inbox, Moon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import {
  fetchInstalledPlugins,
  fetchPluginDetail,
  fetchSite,
  type HubPluginInstalledItem,
} from '@/lib/navhub-api'
import {
  getActiveTheme,
  isThemeSuspended,
  resetTheme,
  setActiveTheme,
  type ActiveThemeConfig,
} from '@/lib/plugins/theme-runtime'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { QUICK_DIAL_DIGITS, type QuickDialDigit } from '@/lib/number-dial'
import {
  FONT_SIZE_LABEL,
  FONT_SIZE_PX,
  FONT_SIZE_STORAGE_KEY,
  applyFontSizeLevel,
  loadFontSizeLevel,
  type FontSizeLevel,
} from '@/lib/font-size'
import {
  HALF_SCREEN_DOCK_CHANGED_EVENT,
  loadHalfScreenDockOn,
  setHalfScreenDockOn,
} from '@/lib/half-screen-dock'

const FONT_SIZE_LEVELS: FontSizeLevel[] = ['standard', 'large', 'xlarge']

/**
 * 字号大小（本机设置）：与工具栏字号按钮共用 lib/font-size 的同一份
 * localStorage，不走服务端用户设置（字号是这台设备的显示偏好）。
 * A13：此前字号入口只有工具栏且 hidden lg:，手机上无处可改；
 * 设置页给一个带文字标签的入口，年长用户找得到、点得到。
 */
function FontSizeField({ idPrefix }: { idPrefix: string }) {
  const [level, setLevel] = useState<FontSizeLevel>('standard')
  useEffect(() => {
    setLevel(loadFontSizeLevel(window.localStorage))
  }, [])
  const choose = (next: FontSizeLevel) => {
    setLevel(next)
    applyFontSizeLevel(next, document.documentElement)
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, next)
    } catch {
      /* 写不进本机存储时本次会话内仍生效 */
    }
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-font-size`} className="block text-xs font-medium text-foreground">
        字号大小
      </label>
      <SettingsSelect
        id={`${idPrefix}-font-size`}
        label="字号大小"
        value={level}
        onChange={(e) => choose(e.target.value as FontSizeLevel)}
      >
        {FONT_SIZE_LEVELS.map((lv) => (
          <option key={lv} value={lv}>
            {FONT_SIZE_LABEL[lv]}（{FONT_SIZE_PX[lv]}px）
          </option>
        ))}
      </SettingsSelect>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        与首页右上角的字号按钮是同一份设置，改一处两处同步；只存这台设备。
      </p>
    </div>
  )
}

/**
 * 半屏下沉栏（本机设置）：与字号同款纪律，只动本机 localStorage
 *（lib/half-screen-dock.ts 的 navhub.halfScreenDock.v1），不走服务端
 * 用户设置——不接密度设置用的 SettingsSelect + 云端 onChange。
 * 放在密度设置同区：两者是同一类「首页排版偏好」。
 */
function HalfScreenDockField({ idPrefix }: { idPrefix: string }) {
  const [on, setOn] = useState(true)
  useEffect(() => {
    setOn(loadHalfScreenDockOn(window.localStorage))
    const refresh = () => setOn(loadHalfScreenDockOn(window.localStorage))
    window.addEventListener(HALF_SCREEN_DOCK_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(HALF_SCREEN_DOCK_CHANGED_EVENT, refresh)
  }, [])
  const toggle = () => {
    const next = !on
    setHalfScreenDockOn(next, window.localStorage)
    setOn(next)
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-half-screen-dock`} className="block text-xs font-medium text-foreground">
        半屏下沉栏
      </label>
      <Button
        id={`${idPrefix}-half-screen-dock`}
        size="sm"
        variant={on ? 'outline' : 'default'}
        className="h-7 text-[11px]"
        onClick={toggle}
        aria-pressed={on}
      >
        {on ? '已开启' : '已关闭'}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        视口 640–1024px 时，首页底部出现一条常驻操作栏，放回半屏下工具栏里丢失的场景、密度、视图、工具箱与热度榜入口；只存这台设备。
      </p>
    </div>
  )
}

/**
 * 主题外观（本机设置）：与字号同款纪律，只动本机 localStorage 与主题运行时，
 * 不走服务端用户设置（主题是这台设备的显示偏好）。
 * B12：种子主题早已能经「市场安装→本机激活」链用上，但普通用户日常入口
 * 只有 /marketplace/installed 管家页，设置页没有主题选择器——等于白做一半。
 * 本字段把已安装主题列进设置页：系统默认在首位，一点即换；没装主题时给去
 * 市场主题分类的直达链接，不谎称已装；拉取失败时明说取不到并给重试。
 * 切换与管家页共用 lib/plugins/theme-runtime 的同一套函数，不另立真相。
 * B12 后半句：主题只在浅色模式下生效，深色下暂停——本字段读
 * isThemeSuspended()，暂停时明说「已保存，深色模式下暂停，回到浅色自动恢复」，
 * 不谎称正在使用。
 */
function ThemeField({ idPrefix }: { idPrefix: string }) {
  const [themes, setThemes] = useState<HubPluginInstalledItem[]>([])
  const [activeTheme, setActiveThemeState] = useState<ActiveThemeConfig | null>(null)
  const [themeSuspended, setThemeSuspended] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadThemes = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    try {
      const res = await fetchInstalledPlugins(undefined, () => setLoadFailed(true))
      setThemes(res.items.filter((item) => item.kind === 'theme'))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setActiveThemeState(getActiveTheme())
    setThemeSuspended(isThemeSuspended())
    void loadThemes()
    const onThemeChange = () => {
      setActiveThemeState(getActiveTheme())
      setThemeSuspended(isThemeSuspended())
    }
    window.addEventListener('navhub_theme_changed', onThemeChange)
    return () => window.removeEventListener('navhub_theme_changed', onThemeChange)
  }, [loadThemes])

  const choose = async (slug: string) => {
    setError(null)
    if (!slug) {
      resetTheme()
      setActiveThemeState(null)
      return
    }
    setApplying(true)
    try {
      const detail = await fetchPluginDetail(slug)
      const payload = detail?.plugin?.manifest?.payload
      if (!payload) {
        setError('无法激活主题：未能加载清单配置')
        return
      }
      const target = themes.find((t) => t.slug === slug)
      setActiveTheme({
        slug,
        name: target?.name ?? detail.plugin.name,
        tokens: payload.tokens,
        accent: payload.accent,
      })
      setActiveThemeState(getActiveTheme())
    } catch (err) {
      setError(`主题应用失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setApplying(false)
    }
  }

  const activeSlug = activeTheme?.slug ?? ''
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-theme`} className="block text-xs font-medium text-foreground">
        主题外观
      </label>
      <SettingsSelect
        id={`${idPrefix}-theme`}
        label="主题外观"
        value={activeSlug}
        disabled={loading || applying}
        onChange={(e) => void choose(e.target.value)}
      >
        <option value="">系统默认</option>
        {themes.map((theme) => (
          <option key={theme.slug} value={theme.slug}>
            {theme.name}
          </option>
        ))}
      </SettingsSelect>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {loading
          ? '正在加载已安装的主题…'
          : loadFailed
            ? '主题列表暂时取不到，稍后再试。'
            : themes.length === 0
              ? '还没安装主题，去插件市场挑一套装上就能在这里切换。'
              : activeTheme && themeSuspended
                ? `「${activeTheme.name}」已保存，深色模式下暂停，回到浅色自动恢复。`
                : activeTheme
                  ? `正在使用「${activeTheme.name}」，只存这台设备；换设备要重新安装。`
                  : '使用系统默认外观；选一套主题立即换上，只存这台设备。'}
      </p>
      {themes.length === 0 && !loading && !loadFailed && (
        <p className="text-[11px] leading-relaxed">
          <Link href="/marketplace?kind=theme" className="font-medium text-primary underline underline-offset-2">
            去插件市场看看主题
          </Link>
        </p>
      )}
      {loadFailed && !loading && (
        <p>
          <button
            type="button"
            onClick={() => void loadThemes()}
            className="text-[11px] font-medium text-primary underline underline-offset-2"
          >
            重新加载主题列表
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive-text">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 新手引导重看（本机设置）：与字号同款纪律，只动本机 localStorage。
 * B11：引导卡注释承诺「设置页可重新打开」，此前却没有任何入口——
 * 关掉引导的用户除手动清 localStorage 外再也看不到它。
 * 点按即清除关闭记录并回首页，卡片重新出现；引导本来就没关过时
 * 按钮只是直达首页，不说「重新查看」的假话。
 */
function OnboardingReplayField() {
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  useEffect(() => {
    setDismissed(isOnboardingDismissed(window.localStorage))
  }, [])
  const replay = () => {
    resetOnboarding(window.localStorage)
    setDismissed(false)
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">新手引导</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {dismissed === null
            ? '三步引导（导入书签 / 搜索 / 收藏）在首页顶栏「DIY 排版 → 外观与向导」里；关掉后可从这里重置。'
            : dismissed
              ? '你之前关掉了三步引导。点这里清除关闭记录后回到首页，再从「DIY 排版 → 外观与向导」打开。'
              : '三步引导在首页顶栏「DIY 排版 → 外观与向导」里，点下面的按钮回到首页即可打开。'}
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-[11px]">
        <Link href="/" onClick={replay}>
          {dismissed ? '重置并回到首页' : '去首页打开引导'}
        </Link>
      </Button>
    </div>
  )
}

/**
 * 原生 select 的轻量皮肤：保留原生语义与键盘行为，仅统一为设计语言
 * （appearance-none + 自绘箭头 + focus ring）。原生灰盒控件在整套
 * 圆角卡片风格里会显得像漏网之鱼。
 */
function SettingsSelect({ className, label, ...rest }: ComponentProps<'select'> & { label: string }) {
  return (
    <span className="relative block">
      <select
        {...rest}
        aria-label={label}
        className={`h-9 w-full appearance-none rounded-lg border border-border bg-background pl-2.5 pr-8 text-sm text-foreground shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ''}`}
      />
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </span>
  )
}

interface SettingsPanelProps {
  value: UserSettingsModel
  busy: boolean
  idPrefix: string
  onChange: (patch: UserSettingsPatch, successTitle?: string) => void
  onRestoreDefaults: () => void
}

/** 双态开关：沿用仓库里「已开启 / 已关闭」的按钮文案，保持既有交互与测试稳定 */
function ToggleRow({
  title,
  hint,
  enabled,
  busy,
  onToggle,
  icon,
}: {
  title: string
  hint: string
  enabled: boolean
  busy: boolean
  onToggle: () => void
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-xs font-medium">
          {icon}
          {title}
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Button
        size="sm"
        variant={enabled ? 'outline' : 'default'}
        className="h-7 shrink-0 text-[11px]"
        disabled={busy}
        onClick={onToggle}
        aria-pressed={enabled}
      >
        {enabled ? '已开启' : '已关闭'}
      </Button>
    </div>
  )
}

/**
 * 待读分流（本机设置）：与字号 / 主题同款纪律，只动本机 localStorage，
 * 不走服务端用户设置——服务端 settingsPatchSchema 不认识这三个键，
 * PATCH 会被剥掉，若放进模型，云端回读还会把本机值冲回默认
 * （见 lib/favorites-triage 文件头）。
 * 所以这一节不经过面板的 onChange（云端保存路径），而是直写分流偏好键；
 * 值来自 useTriageSettings 的 live 快照，改完界面立刻同步。
 */
function TriageSettingsSection({ busy, idPrefix }: { busy: boolean; idPrefix: string }) {
  const triage = useTriageSettings()
  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background/50 p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        <Inbox className="h-4 w-4 text-sky-500" aria-hidden />
        待读分流
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        新收藏先放进待读箱，规定时间里没打开就移到「已移出」（可找回，不会直接删掉）。
        只存这台设备，不会上传到云端；改窗口后，已有待读条目的到期时间跟着变。
        上面的「恢复默认偏好」只恢复云端偏好，不重置这里的分流设置。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ToggleRow
          title="待读分流"
          hint={
            triage.enabled
              ? '新收藏先进待读箱，到期未读再移出'
              : '已关闭：新收藏直接进永久库，已有的待读箱冻结、不再结算'
          }
          enabled={triage.enabled}
          busy={busy}
          onToggle={() => writeTriageSettings({ enabled: !triage.enabled })}
        />
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-triage-inbox-hours`} className="block text-xs font-medium text-foreground">
            待读箱保留时长
          </label>
          <SettingsSelect
            id={`${idPrefix}-triage-inbox-hours`}
            label="待读箱保留时长"
            value={triage.inboxHours}
            disabled={busy || !triage.enabled}
            onChange={(e) =>
              writeTriageSettings({ inboxHours: Number(e.target.value) as TriageInboxHours })
            }
          >
            {TRIAGE_INBOX_HOUR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            超过这个时间没打开，就移到「已移出」。
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-triage-read-days`} className="block text-xs font-medium text-foreground">
            已读保留天数
          </label>
          <SettingsSelect
            id={`${idPrefix}-triage-read-days`}
            label="已读保留天数"
            value={triage.readDays}
            disabled={busy || !triage.enabled}
            onChange={(e) =>
              writeTriageSettings({ readDays: Number(e.target.value) as TriageReadDays })
            }
          >
            {TRIAGE_READ_DAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            打开后进「已读」，超过这个天数没晋升，同样移到「已移出」。
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * 冬眠收藏（本机设置）：与 TriageSettingsSection 同款纪律，只动本机 localStorage，
 * 不走服务端用户设置——服务端 settingsPatchSchema 不认识这两个键，
 * PATCH 会被剥掉，若放进模型，云端回读还会把本机值冲回默认。
 * 所以这一节不经过面板的 onChange（云端保存路径），而是直写冬眠偏好键；
 * 值来自 useHibernationSettings 的 live 快照，改完界面立刻同步。
 *
 * 冬眠不是删除：超过阈值本机没记录到打开的永久收藏，只沉到收藏页底部
 * 的折叠区，搜索 / 合集 / 公开页照常能找到；点标题打开一次就能唤醒。
 */
function HibernationSettingsSection({ busy, idPrefix }: { busy: boolean; idPrefix: string }) {
  const hibernation = useHibernationSettings()
  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background/50 p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        <Moon className="h-4 w-4 text-slate-500" aria-hidden />
        冬眠收藏
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        长期没打开的收藏自动沉到收藏页底部的折叠区，不删除、不移出，随时能唤醒。
        只存这台设备，不会上传到云端；改阈值后，已有收藏的冬眠状态跟着变。
        上面的「恢复默认偏好」只恢复云端偏好，不重置这里的冬眠设置。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ToggleRow
          title="冬眠收藏"
          hint={
            hibernation.enabled
              ? '超过阈值没打开的收藏沉到底部折叠区'
              : '已关闭：全部收藏按原来顺序显示，冬眠区不出现'
          }
          enabled={hibernation.enabled}
          busy={busy}
          onToggle={() => writeHibernationSettings({ enabled: !hibernation.enabled })}
        />
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-hibernation-threshold-days`} className="block text-xs font-medium text-foreground">
            冬眠阈值
          </label>
          <SettingsSelect
            id={`${idPrefix}-hibernation-threshold-days`}
            label="冬眠阈值"
            value={hibernation.thresholdDays}
            disabled={busy || !hibernation.enabled}
            onChange={(e) =>
              writeHibernationSettings({ thresholdDays: Number(e.target.value) as HibernationThresholdDays })
            }
          >
            {HIBERNATION_THRESHOLD_DAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            超过这个天数本机没记录到打开，就沉到冬眠区（待读箱 / 已读不参与）。
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * 数字快拨（本机 DIY 配置 + 云端总开关并存，见 TriageSettingsSection 的同款纪律）：
 *
 *   - 总开关 numberDialEnabled 走面板的 value/onChange 云端设置流（默认开）；
 *   - 十个快拨位（Ctrl+Shift+1~0 → 站点 id）存在 DIY 配置 quickDialSlots，
 *     直接调 useHomeDIY() 的 setQuickDialSlot，不走 onChange。
 *   - 绑定入口在首页卡片 ⋯ 菜单（编辑态），这里是总览：每行显示已绑站点标题，
 *     附「清除」；标题查不到时分三种情况说清楚，不编造：
 *       · 自建分类里的站点：DIY 配置自带标题，本机直接认；
 *       · 中枢确认无此站点（404）：「站点已失效」，供用户改绑或清除；
 *       · 中枢不可用（5xx/断网）：显示 id +「标题未知」，不谎称已失效。
 *   - 失效绑定保留原值不静默删除（用户数据不丢），由这里改绑或清除。
 *   - 自建分类里的站点若所在分类已折叠：行内提示「所在分类已折叠，展开后恢复」
 *     （折叠分类不在数字直达映射里，Ctrl+Shift+数字暂时打不开；中枢分类
 *     的站点归属现有数据判断不了，不提示）。
 */
function QuickDialSettingsSection({
  value,
  busy,
  onChange,
}: {
  value: UserSettingsModel
  busy: boolean
  onChange: (patch: UserSettingsPatch, successTitle?: string) => void
}) {
  const { config, quickDialSlots, setQuickDialSlot, collapsedCategoryIds } = useHomeDIY()

  // 本机标题源：自建分类里的站点（DIY 配置自带标题，不用发请求）
  const localTitles = useMemo(() => {
    const map = new Map<string, string>()
    for (const cat of config.customCategories || []) {
      for (const item of cat.items || []) {
        if (item?.id && item.title) map.set(item.id, item.title)
      }
    }
    return map
  }, [config.customCategories])

  // 折叠分类里的绑定（只对自建分类可判断）：该站不在数字直达映射里，
  // Ctrl+Shift+数字暂时打不开，行内提示；中枢分类的站点归属现有数据
  // 判断不了，不提示。
  const foldedCustomSiteIds = useMemo(() => {
    const collapsed = new Set(collapsedCategoryIds || [])
    const out = new Set<string>()
    for (const cat of config.customCategories || []) {
      if (!cat?.id || !collapsed.has(cat.id)) continue
      for (const item of cat.items || []) {
        if (item?.id) out.add(item.id)
      }
    }
    return out
  }, [config.customCategories, collapsedCategoryIds])

  // 中枢标题：null = 中枢确认无此站点（已失效）；缺席 + 在 unreachable 里 = 中枢不可用
  const [remoteTitles, setRemoteTitles] = useState<Record<string, string | null>>({})
  const [unreachable, setUnreachable] = useState<ReadonlySet<string>>(new Set())
  const fetchedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const ids = QUICK_DIAL_DIGITS.map((d) => quickDialSlots?.[d]).filter(
      (id): id is string => typeof id === 'string' && !!id && !localTitles.has(id) && !fetchedRef.current.has(id),
    )
    if (ids.length === 0) return
    for (const id of ids) fetchedRef.current.add(id)
    let cancelled = false
    void (async () => {
      // 10 个快拨位互不依赖，并发取详情（与 /pack 页同口径），省去 10×RTT。
      const results = await Promise.all(
        ids.map(async (id) => {
          let degraded = false
          const site = await fetchSite(id, () => { degraded = true })
          return { id, site, degraded }
        }),
      )
      if (cancelled) return
      const titles: Record<string, string | null> = {}
      const down = new Set<string>()
      for (const { id, site, degraded } of results) {
        if (site?.title) titles[id] = site.title
        else if (degraded) down.add(id)
        else titles[id] = null
      }
      setRemoteTitles((prev) => ({ ...prev, ...titles }))
      if (down.size) setUnreachable((prev) => new Set([...prev, ...down]))
    })()
    return () => {
      cancelled = true
    }
  }, [quickDialSlots, localTitles])

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background/50 p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        <Command className="h-4 w-4 text-primary" aria-hidden />
        数字快拨
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        按 1–9 直接打开速览坞对应站点，Shift+数字在新标签页打开；Ctrl+Shift+1–0 打开下面绑定的站点。
        绑定在首页卡片 ⋯ 菜单（编辑态）里设置，这里只做总览与清除；快拨位只存这台设备，不会上传到云端。
      </p>
      <div className="mt-3">
        <ToggleRow
          title="数字直达"
          hint="关闭后数字键不再打开站点（视图切换 Alt+1–3 不受影响）"
          enabled={value.numberDialEnabled}
          busy={busy}
          onToggle={() =>
            onChange(
              { numberDialEnabled: !value.numberDialEnabled },
              value.numberDialEnabled ? '数字直达已关闭' : '数字直达已开启',
            )
          }
        />
      </div>
      <ul className="mt-3 space-y-1.5 text-xs">
        {QUICK_DIAL_DIGITS.map((digit: QuickDialDigit) => {
          const boundId = quickDialSlots?.[digit]
          const title = boundId
            ? (localTitles.get(boundId) ??
              (boundId in remoteTitles ? remoteTitles[boundId] : undefined))
            : undefined
          return (
            <li
              key={digit}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"
            >
              <span className="flex items-center gap-2 min-w-0">
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px] shrink-0">
                  Ctrl+Shift+{digit}
                </kbd>
                {!boundId ? (
                  <span className="text-muted-foreground">未绑定</span>
                ) : title ? (
                  <span className="truncate text-foreground">{title}</span>
                ) : boundId in remoteTitles ? (
                  <span className="truncate text-destructive-text">站点已失效</span>
                ) : unreachable.has(boundId) ? (
                  <span className="truncate text-muted-foreground" title={boundId}>
                    {boundId}（标题未知，中枢暂不可用）
                  </span>
                ) : (
                  <span className="text-muted-foreground">加载中…</span>
                )}
                {boundId && foldedCustomSiteIds.has(boundId) && (
                  <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-400">
                    所在分类已折叠，展开后恢复
                  </span>
                )}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-destructive-text"
                disabled={busy || !boundId}
                onClick={() => setQuickDialSlot(digit, null)}
              >
                清除
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function SettingsPanel({ value, busy, idPrefix, onChange, onRestoreDefaults }: SettingsPanelProps) {
  return (
    <section
      aria-label="全局导航与工作台偏好设置"
      className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            全局导航、0-RTT 引擎与隐私偏好
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            修改后立即保存并回读校验；登录状态下跨设备生效
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 text-xs" disabled={busy} onClick={onRestoreDefaults}>
          恢复默认偏好
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-default-search-engine`} className="block text-xs font-medium text-foreground">
            默认搜索引擎
          </label>
          <SettingsSelect
            id={`${idPrefix}-default-search-engine`}
            label="默认搜索引擎"
            value={value.defaultSearchEngine}
            disabled={busy}
            onChange={(e) =>
              onChange({ defaultSearchEngine: e.target.value as SearchEngineId }, '默认搜索引擎已更新')
            }
          >
            {SEARCH_ENGINE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {value.defaultSearchEngine === 'internal'
              ? '站内检索没命中时不再自动跳转站外，只给重试与分类入口。'
              : '站内搜索没命中时，结果面板会给出用该引擎搜索这句话的直达入口。'}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-card-density`} className="block text-xs font-medium text-foreground">
            导航卡片展示密度
          </label>
          <SettingsSelect
            id={`${idPrefix}-card-density`}
            label="导航卡片展示密度"
            value={value.cardDensity}
            disabled={busy}
            onChange={(e) => onChange({ cardDensity: e.target.value as CardDensityMode }, '卡片展示密度已更新')}
          >
            {CARD_DENSITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            与首页右上角的密度切换按钮是同一份设置，改一处两处同步。
          </p>
        </div>

        <HalfScreenDockField idPrefix={idPrefix} />

        <FontSizeField idPrefix={idPrefix} />

        <ThemeField idPrefix={idPrefix} />

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-spotlight-shortcut`} className="block text-xs font-medium text-foreground">
            全局搜索唤醒快捷键
          </label>
          <SettingsSelect
            id={`${idPrefix}-spotlight-shortcut`}
            label="全局搜索唤醒快捷键"
            value={value.spotlightShortcut}
            disabled={busy}
            onChange={(e) =>
              onChange({ spotlightShortcut: e.target.value as SpotlightShortcutMode }, '搜索快捷键偏好已更新')
            }
          >
            {SPOTLIGHT_SHORTCUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            输入框里打「/」永远是正文，只有从非输入态按下才算呼出。
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-history-retention`} className="block text-xs font-medium text-foreground">
            搜索历史保留周期
          </label>
          <SettingsSelect
            id={`${idPrefix}-history-retention`}
            label="搜索历史保留周期"
            value={value.historyRetentionDays}
            disabled={busy}
            onChange={(e) =>
              onChange({ historyRetentionDays: Number(e.target.value) as HistoryRetentionDays }, '历史保留周期已更新')
            }
          >
            {RETENTION_DAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SettingsSelect>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-theme-preference`} className="block text-xs font-medium text-foreground">
            主题（账号级，跨设备）
          </label>
          <SettingsSelect
            id={`${idPrefix}-theme-preference`}
            label="主题偏好"
            value={value.themePreference ?? ''}
            disabled={busy}
            onChange={(e) =>
              onChange(
                { themePreference: (e.target.value || null) as ThemePreference },
                '主题偏好已更新',
              )
            }
          >
            <option value="">未设置（跟随全站默认）</option>
            <option value="system">跟随系统</option>
            <option value="light">始终浅色</option>
            <option value="dark">始终深色</option>
          </SettingsSelect>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            登录后在任何设备打开都会按这个偏好显示；本机工具栏的手动切换只影响当前设备。
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="block text-xs font-medium text-foreground">首页模块显示（个人）</p>
          <div className="grid gap-2">
            {(
              [
                ['aiFinder', 'AI 智能找站'],
                ['dramaCinema', '短剧沉浸影院'],
                ['onboarding', '首访引导卡'],
                ['heroDeck', '极速启动展板'],
              ] as Array<[FeatureKey, string]>
            ).map(([key, label]) => {
              const visible = !value.hiddenHomeModules.includes(key)
              return (
                <ToggleRow
                  key={key}
                  title={label}
                  hint={visible ? '首页显示这个模块' : '已对你隐藏（全站设置不受影响）'}
                  enabled={visible}
                  busy={busy}
                  onToggle={() =>
                    onChange(
                      {
                        hiddenHomeModules: visible
                          ? [...value.hiddenHomeModules, key]
                          : value.hiddenHomeModules.filter((k) => k !== key),
                      },
                      visible ? `已隐藏「${label}」` : `已恢复显示「${label}」`,
                    )
                  }
                />
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ToggleRow
          title="新标签页打开站点"
          hint="打开导航卡片、搜索结果与零结果站外直达时的目标窗口；关闭后在原标签页跳转"
          enabled={value.openLinksInNewTab}
          busy={busy}
          onToggle={() => onChange({ openLinksInNewTab: !value.openLinksInNewTab })}
        />
        <ToggleRow
          title="0-RTT 推测意图即时计算"
          hint="输入算式、CIDR、UUIDv7、时间戳或色值 0ms 原地计算；关闭后搜索面板与工作台终端只做纯算术"
          enabled={value.speculativeZeroRttEnabled}
          busy={busy}
          onToggle={() => onChange({ speculativeZeroRttEnabled: !value.speculativeZeroRttEnabled })}
          icon={<Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden />}
        />
        <ToggleRow
          title="全天候时段场景流推荐"
          hint="按当前时段在筛选行给出一枚场景建议；只建议，不会自己换掉整屏工作台"
          enabled={value.daypartSceneEnabled}
          busy={busy}
          onToggle={() => onChange({ daypartSceneEnabled: !value.daypartSceneEnabled })}
        />
        <ToggleRow
          title="自动记录搜索历史"
          hint="关闭后搜索请求不再写入云端搜索历史表"
          enabled={value.searchHistoryEnabled}
          busy={busy}
          onToggle={() => onChange({ searchHistoryEnabled: !value.searchHistoryEnabled })}
        />
        <ToggleRow
          title="匿名行为遥测上报"
          hint="关闭后点击与浏览事件不再关联个人身份标识"
          enabled={value.telemetryEnabled}
          busy={busy}
          onToggle={() => onChange({ telemetryEnabled: !value.telemetryEnabled })}
        />
      </div>

      {/* 待读分流：本机设置（见 TriageSettingsSection 注释），不走 onChange 的云端路径 */}
      <TriageSettingsSection busy={busy} idPrefix={idPrefix} />

      {/* 冬眠收藏：本机设置（与 TriageSettingsSection 同款纪律），不走 onChange 的云端路径 */}
      <HibernationSettingsSection busy={busy} idPrefix={idPrefix} />

      {/* 本机显示类入口：只存这台设备，与服务端偏好分开 */}
      <div className="mt-4">
        <OnboardingReplayField />
      </div>
      {/* 快捷键与键盘微动作速查矩阵 (P1-2 #shortcuts 锚点) */}
      <div
        id="shortcuts"
        tabIndex={-1}
        className="mt-6 rounded-xl border border-border/70 bg-background/50 p-4 transition-all duration-300 target:border-primary target:bg-primary/5 target:ring-2 target:ring-primary/30"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-primary" aria-hidden />
            <h3 className="text-xs font-semibold tracking-tight text-foreground">
              快捷键与键盘微动作速查矩阵
            </h3>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            Focus Model &amp; Shortcuts
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">全局直达与唤醒</span>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              <li className="flex items-center justify-between">
                <span>唤醒全局搜索与命令</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K 或 /</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>进入工作台 DIY 排版</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Ctrl/Cmd+E</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>回到页面顶部</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Home / ↑</kbd>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">卡片单焦点键盘动作 (A11y)</span>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              <li className="flex items-center justify-between">
                <span>Tab 遍历卡片（单焦点模型）</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Tab / ⇧Tab</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>卡片原地展开速览</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Space 空格</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>进入卡片内操作区</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">→</kbd>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 space-y-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-[11px] font-medium text-foreground">弹窗与速览层控制</span>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              <li className="flex items-center justify-between">
                <span>关闭当前弹窗 / 速览层</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>搜索结果首项回车直达</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter ↵</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>快速清理当前输入</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Ctrl+U</kbd>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 space-y-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-[11px] font-medium text-foreground">数字快拨</span>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              <li className="flex items-center justify-between">
                <span>直接打开速览坞对应站点</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">1–9</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>在新标签页打开速览坞站点</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Shift+1–9</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>打开自定义快拨位站点</span>
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">Ctrl+Shift+1–0</kbd>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* 数字快拨总览：总开关走云端设置流，十个绑定走本机 DIY 配置（见组件头注释） */}
      <QuickDialSettingsSection value={value} busy={busy} onChange={onChange} />
    </section>
  )
}
