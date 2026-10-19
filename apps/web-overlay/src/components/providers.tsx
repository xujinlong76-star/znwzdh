'use client'

import { useEffect } from 'react'
import { SWRConfig } from 'swr'
import { DensityProvider } from '@/components/density-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster as SonnerToaster } from 'sonner'
import { initThemeRuntime } from '@/lib/plugins/theme-runtime'
import { ThemeTryoutRibbon } from '@/components/plugins/theme-tryout-ribbon'
import { GlobalAiGateway } from '@/components/ai/global-ai-gateway'
import { GlobalSpotlightGateway } from '@/components/search/global-spotlight-gateway'
import { FluidGlassCanvas } from '@/components/theme/fluid-glass-canvas'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // 插件市场主题：客户端首屏恢复上次安装的 theme 插件（无活跃主题时为空操作）
    initThemeRuntime()
  }, [])

  return (
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
          <GlobalSpotlightGateway />
          {/* 插件市场（components/plugins/** 与市场/后台页）使用 sonner 通知通道 */}
          <SonnerToaster richColors position="top-center" />
        </DensityProvider>
      </TooltipProvider>
    </SWRConfig>
  )
}

