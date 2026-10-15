'use client'

import { SWRConfig } from 'swr'
import { DensityProvider } from '@/components/density-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

export function Providers({ children }: { children: React.ReactNode }) {
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
          {children}
        </DensityProvider>
      </TooltipProvider>
    </SWRConfig>
  )
}

