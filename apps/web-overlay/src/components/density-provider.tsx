'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type ContentDensity = 'dense' | 'comfortable' | 'spacious'

interface DensityContextValue {
  density: ContentDensity
  setDensity: (density: ContentDensity) => void
  cycleDensity: () => void
  densityLabel: string
}

const DENSITY_STORAGE_KEY = 'navhub_content_density'

const DENSITY_META: Record<ContentDensity, { label: string; description: string; next: ContentDensity }> = {
  dense: {
    label: '极客密排',
    description: '75% 间距压缩，高屏效比，适合极客多屏作业',
    next: 'comfortable',
  },
  comfortable: {
    label: '舒适平衡',
    description: '100% 黄金间隙，层次清晰，官方推荐默认',
    next: 'spacious',
  },
  spacious: {
    label: '画廊沉浸',
    description: '125% 宽幅留白，宽屏展陈，适合平板与大屏触控',
    next: 'dense',
  },
}

const DensityContext = createContext<DensityContextValue | null>(null)

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = useState<ContentDensity>('comfortable')
  const [mounted, setMounted] = useState(false)

  // 挂载时从 localStorage 读取用户偏好并应用到 documentElement
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DENSITY_STORAGE_KEY) as ContentDensity | null
      if (saved && (saved === 'dense' || saved === 'comfortable' || saved === 'spacious')) {
        setDensityState(saved)
        document.documentElement.setAttribute('data-density', saved)
      } else {
        document.documentElement.setAttribute('data-density', 'comfortable')
      }
    } catch {
      document.documentElement.setAttribute('data-density', 'comfortable')
    }
    setMounted(true)
  }, [])

  const setDensity = useCallback((newDensity: ContentDensity) => {
    setDensityState(newDensity)
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, newDensity)
      document.documentElement.setAttribute('data-density', newDensity)
    } catch {}
  }, [])

  const cycleDensity = useCallback(() => {
    setDensityState((prev) => {
      const next = DENSITY_META[prev]?.next || 'comfortable'
      try {
        localStorage.setItem(DENSITY_STORAGE_KEY, next)
        document.documentElement.setAttribute('data-density', next)
      } catch {}
      return next
    })
  }, [])

  const value: DensityContextValue = {
    density,
    setDensity,
    cycleDensity,
    densityLabel: DENSITY_META[density]?.label ?? '舒适平衡',
  }

  return (
    <DensityContext.Provider value={value}>
      {children}
    </DensityContext.Provider>
  )
}

export function useDensity() {
  const ctx = useContext(DensityContext)
  if (!ctx) {
    // 降级回退（如单元测试未包裹 Provider 时）
    return {
      density: 'comfortable' as ContentDensity,
      setDensity: () => {},
      cycleDensity: () => {},
      densityLabel: '舒适平衡',
    }
  }
  return ctx
}
