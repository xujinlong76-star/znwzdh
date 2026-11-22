'use client'
/**
 * 短剧热榜 DIY 显式开启状态（2026-11-22）。
 * 默认关：短剧只在该分类上下文出现，不占全局首屏。
 * 存储读写失败一律按关处理（隐私模式不炸页）。
 */
import { useEffect, useState } from 'react'
import { readDramaHotlistOptIn, DRAMA_OPT_IN_STORAGE_KEY } from '@/lib/modular/workspace-presets'

export function useDramaHotlistOptIn(): boolean {
  const [optIn, setOptIn] = useState(false)

  useEffect(() => {
    try {
      setOptIn(readDramaHotlistOptIn(window.localStorage))
    } catch {
      setOptIn(false)
    }
    // 响应 DIY 面板在另一个组件里改同一开关
    const sync = () => {
      try {
        setOptIn(readDramaHotlistOptIn(window.localStorage))
      } catch {
        setOptIn(false)
      }
    }
    window.addEventListener('storage', sync)
    window.addEventListener(DRAMA_OPT_IN_STORAGE_KEY + ':changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(DRAMA_OPT_IN_STORAGE_KEY + ':changed', sync)
    }
  }, [])

  return optIn
}
