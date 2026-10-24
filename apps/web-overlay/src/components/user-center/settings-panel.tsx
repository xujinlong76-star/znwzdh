'use client'

/**
 * 用户中心「全局设置」表单（纯展示）。
 *
 * 与 `/me` 概览分离：设置页负责编辑，概览只保留摘要。控件沿用仓库现有风格
 * （select + 双态按钮），避免为一个表单引入新的 UI 依赖。
 */
import { Button } from '@/components/ui/button'
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
import { Settings2, Zap, ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'

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
    </section>
  )
}
