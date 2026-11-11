import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ONBOARDING_DISMISSED_VALUE,
  ONBOARDING_STORAGE_KEY,
  isOnboardingDismissed,
  resetOnboarding,
} from '../src/lib/onboarding'

/**
 * B11：引导卡注释承诺「设置页可重新打开」，此前却没有任何入口——
 * 关掉引导的用户除手动清 localStorage 外再也看不到它。
 * 修复：设置页加「重新查看新手引导」入口（清除关闭记录 + 回首页），
 * 键名只在 lib/onboarding.ts 定义一处，引导卡与设置入口共用。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial))
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

describe('lib/onboarding 本机开关', () => {
  it('键名与关闭值固定，不许两边各写一份字面量', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('navhub:onboarding:v1')
    expect(ONBOARDING_DISMISSED_VALUE).toBe('done')
  })

  it('只有明确写了 done 才算关掉', () => {
    expect(isOnboardingDismissed(memoryStorage({ [ONBOARDING_STORAGE_KEY]: 'done' }))).toBe(true)
    expect(isOnboardingDismissed(memoryStorage({}))).toBe(false)
    expect(isOnboardingDismissed(memoryStorage({ [ONBOARDING_STORAGE_KEY]: 'yes' }))).toBe(false)
    expect(isOnboardingDismissed(null)).toBe(false)
  })

  it('reset 清除关闭记录，其余键不动', () => {
    const storage = memoryStorage({ [ONBOARDING_STORAGE_KEY]: 'done', other: 'keep' })
    resetOnboarding(storage)
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull()
    expect(storage.getItem('other')).toBe('keep')
    expect(isOnboardingDismissed(storage)).toBe(false)
  })

  it('存储抛错（隐私模式）时不崩：判关掉为 false、重置静默失败', () => {
    const throwing = {
      get length() {
        return 0
      },
      clear: () => {
        throw new Error('denied')
      },
      getItem: () => {
        throw new Error('denied')
      },
      key: () => null,
      removeItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as Storage
    expect(() => isOnboardingDismissed(throwing)).not.toThrow()
    expect(isOnboardingDismissed(throwing)).toBe(false)
    expect(() => resetOnboarding(throwing)).not.toThrow()
    expect(() => resetOnboarding(null)).not.toThrow()
  })
})

describe('B11 设置页重看入口（源码守卫）', () => {
  it('设置面板有新手引导重看入口：清除关闭记录后回首页', () => {
    const panel = read('src/components/user-center/settings-panel.tsx')
    expect(panel).toContain('新手引导')
    expect(panel).toContain('OnboardingReplayField')
    expect(panel).toContain('resetOnboarding')
    expect(panel).toContain('isOnboardingDismissed')
    expect(panel).toContain('重新查看新手引导')
    expect(panel).toContain('href="/"')
    // 未关过时不说「重新查看」的假话：直接去首页看
    expect(panel).toContain('去首页查看引导')
  })

  it('引导卡与设置入口共用同一把键：卡片不再自写字面量', () => {
    const card = read('src/components/onboarding-card.tsx')
    expect(card).toContain("from '@/lib/onboarding'")
    expect(card).toContain('ONBOARDING_STORAGE_KEY')
    expect(card).toContain('ONBOARDING_DISMISSED_VALUE')
    expect(card).not.toContain("const STORAGE_KEY = 'navhub:onboarding:v1'")
    expect(card).not.toContain("getItem(STORAGE_KEY)")
    expect(card).not.toContain("setItem(STORAGE_KEY, 'done')")
  })

  it('引导卡注释指向真实入口，不再是空头承诺', () => {
    const card = read('src/components/onboarding-card.tsx')
    expect(card).toContain('/me/settings')
    expect(card).toContain('重新查看新手引导')
  })
})
