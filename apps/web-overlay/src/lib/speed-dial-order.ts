/**
 * 速览坞顺序（共享版）：从 speed-dial-dock.tsx 抽出的纯函数。
 *
 * 顺序与今日坞逐字一致，上限从 10 改为 9（SPEED_DIAL_LIMIT）——
 * 数字直达只取前 9 个，坞与映射必须读同一份顺序，禁止任何一方自己重算：
 * navigation-content 的数字映射、坞自己的芯片列表、useNumberDial 的
 * 打开目标，三方都调 computeSpeedDialSites。
 *
 * 顺序：
 *   ① speedDialPinnedIds（用户钉选，按钉选顺序，跳过已删站点）；
 *   ② 本机离线最近访问前 3（readOfflineVisits 读到的新→旧列表，按 id 或 href 匹配）；
 *   ③ 工作区关键词匹配（WORKSPACE_KEYWORDS，按关键词表顺序）；
 *   ④ allSites 顺序补足。
 */
import type { DialSite } from '@/lib/number-dial'

/** 速览坞与数字直达共用的上限：坞 Top 9 = 数字键 1~9 */
export const SPEED_DIAL_LIMIT = 9

/** 最近访问里最多优先插入的条数（坞原有口径，不动） */
const RECENT_VISIT_TOP_N = 3

export const WORKSPACE_KEYWORDS: Record<string, string[]> = {
  dev: ['next', 'vite', 'react', 'vue', 'github', 'docker', 'redis', 'npm', 'postgres', 'tailwind'],
  design: ['figma', 'dribbble', 'behance', 'iconfont', 'unsplash', 'canva', 'mobbin', 'mastergo', 'freepik', 'ui faces'],
  ai: ['gemini', 'chatgpt', 'claude', 'kimi', 'cursor', 'copilot', 'midjourney', '智谱', '豆包', '通义'],
  efficiency: ['notion', '飞书', '语雀', 'wps', 'google 文档', '小宇宙', 'obsidian', 'processon', 'snipaste', 'umi-ocr'],
  all: ['gemini', 'kimi', '豆包', 'cursor', 'next', 'vite', 'figma', 'github', 'notion', 'v0'],
}

export interface SpeedDialSite extends DialSite {
  /** 来自本机最近访问（坞芯片上打「足迹」标） */
  isRecent?: boolean
}

export interface ComputeSpeedDialSitesArgs {
  allSites: DialSite[]
  speedDialPinnedIds?: readonly string[]
  recentVisits?: ReadonlyArray<{ id: string; href: string }>
  activeWorkspace?: string
}

export function computeSpeedDialSites(args: ComputeSpeedDialSitesArgs): SpeedDialSite[] {
  const { allSites, speedDialPinnedIds, recentVisits, activeWorkspace = 'all' } = args
  if (!allSites || allSites.length === 0) return []
  const siteMap = new Map<string, DialSite>()
  for (const s of allSites) {
    if (s && s.id) siteMap.set(s.id, s)
  }

  const pinned: SpeedDialSite[] = []
  const seenIds = new Set<string>()

  // 1. 优先展示用户在 DIY 中明确锁定的站点
  if (speedDialPinnedIds && speedDialPinnedIds.length > 0) {
    for (const id of speedDialPinnedIds) {
      const found = siteMap.get(id)
      if (found && !seenIds.has(found.id)) {
        pinned.push(found)
        seenIds.add(found.id)
      }
    }
  }

  // 2. 融入本机高频离线访问历史权重点亮（最多优先插入前 3 个常用）
  if (recentVisits && recentVisits.length > 0) {
    let recentCount = 0
    for (const v of recentVisits) {
      if (recentCount >= RECENT_VISIT_TOP_N) break
      const match = allSites.find(
        (s) => (s?.id && s.id === v.id) || (s?.href && v.href && s.href === v.href),
      )
      if (match && !seenIds.has(match.id)) {
        pinned.push({ ...match, isRecent: true })
        seenIds.add(match.id)
        recentCount++
      }
    }
  }

  // 3. 与工作区联动匹配 Top 9 核心工具
  const keywords = WORKSPACE_KEYWORDS[activeWorkspace] || WORKSPACE_KEYWORDS.all
  for (const kw of keywords) {
    if (pinned.length >= SPEED_DIAL_LIMIT) break
    const match = allSites.find((s) => s?.title?.toLowerCase().includes(kw))
    if (match && !seenIds.has(match.id)) {
      pinned.push(match)
      seenIds.add(match.id)
    }
  }

  // 4. 若数量仍未凑齐 9 个，以高质量兜底站点补足
  for (const s of allSites) {
    if (pinned.length >= SPEED_DIAL_LIMIT) break
    if (!seenIds.has(s.id)) {
      pinned.push(s)
      seenIds.add(s.id)
    }
  }

  return pinned.slice(0, SPEED_DIAL_LIMIT)
}
