"use client"

/**
 * 回顶按钮（2026-11-21 收口）。
 *
 * 原实现自带 fixed bottom-8 right-8 z-50 定位，与小猫挂件（z-60，
 * right 18px / bottom 112px）各自算位置、互不知情——挂件展开时会盖住它。
 *
 * 现在统一由 @/components/global-floating-dock 承担定位与 z 轴，
 * 本组件退化为薄壳，保持既有调用点（如 /videos）不变。
 */
import { GlobalFloatingDock } from '@/components/global-floating-dock'

export function ScrollToTop() {
  return <GlobalFloatingDock />
}
