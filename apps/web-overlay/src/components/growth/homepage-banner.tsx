'use client'

/**
 * 首页顶部「设为首页」引导条：只在首页出现，可关闭，关掉后记进
 * localStorage 不再打扰（HOMEPAGE_BANNER_DISMISSED_KEY）。已领取过
 * 加速的用户也不再显示——目的达到就不烦人。点「怎么设置」原地
 * 展开完整引导卡（HomepageGuideCard）。
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Home, X } from 'lucide-react'
import { HOMEPAGE_BANNER_DISMISSED_KEY, loadGrowthProfile } from '@/lib/growth'

// 引导卡只在用户点「怎么设置」展开时才需要：动态导入，不占各页面首屏包体积
// （本横幅挂在根 layout，未拆分前每个路由都要背 6 套浏览器步骤文案与图标）。
const HomepageGuideCard = dynamic(
  () => import('./homepage-guide').then((m) => m.HomepageGuideCard),
  { ssr: false },
)

export function HomepageBanner() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (pathname !== '/') {
      setVisible(false)
      return
    }
    try {
      if (window.localStorage.getItem(HOMEPAGE_BANNER_DISMISSED_KEY)) return
    } catch {
      /* 读不到偏好就按未关闭处理 */
    }
    if (loadGrowthProfile().homepageClaimedAt) return
    setVisible(true)
  }, [pathname])

  if (!visible) return null

  const dismiss = () => {
    setVisible(false)
    try {
      window.localStorage.setItem(HOMEPAGE_BANNER_DISMISSED_KEY, '1')
    } catch {
      /* 写不进去下次还会出现，可接受 */
    }
  }

  return (
    <div className="border-b border-primary/20 bg-primary/5">
      <div className="mx-auto w-full max-w-6xl px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Home className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            常来的话，把本站设为浏览器首页吧——下次打开浏览器就能直接回来，还能领 100 经验、开启经验加速。
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            {expanded ? '收起' : '怎么设置'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭设为首页引导"
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {expanded && (
          <div className="mt-3">
            <HomepageGuideCard compact />
          </div>
        )}
      </div>
    </div>
  )
}
