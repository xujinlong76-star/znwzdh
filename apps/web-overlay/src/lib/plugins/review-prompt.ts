import { safeHref } from '@/lib/safe-url'
import { toast } from 'sonner'

/**
 * P1-5 邀评提示：安装成功后请用户「用过请评价」。
 *
 * 只做邀评破局，不做假数据：不编造评分、安装量、评论；榜单退化提示保留
 * 在别处（本文件不碰）。「去评价」入口指向该插件详情页的评价区
 *（`?tab=reviews` 深链，详情页挂载时按该参数打开评价选项卡）。
 *
 * 不骚扰：同一插件只提示一次（localStorage 按 slug 记），提示本身带
 * 关闭按钮、10 秒后自动消失；错过提示的用户仍可在「已安装」页每行
 * 的「去评价」链接进评价区。
 */

export const REVIEW_PROMPT_DURATION_MS = 10_000
export const REVIEW_PROMPT_ACTION_LABEL = '去评价'

/** 同一插件只提示一次：按 slug 记 localStorage（值固定为 '1'）。 */
export function reviewPromptStorageKey(slug: string): string {
  return `navhub:review-prompted:v1:${slug}`
}

/** 插件详情页评价区深链：详情页挂载时按 ?tab=reviews 打开评价选项卡。 */
export function pluginReviewUrl(slug: string): string {
  return `/marketplace/${encodeURIComponent(slug)}?tab=reviews`
}

export function hasReviewPromptBeenShown(slug: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    return window.localStorage.getItem(reviewPromptStorageKey(slug)) === '1'
  } catch {
    // localStorage 受限时不阻断安装流程，按「未提示过」处理
    return false
  }
}

export function markReviewPromptShown(slug: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(reviewPromptStorageKey(slug), '1')
  } catch {
    // localStorage 受限时不阻断安装流程
  }
}

/**
 * 取一次邀评 action：未提示过返回可挂到安装成功 toast 上的 action（并记为
 * 已提示），提示过返回 null。调用方只在「新装 / 升级成功」时调用，
 * alreadyInstalled（什么都没新装）不调用。
 */
export function takeReviewPromptAction(slug: string): {
  label: string
  onClick: () => void
} | null {
  if (!slug || hasReviewPromptBeenShown(slug)) return null
  markReviewPromptShown(slug)
  return {
    label: REVIEW_PROMPT_ACTION_LABEL,
    onClick: () => {
      // 站内相对路径也要过闸：pluginReviewUrl 只在 `/marketplace/${encodeURIComponent(slug)}?tab=reviews`
      // 一个构造点生成（slug 已编码），再经 safeHref 校验一次，不安全值落到 '' 直接不导航。
      const url = safeHref(pluginReviewUrl(slug), '')
      if (!url) return
      window.location.assign(url)
    },
  }
}

/**
 * 已安装页升级成功时调用：未提示过则单独弹一条邀评 toast（带「去评价」
 * 入口与关闭按钮，10 秒后自动消失），并记为已提示；返回是否弹出。
 * 安装弹窗不走这里——弹窗已有成功 toast，action 直接挂在那条 toast 上，
 * 不再另弹一条。
 */
export function showInstallReviewPrompt(slug: string, pluginName: string): boolean {
  const action = takeReviewPromptAction(slug)
  if (!action) return false
  toast.success(`「${pluginName}」已就绪，用过欢迎回来评价`, {
    description: '你的真实评价会帮其他用户判断这个插件值不值得装。',
    duration: REVIEW_PROMPT_DURATION_MS,
    closeButton: true,
    action,
  })
  return true
}
