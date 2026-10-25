'use client'

import React, { createContext, useCallback, useContext, useEffect } from 'react'
import {
  DEFAULT_CONTENT_DENSITY,
  cardDensityOf,
  contentDensityOf,
  readUserPreferences,
  useContentDensity,
  updateUserPreferences,
  type ContentDensity,
} from '@/lib/user-preferences'
import { CARD_DENSITY_OPTIONS } from '@/lib/user-settings'

export type { ContentDensity }

interface DensityContextValue {
  density: ContentDensity
  setDensity: (density: ContentDensity) => void
  cycleDensity: () => void
  densityLabel: string
}

/**
 * 档位界面文案的唯一出处是 user-settings 的 CARD_DENSITY_OPTIONS（设置页下拉用的就是它）。
 * 此前首页切换菜单在这里另写一套「极客密排/舒适平衡/画廊沉浸」，与设置页的
 * 「紧凑密排/舒适/宽松沉浸」对不上号 —— 同一设置两套名字，用户两边对照时必然困惑。
 */
export function canonicalDensityLabel(density: ContentDensity): string {
  const mode = cardDensityOf(density)
  return CARD_DENSITY_OPTIONS.find((option) => option.value === mode)?.label ?? '舒适 (默认)'
}

/** 触发器 tooltip / aria 用的短标签：去掉括注（「舒适 (默认)」→「舒适」） */
function shortDensityLabel(density: ContentDensity): string {
  return canonicalDensityLabel(density).split(' (')[0]
}

const DENSITY_META: Record<ContentDensity, { label: string; description: string; next: ContentDensity }> = {
  dense: {
    label: shortDensityLabel('dense'),
    description: '75% 间距压缩，高屏效比，适合极客多屏作业',
    next: 'comfortable',
  },
  comfortable: {
    label: shortDensityLabel('comfortable'),
    description: '100% 黄金间隙，层次清晰，官方推荐默认',
    next: 'spacious',
  },
  spacious: {
    label: shortDensityLabel('spacious'),
    description: '125% 宽幅留白，宽屏展陈，适合平板与大屏触控',
    next: 'dense',
  },
}

const DensityContext = createContext<DensityContextValue | null>(null)

/**
 * 密度状态的唯一来源是用户偏好（`UserSettingsModel.cardDensity`）。
 *
 * 改造前这里读的是独立键 `navhub_content_density`，而用户中心另有一个
 * `cardDensity` 设置 —— 后者全仓无人消费，等于「卡片展示密度」这个设置项是空的。
 * 现在两处（这里的 DensityToggle 与用户中心设置页）写同一份偏好，
 * `[data-density]` 属性由偏好单向派生，不存在两个真相源。
 *
 * 云端契约不变：`me.ts` 的 zod 仍收 comfortable / compact / minimal 三档，
 * 映射集中在 `contentDensityOf`（compact→dense、minimal→spacious）。
 */
export function DensityProvider({ children }: { children: React.ReactNode }) {
  const density = useContentDensity()

  /**
   * 属性一律按「存储里的真实档位」落，而不是直接写 hook 值。
   *
   * 水合首帧 `useContentDensity` 只能拿 `getServerSnapshot`（React 的规则），值仍是默认档；
   * 而 `<head>` 里的预绘脚本已按存储把正确档位写上去了。照写 hook 值就会先把画对的布局
   * 打回默认、等订阅回读再改回来 —— 整片网格两次重排，比不改更糟。两者判据同源，所以
   * 「存储与 hook 不一致」只可能是订阅还没追上，这一拍直接跳过即可。
   */
  useEffect(() => {
    const stored = contentDensityOf(readUserPreferences().cardDensity)
    if (stored !== density) return
    document.documentElement.setAttribute('data-density', stored)
  }, [density])

  const setDensity = useCallback((next: ContentDensity) => {
    updateUserPreferences({ cardDensity: cardDensityOf(next) })
  }, [])

  const cycleDensity = useCallback(() => {
    setDensity(DENSITY_META[density]?.next ?? DEFAULT_CONTENT_DENSITY)
  }, [density, setDensity])

  const value: DensityContextValue = {
    density,
    setDensity,
    cycleDensity,
    densityLabel: DENSITY_META[density]?.label ?? '舒适',
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
    // 降级回退（如单元测试未包裹 Provider 时）：仍能落偏好，不至于点了没反应
    return {
      density: DEFAULT_CONTENT_DENSITY,
      setDensity: (next: ContentDensity) => {
        updateUserPreferences({ cardDensity: cardDensityOf(next) })
      },
      cycleDensity: () => {},
      densityLabel: '舒适',
    }
  }
  return ctx
}
