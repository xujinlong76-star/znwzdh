'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/registry/new-york/ui/skeleton'

export const runtime = 'edge'

/**
 * 站点设置页：把整页表单（react-hook-form + zod + @hookform/resolvers，约 145 KB）
 * 挪进异步 chunk，页面骨架先渲染，表单 chunk 随后到达。
 *
 * 为什么整页都推迟：这个页面的内容就是表单本身，没有「先出壳再开弹窗」的分界；
 * 但首屏真正需要的是页面骨架与标题，表单 JS 可以后到。
 */
const SiteSettingsImpl = dynamic(() => import('./page.impl').then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="space-y-6" aria-busy="true" aria-label="正在加载站点设置">
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 space-y-4">
        <Skeleton className="h-6 w-32 rounded" />
        <Skeleton className="h-10 w-full rounded" />
        <Skeleton className="h-10 w-full rounded" />
        <Skeleton className="h-10 w-40 rounded" />
      </div>
    </div>
  ),
})

export default function SiteSettings() {
  return <SiteSettingsImpl />
}
