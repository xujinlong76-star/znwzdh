'use client'

import { useEffect } from 'react'
import { Toaster as SonnerToaster } from 'sonner'
import { initThemeRuntime } from '@/lib/plugins/theme-runtime'
import { SessionProvider } from 'next-auth/react'
import { Toaster } from '@/components/ui/toaster'
import { PredictivePrefetchProvider } from '@/components/predictive-prefetch-provider'
import { OfflineBanner } from '@/components/offline-banner'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // 拦截并过滤浏览器插件 (如 Chrome 扩展、QoderWork) 注入脚本产生的未捕获 Promise 报错
    // 典型报错: "Error: Could not establish connection. Receiving end does not exist."
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason
      const msg = typeof reason === 'string' ? reason : (reason?.message || '')
      if (
        msg.includes('Could not establish connection. Receiving end does not exist') ||
        msg.includes('The message port closed before a response was received') ||
        msg.includes('Extension context invalidated')
      ) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }, [])

  useEffect(() => {
    // 插件市场主题：客户端首屏恢复上次安装的 theme 插件（无活跃主题时为空操作）。
    // Providers 已是 'use client'，SSR 阶段 applyThemeTokens 自带 typeof document 守卫。
    initThemeRuntime()
  }, [])

  return (
    <SessionProvider>
      <PredictivePrefetchProvider>
        {children}
        <OfflineBanner />
        <Toaster />
        {/* 插件市场（components/plugins/** 与市场/后台页）使用 sonner 通知通道；
            没有这个挂载点，toast 调用会被静默丢弃 */}
        <SonnerToaster richColors position="top-center" />
      </PredictivePrefetchProvider>
    </SessionProvider>
  )
}