'use client'

import { SessionProvider } from 'next-auth/react'
import { Toaster } from '@/components/ui/toaster'
import { PredictivePrefetchProvider } from '@/components/predictive-prefetch-provider'
import { OfflineBanner } from '@/components/offline-banner'

export function Providers({ children }: { children: React.ReactNode }) {
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
 