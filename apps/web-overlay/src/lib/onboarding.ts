/**
 * 首访引导的本机开关（B11）。
 *
 * 引导卡（`components/onboarding-card.tsx`）只看这一把键：
 * 值为 'done' 表示用户已关掉，不再出现；其余/缺失都视为「还没看过」。
 * 设置页的「重新查看新手引导」入口与引导卡共用这把键，键名只在这里
 * 定义一处——两边各写一份字面量是漂移的源头（此前卡片注释承诺「设置页
 * 可重新打开」，实际却没有任何入口，承诺落空）。
 *
 * 纯模块：不 import React，可被服务端与客户端安全引用。
 * 本机存储（localStorage）只存这台设备，与字号（`lib/font-size.ts`）
 * 同一纪律，不走服务端用户设置。
 */

export const ONBOARDING_STORAGE_KEY = 'navhub:onboarding:v1'

export const ONBOARDING_DISMISSED_VALUE = 'done'

/** 用户是否已关掉引导：只有明确写了 'done' 才算关掉 */
export function isOnboardingDismissed(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_DISMISSED_VALUE
  } catch {
    // 隐私模式下 localStorage 可能抛错：按「没关过」处理，
    // 引导卡自身在同样环境下也不会显示，不会因此多出一次打扰。
    return false
  }
}

/** 清除关闭记录：下次回到首页，引导卡重新出现 */
export function resetOnboarding(storage: Storage | null): void {
  if (!storage) return
  try {
    storage.removeItem(ONBOARDING_STORAGE_KEY)
  } catch {
    // 写不进本机存储时静默失败：调用方照常回首页，
    // 引导卡按它自己的读取结果决定显隐，不假装已重置。
  }
}
