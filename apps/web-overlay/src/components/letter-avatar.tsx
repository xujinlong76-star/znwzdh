'use client'

import { getDeterministicGradient, extractFaviconMonogram } from '@/lib/deterministic-favicon'
import { cn } from '@/lib/utils'

interface LetterAvatarProps {
  title: string
  url?: string
  className?: string
}

/**
 * 确定性渐变徽标 (Deterministic Gradient Monogram Avatar)
 * - 结合网站 URL 与标题进行 32-bit FNV-1a 哈希，同站同名永久生成一致的视觉表象。
 * - 16 组精心调配的极光/海流/赛博霓虹双色渐变色板，保障 WCAG AA 级高对比度。
 * - 纯矢样式 + 柔和边界高光，提供优雅的高清视觉质感。
 */
export function LetterAvatar({ title, url, className }: LetterAvatarProps) {
  const seed = (url || title || 'navhub').toLowerCase()
  const gradient = getDeterministicGradient(seed)
  const monogram = extractFaviconMonogram(title, url)

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-lg font-bold select-none text-xs sm:text-sm tracking-wide shadow-xs ring-1 ring-white/20 dark:ring-white/10 transition-transform duration-200",
        className
      )}
      style={{
        background: gradient.cssGradient,
        color: gradient.textColor,
      }}
    >
      <span className="drop-shadow-xs transform -translate-y-[0.5px]">{monogram}</span>
    </div>
  )
}
