'use client'

import { useState, useEffect } from 'react'
import { LetterAvatar } from './letter-avatar'

interface SiteFaviconProps {
  title: string
  url?: string
  icon?: string
  useDefaultIcon?: boolean
  className?: string
}

/**
 * 自适应网站 Favicon 徽标管线
 * - 若 useDefaultIcon === true、无 icon、或图片远程加载失败 (onError)
 *   自动退避至「确定性自适应渐变徽标」(Deterministic Gradient Monogram Avatar)，
 *   彻底终结死链图裂与千篇一律的灰色占位符。
 */
export function SiteFavicon({
  title,
  url,
  icon,
  useDefaultIcon,
  className,
}: SiteFaviconProps) {
  const [errored, setErrored] = useState(false)

  // icon 变化时重置错误态(同一组件实例复用于不同 item 时)
  useEffect(() => {
    setErrored(false)
  }, [icon])

  if (useDefaultIcon || !icon || errored) {
    return <LetterAvatar title={title} url={url} className={className} />
  }

  return (
    <img
      src={icon}
      alt={`${title} icon`}
      className={className}
      loading="lazy"
      onError={() => setErrored(true)}
    />
  )
}
