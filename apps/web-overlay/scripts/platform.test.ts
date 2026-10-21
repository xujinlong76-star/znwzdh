import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isClient,
  isAppleDevice,
  getModifierKey,
  isTouchDevice,
  isStandalonePwa,
} from '../src/lib/platform'

describe('Cross-Platform Perception Utils', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      navigator: {
        userAgent: '',
        platform: '',
        maxTouchPoints: 0,
      },
      matchMedia: () => ({ matches: false }),
    }
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  it('isClient detects environment correctly', () => {
    expect(isClient()).toBe(true)
  })

  it('detects Apple platform via userAgentData', () => {
    ;(globalThis as any).window.navigator = {
      userAgentData: { platform: 'macOS' },
      platform: 'Win32',
      maxTouchPoints: 0,
    }
    expect(isAppleDevice()).toBe(true)
    expect(getModifierKey()).toBe('⌘')
  })

  it('detects Windows platform correctly', () => {
    ;(globalThis as any).window.navigator = {
      userAgentData: { platform: 'Windows' },
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 0,
    }
    expect(isAppleDevice()).toBe(false)
    expect(getModifierKey()).toBe('Ctrl')
  })

  it('detects iPadOS with desktop mode safari (MacIntel + touchPoints > 1)', () => {
    ;(globalThis as any).window.navigator = {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6)',
      maxTouchPoints: 5,
    }
    expect(isAppleDevice()).toBe(true)
    expect(getModifierKey()).toBe('⌘')
  })

  it('detects touch device via maxTouchPoints and ontouchstart', () => {
    ;(globalThis as any).window.navigator = {
      maxTouchPoints: 2,
    }
    expect(isTouchDevice()).toBe(true)
  })

  it('detects standalone PWA mode', () => {
    ;(globalThis as any).window.navigator = {
      standalone: true,
      maxTouchPoints: 0,
    }
    expect(isStandalonePwa()).toBe(true)
  })
})
