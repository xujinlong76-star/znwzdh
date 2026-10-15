'use client'

import { useEffect } from 'react'
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

  return (
    <SessionProvider>
      <PredictivePrefetchProvider>
        {children}
        <OfflineBanner />
        <Toaster />
      </PredictivePrefetchProvider>
    </SessionProvider>
  )
}