/**
 * U-366：iOS 用户永远看不到主动安装提示。
 *
 * 复现（纯 main be8fb8c5）：install-prompt.ts shouldOfferInstall 里
 * `!canPrompt` 即 false； iOS Safari 从不触发 beforeinstallprompt，
 * canPrompt 恒 false，全文件无 iOS 手动分支。
 *
 * 修复：iOS 分支（UA 判定 + 未 standalone + 访问 ≥3 次 + 未关闭过）给
 * 两步手动卡（分享 → 添加到主屏幕），复用现有关闭节流（INSTALL_DISMISS_KEY）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INSTALL_DISMISS_DAYS,
  INSTALL_MIN_VISITS,
  isIOSUserAgent,
  shouldOfferInstall,
  shouldOfferIosManualInstall,
} from '../src/lib/install-prompt'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const COMPONENT = overlaySource('src/components/install-prompt.tsx')

describe('U-366：iOS 判定（纯函数）', () => {
  const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
  const IPAD_UA =
    'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
  const IPADOS_DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
  const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
  const MAC_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

  it('iPhone / iPad UA 判定为 iOS', () => {
    expect(isIOSUserAgent(IPHONE_UA)).toBe(true)
    expect(isIOSUserAgent(IPAD_UA)).toBe(true)
  })

  it('iPadOS 桌面伪装 UA + 多点触控判定为 iOS，无触控则不是', () => {
    expect(isIOSUserAgent(IPADOS_DESKTOP_UA, 5)).toBe(true)
    expect(isIOSUserAgent(IPADOS_DESKTOP_UA, 0)).toBe(false)
    expect(isIOSUserAgent(MAC_UA, 0)).toBe(false)
  })

  it('Android 不是 iOS', () => {
    expect(isIOSUserAgent(ANDROID_UA)).toBe(false)
  })
})

describe('U-366：iOS 手动安装卡展示条件（纯函数）', () => {
  const base = {
    visits: INSTALL_MIN_VISITS,
    dismissedUntil: 0,
    now: 1000,
    standalone: false,
    isIOS: true,
  }

  it('iOS + 达访问阈值 + 未关闭过 → 展示手动卡', () => {
    expect(shouldOfferIosManualInstall(base)).toBe(true)
  })

  it('非 iOS / 已装为应用 / 访问不足 / 关闭期内 → 不展示', () => {
    expect(shouldOfferIosManualInstall({ ...base, isIOS: false })).toBe(false)
    expect(shouldOfferIosManualInstall({ ...base, standalone: true })).toBe(false)
    expect(shouldOfferIosManualInstall({ ...base, visits: INSTALL_MIN_VISITS - 1 })).toBe(false)
    expect(shouldOfferIosManualInstall({ ...base, dismissedUntil: base.now + 1 })).toBe(false)
  })

  it('关闭期满后可再次展示（复用 INSTALL_DISMISS_DAYS 节流）', () => {
    expect(INSTALL_DISMISS_DAYS).toBeGreaterThan(0)
    expect(shouldOfferIosManualInstall({ ...base, dismissedUntil: base.now })).toBe(true)
  })

  it('原生 shouldOfferInstall 在 iOS（无 prompt 事件）下仍为 false——手动分支是独立通道', () => {
    expect(shouldOfferInstall({ ...base, canPrompt: false })).toBe(false)
  })
})

describe('U-366：iOS 两步手动卡（组件接线）', () => {
  it('组件调 shouldOfferIosManualInstall 决定手动卡展示', () => {
    expect(COMPONENT).toContain('shouldOfferIosManualInstall')
    expect(COMPONENT).toContain('isIOSUserAgent')
  })

  it('手动卡写明两步：分享按钮 → 添加到主屏幕', () => {
    expect(COMPONENT).toContain('添加到主屏幕')
    expect(COMPONENT).toContain('分享')
  })

  it('手动卡有关闭节流：关闭时写 INSTALL_DISMISS_KEY，并隐藏手动卡', () => {
    expect(COMPONENT).toContain('iosManualVisible')
    expect(COMPONENT).toContain('dismissIosManual')
    const start = COMPONENT.indexOf('const dismissIosManual')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = COMPONENT.slice(start, start + 600)
    expect(body).toContain('INSTALL_DISMISS_KEY')
    expect(body).toContain('installDismissedUntil(Date.now())')
    expect(body).toContain('setIosManualVisible(false)')
  })

  it('手动卡只在无原生 prompt 事件时出现（原生事件优先）', () => {
    expect(COMPONENT).toContain('iosManualVisible && !deferred')
  })
})
