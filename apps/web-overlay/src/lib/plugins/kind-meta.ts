/**
 * 插件类型的视觉元数据（市场列表 / 详情 / 后台共用同一套，避免三处漂移）。
 */

import { Globe, LayoutGrid, Palette, Store, type LucideIcon } from 'lucide-react'
import type { PluginKind } from './plugin-manifest'

/** 类型 → 图标（含未知类型的兜底） */
export const KIND_ICONS: Record<PluginKind, LucideIcon> = {
  'site-pack': Globe,
  'workspace-preset': LayoutGrid,
  theme: Palette,
}

/** 类型 → 徽章色调（Tailwind 语义类，深浅色模式各一档透明度） */
export const KIND_TONES: Record<PluginKind, string> = {
  'site-pack': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  'workspace-preset': 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
  theme: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
}

/** 主题强调色的可视化色版（与 globals.css 的 data-accent 块同源口径） */
export const ACCENT_SWATCH: Record<string, string> = {
  violet: 'hsl(262 83% 58%)',
  emerald: 'hsl(158 64% 45%)',
  amber: 'hsl(38 92% 50%)',
  rose: 'hsl(346 77% 55%)',
}

/** 未知类型的小图标兜底 */
export const FALLBACK_KIND_ICON = Store
