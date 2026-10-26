'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { SWRConfig } from 'swr'
import { DensityProvider } from '@/components/density-provider'
import { SiteContext, type SiteViewModel } from '@/components/site-view-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { initThemeRuntime } from '@/lib/plugins/theme-runtime'
import { GlobalAiGateway } from '@/components/ai/global-ai-gateway'
import { GlobalSpotlightGateway } from '@/components/search/global-spotlight-gateway'
import { FluidGlassCanvas } from '@/components/theme/fluid-glass-canvas'

// sonner 与主题试用条都不是首屏必需：把它们的 JS 从根布局公共 chunk 移到
// 水合后的独立 chunk。主题试用本身只在用户主动试用时才有内容。
const SonnerToaster = dynamic(
  () => import('sonner').then((mod) => mod.Toaster),
  { ssr: false },
)
const ThemeTryoutRibbon = dynamic(
  () => import('@/components/plugins/theme-tryout-ribbon').then((mod) => mod.ThemeTryoutRibbon),
  { ssr: false },
)

export function Providers({
  children,
  site,
}: {
  children: React.ReactNode
  site: SiteViewModel
}) {
  useEffect(() => {
    // 插件市场主题：客户端首屏恢复上次安装的 theme 插件（无活跃主题时为空操作）
    initThemeRuntime()
  }, [])

  return (
    <SiteContext.Provider value={site}>
      <SWRConfig
        value={{
          provider: () => new Map(),
          revalidateOnFocus: false,
          revalidateOnReconnect: false
        }}
      >
        <TooltipProvider delayDuration={200} skipDelayDuration={100}>
          <DensityProvider>
            {/* 动态流光毛玻璃画布背景 */}
            <FluidGlassCanvas />
            {children}
            {/* 主题免安装即时沙箱试用悬浮横条 */}
            <ThemeTryoutRibbon />
            {/* AI Web Copilot 浮窗助手（全局 Cmd+J / 悬浮呼出；首次呼出才加载实现） */}
            <GlobalAiGateway />
            {/* Spotlight 超级搜索与控制台（全局 Cmd+K 呼出；首次呼出才加载实现） */}
            <GlobalSpotlightGateway siteLinkTarget={site.linkTarget} />
            {/* 插件市场（components/plugins/** 与市场/后台页）使用 sonner 通知通道 */}
            <SonnerToaster richColors position="top-center" />
          </DensityProvider>
        </TooltipProvider>
      </SWRConfig>
    </SiteContext.Provider>
  )
}

