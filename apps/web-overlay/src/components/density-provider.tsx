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
    // 先把外观应用上（不依赖存储），再尽力持久化：
    // 原来 setAttribute 写在 try 里，setItem 一旦抛错（隐私模式 / 配额满）
    // 属性就设不进去 —— 用户点了切换却毫无变化。顺序反过来就不会了。
    document.documentElement.setAttribute('data-density', newDensity)
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, newDensity)
    } catch {
      // 写盘失败只影响「下次打开还记得」：本次切换已经生效
    }
  }, [])

  const cycleDensity = useCallback(() => {
    setDensityState((prev) => {
      const next = DENSITY_META[prev]?.next || 'comfortable'
      // 同上：外观先落地，写盘失败只影响下次刷新
      document.documentElement.setAttribute('data-density', next)
      try {
        localStorage.setItem(DENSITY_STORAGE_KEY, next)
      } catch {
        // 写盘失败只影响「下次打开还记得」：本次切换已经生效
      }
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
