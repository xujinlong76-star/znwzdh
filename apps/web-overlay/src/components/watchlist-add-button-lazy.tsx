'use client'

import dynamic from 'next/dynamic'
import type { WatchPlatformRef } from '@/lib/watchlist'

const WatchlistAddButton = dynamic(
  () => import('./watchlist-add-button').then((m) => m.WatchlistAddButton),
  { ssr: false },
)

export interface WatchlistAddButtonLazyProps {
  platform: WatchPlatformRef
  variant?: 'dark' | 'light'
}

/**
 * 追剧按钮按需客户端加载包装：避免把追剧表单与存储 hook 打进通用 /category/[slug] 首包 JS。
 */
export function WatchlistAddButtonLazy(props: WatchlistAddButtonLazyProps) {
  return <WatchlistAddButton {...props} />
}
