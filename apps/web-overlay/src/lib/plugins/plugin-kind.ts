import type { HubPluginItem } from '@/lib/navhub-api'

/**
 * 插件类型微标签与价值说明（2026-11-21）。
 *
 * ## 为什么需要
 *
 * 插件榜每行原本只有「名称 + 安装数/日期」，用户看不出这是个什么东西——
 * 主题皮肤和 AI 工作台的点击预期完全不同，缺少类型提示就只能靠猜，
 * 直接压低进插件市场的转化率。
 *
 * ## 推断依据
 *
 * 只用插件自身已有字段（tags / name / kind），不新增数据依赖：
 * 先看显式 kind，再看 tags 关键词，最后按名称特征兜底。
 * 推断不确定时返回 null，Card 侧不显示标签——**不猜**。
 */

export type PluginKind = 'theme' | 'ai-pack' | 'workspace' | 'tool' | 'extension'

/** 类型短标签（≤4 字，适合放在名称旁） */
export const PLUGIN_KIND_LABEL: Record<PluginKind, string> = {
  theme: '主题皮肤',
  'ai-pack': 'AI 组合包',
  workspace: '工作台',
  tool: '工具',
  extension: '扩展',
}

/** 类型徽章的色调类（亮/暗双主题） */
export const PLUGIN_KIND_CLASS: Record<PluginKind, string> = {
  theme: 'border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400',
  'ai-pack': 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  workspace: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  tool: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  extension: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

/**
 * 推断插件类型。推断不出来返回 null（宁可不显示，也不给错标签）。
 */
export function inferPluginKind(p: Pick<HubPluginItem, 'name' | 'tags'> & { kind?: string | null }): PluginKind | null {
  const kind = String((p as { kind?: string }).kind ?? '').toLowerCase()
  if (kind === 'theme' || kind === 'skin') return 'theme'
  if (kind === 'workspace') return 'workspace'
  if (kind === 'combo' || kind === 'bundle') return 'ai-pack'

  const tags = (p.tags ?? []).map((t) => String(t).toLowerCase())
  const name = String(p.name ?? '').toLowerCase()
  const has = (kw: string) => tags.some((t) => t.includes(kw)) || name.includes(kw)

  // 主题皮肤：最常见且最容易误判，放最前。
  // 词库来自站内实际在售的主题命名（北欧/赛博/暮色/复古/纸感 等意象词）——
  // 它们不写"主题"两个字，但显然都是配色皮肤。
  const THEME_WORDS = [
    '主题', '皮肤', 'theme', 'skin', '配色', '深色', '浅色', '暗色',
    '北欧', '冰霜', '赛博', '暮色', '复古', '纸感', '暖棕', '深蓝', '深海',
    '樱花', '极简', '拿铁', '霜', 'dark', 'light',
  ]
  if (THEME_WORDS.some((w) => has(w))) return 'theme'
  // AI 组合包
  if (has('ai') || has('组合包') || has('工作台') || has('智能体')) {
    if (has('组合包') || has('bundle') || has('套装')) return 'ai-pack'
    if (has('工作台') || has('workspace')) return 'workspace'
    return 'ai-pack'
  }
  if (has('工作台') || has('workspace')) return 'workspace'
  if (has('扩展') || has('插件') || has('extension')) return 'extension'
  if (has('工具') || has('tool')) return 'tool'
  return null
}

/**
 * 一句核心卖点（最多 20 字）。
 *
 * 优先用插件自己的 description（截断到首句），没有就不返回——不编卖点。
 */
export function pluginHighlight(p: Pick<HubPluginItem, 'description'>, maxLen = 20): string | null {
  const desc = String(p.description ?? '').trim()
  if (!desc) return null
  // 取第一句（中英文句号/分号/换行分隔）
  const first = desc.split(/[。.;；\n]/)[0]?.trim() ?? ''
  const text = first || desc
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}
