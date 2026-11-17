'use client'

/**
 * 首页顶部「设为首页」引导条：只在首页出现，可关闭，关掉后记进
 * localStorage 不再打扰（HOMEPAGE_BANNER_DISMISSED_KEY）。已领取过
 * 首页奖励的用户也不再显示——目的达到就不烦人。点「怎么设置」原地
 * 展开完整引导卡（HomepageGuideCard）。
 *
 * CLS（2026-11-18 04:22 轮方案 A：fixed 悬浮条）：横幅首帧 SSR 为
 * null，水合后才出现；流式 div 会把工具栏与首页内容下推整条横幅高度
 * （静态验算 53px 桌面 / 61–81px 移动 / 最窄屏约 101px，CLS 估算
 * 0.06–0.15，非实测）。根节点改为 fixed 脱离文档流后，水合插入与
 * 关闭全程不推动任何已渲染内容，位移构造上归零。
 * 接受的两处有条件债务：
 *  - 公告栏：当前 site.json 无 announcement 键、公告关闭，fixed top-0
 *    不会盖住公告；公告重开之日须同步复核重叠。
 *  - sticky 工具栏（z-30）：z-50 横幅下滚时盖住工具栏直至关闭，接受
 *    一次出现；下滚收起另立项，不在本轮改 navigation-toolbar.tsx。
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Home, X } from 'lucide-react'
import { HOMEPAGE_BANNER_DISMISSED_KEY, HOMEPAGE_CLAIM_XP, loadGrowthProfile } from '@/lib/growth-lazy'

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

  // fixed 悬浮条（方案 A）：脱离文档流，水合插入不下推任何内容。
  // 展开态封顶见下方 expanded 容器。
  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-primary/20 bg-primary/5">
      <div className="mx-auto w-full max-w-6xl px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Home className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            常来的话，把本站设为浏览器首页吧——下次打开浏览器就能直接回来，还能领 {HOMEPAGE_CLAIM_XP} 经验。
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
          // 展开态封顶：引导卡内容约 350–450px 高，不封顶会盖住大半视口；
          // 70vh 封顶 + 内部滚动，至少留 30vh 页面可见、可点关闭；
          // overscroll-contain 防滚动链带走背后页面。
          <div className="mt-3 max-h-[70vh] overflow-y-auto overscroll-contain">
            <HomepageGuideCard compact />
          </div>
        )}
      </div>
    </div>
  )
}
