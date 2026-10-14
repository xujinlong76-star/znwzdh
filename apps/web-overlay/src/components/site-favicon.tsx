'use client'

import React, { useState } from 'react'
import { Globe } from 'lucide-react'

export interface SiteFaviconProps {
  title?: string
  icon?: string
  useDefaultIcon?: boolean
  className?: string
}

export function SiteFavicon({
  title = '',
  icon,
  useDefaultIcon = false,
  className = 'w-full h-full object-contain',
}: SiteFaviconProps) {
  const [loadFailed, setLoadFailed] = useState(false)

  // 若明确指定使用默认图标，或缺少图标地址，或图片加载失败，展示首字头像/缺省图标
  if (useDefaultIcon || !icon || loadFailed) {
    const firstChar = title ? title.trim().charAt(0).toUpperCase() : ''
    if (firstChar) {
      return (
        <div
          className={`flex items-center justify-center font-bold text-xs select-none rounded-sm bg-primary/10 text-primary ${className}`}
          title={title}
        >
          {firstChar}
        </div>
      )
    }
    return <Globe className={`text-muted-foreground ${className}`} />
  }

  return (
    <img
      src={icon}
      alt={title ? `${title} 图标` : '站点图标'}
      className={className}
      loading="lazy"
      onError={() => setLoadFailed(true)}
    />
  )
}
