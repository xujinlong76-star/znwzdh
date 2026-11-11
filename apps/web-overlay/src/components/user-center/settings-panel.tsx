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
  type UserSettingsModel,
  type UserSettingsPatch,
} from '@/lib/user-settings'
import { Settings2, Zap, ChevronDown, Command } from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import {
  fetchInstalledPlugins,
  fetchPluginDetail,
  type HubPluginInstalledItem,
} from '@/lib/navhub-api'
import {
  getActiveTheme,
  resetTheme,
  setActiveTheme,
  type ActiveThemeConfig,
} from '@/lib/plugins/theme-runtime'
import {
  FONT_SIZE_LABEL,
  FONT_SIZE_PX,
  FONT_SIZE_STORAGE_KEY,
  applyFontSizeLevel,
  loadFontSizeLevel,
  type FontSizeLevel,
} from '@/lib/font-size'

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
 * 主题外观（本机设置）：与字号同款纪律，只动本机 localStorage 与主题运行时，
 * 不走服务端用户设置（主题是这台设备的显示偏好）。
 * B12：种子主题早已能经「市场安装→本机激活」链用上，但普通用户日常入口
 * 只有 /marketplace/installed 管家页，设置页没有主题选择器——等于白做一半。
 * 本字段把已安装主题列进设置页：系统默认在首位，一点即换；没装主题时给去
 * 市场主题分类的直达链接，不谎称已装；拉取失败时明说取不到并给重试。
 * 切换与管家页共用 lib/plugins/theme-runtime 的同一套函数，不另立真相。
 */
function ThemeField({ idPrefix }: { idPrefix: string }) {
  const [themes, setThemes] = useState<HubPluginInstalledItem[]>([])
  const [activeTheme, setActiveThemeState] = useState<ActiveThemeConfig | null>(null)
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
    void loadThemes()
    const onThemeChange = () => setActiveThemeState(getActiveTheme())
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
            ? '首页的三步引导（导入书签 / 搜索 / 收藏），关掉后可从这里重新查看。'
            : dismissed
              ? '你之前关掉了首页的三步引导。点这里清除关闭记录，回到首页即可重新查看。'
              : '首页的三步引导还没关过，回到首页就能看到。'}
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-[11px]">
        <Link href="/" onClick={replay}>
          {dismissed ? '重新查看新手引导' : '去首页查看引导'}
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
                <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">E</kbd>
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
        </div>
      </div>
    </section>
  )
}
