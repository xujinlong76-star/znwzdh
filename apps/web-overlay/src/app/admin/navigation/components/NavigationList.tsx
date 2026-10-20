'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/registry/new-york/ui/skeleton'
import type { NavigationListProps } from './NavigationList.impl'

const NavigationListImpl = dynamic(
  () => import('./NavigationList.impl').then((mod) => mod.NavigationList),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4" aria-busy="true" aria-label="正在加载导航列表">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-lg border p-4">
            <div className="flex items-center space-x-4">
              <Skeleton className="h-6 w-6 rounded" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-[200px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
)

/**
 * 同路径懒加载包装器：页面只依赖这里，避免把拖拽库和卡片对话框静态拉入首屏。
 * 实现放在 `.impl`，静态守卫测试会防止包装器回退成静态 import。
 */
export function NavigationList(props: NavigationListProps) {
  return <NavigationListImpl {...props} />
}
