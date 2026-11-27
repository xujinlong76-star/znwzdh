'use client'

/**
 * 账号级偏好的「落地」组件：把服务端用户设置应用到本机运行时。
 *
 * 两项偏好在这里生效（服务端为事实源，本机只是执行层）：
 *  - themePreference：登录后每个浏览器会话应用一次到 next-themes；
 *    之后工具栏手动切换只影响本机当前会话，不回写账号（设置页改动会经
 *    navhub_settings_changed 事件即时应用并保存到云端）。
 *  - hiddenHomeModules：写入 personal-home-modules 的本机键，首页据此
 *    在全站 features 之上叠加个人隐藏；设置页保存时同样即时刷新。
 *
 * 未登录/取不到云端设置时什么都不做：本机既有状态保持原样，绝不因一次
 * 同步失败把用户的主题或模块掩码清掉。
 */
import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { probeClientSession } from '@/lib/client-session'
import { readLocalUserSettings, type ThemePreference } from '@/lib/user-settings'
import { parseHiddenHomeModules, writeLocalHiddenHomeModules } from '@/lib/personal-home-modules'

export function UserPrefsSync({ defaultTheme = 'system' }: { defaultTheme?: 'light' | 'dark' | 'system' }) {
  const { setTheme } = useTheme()

  /**
   * 上一次见过的账号级主题偏好。M-04：只在「有值 → 未设置」的跃迁时才复位
   * 本机主题——偏好一直是 null（从未设过）时不碰：工具栏的手动切换只影响
   * 本机，必须在不相关的设置改动后继续保留。
   * U-456：挂载时就用本机偏好预填（见下方 effect 开头）。不预填时，
   * reload 后的新会话里 prev 是 undefined，dark→未设置的第一跳事件
   * 看不到跃迁，复位不触发（key 仍 dark、页面仍 dark）。
   */
  const prevPreferenceRef = useRef<ThemePreference | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    // U-456：挂载时用本机偏好预填 prev，使跨会话的跃迁也能被下一跳
    // 事件识别。只预填、不复位：偏好为 null 时预填值是 null（falsy），
    // 之后的不相关设置改动仍走「不碰本机主题」分支，工具栏手动切换保留。
    prevPreferenceRef.current = readLocalUserSettings().themePreference

    const applyFromLocal = () => {
      const s = readLocalUserSettings()
      const prev = prevPreferenceRef.current
      prevPreferenceRef.current = s.themePreference
      if (s.themePreference) {
        setTheme(s.themePreference)
      } else if (prev) {
        // M-04：选回「未设置」= 跟随全站默认。只把 themePreference 置 null
        // 不够：next-themes 早把旧值（dark/light）写进了本机 `theme` 键，
        // 之后每次加载都以它为准，ThemeProvider 的 defaultTheme 再也生效不了。
        // 先 setTheme(全站默认)让当前会话立即回到默认（setTheme 在
        // next-themes 0.2.1 里同步写键），再删 `theme` 键，使下次加载时
        // next-themes 直接用 defaultTheme；顺序不能反。
        setTheme(defaultTheme)
        try {
          window.localStorage.removeItem('theme')
        } catch {
          /* localStorage 不可用时退化为仅 setTheme，不阻断 */
        }
      }
      writeLocalHiddenHomeModules(parseHiddenHomeModules(s.hiddenHomeModules))
    }
    const onSettingsChanged = () => applyFromLocal()
    window.addEventListener('navhub_settings_changed', onSettingsChanged)

    void (async () => {
      try {
        const probe = await probeClientSession()
        if (cancelled || probe.kind !== 'ok' || !probe.session.user?.id) return
        // 每个浏览器会话只应用一次云端主题：否则每次路由切换都会把用户
        // 刚在工具栏手动切的主题又压回账号值。
        const appliedKey = `navhub_prefs_applied:${probe.session.user.id}`
        let alreadyApplied = false
        try {
          alreadyApplied = window.sessionStorage.getItem(appliedKey) === '1'
        } catch {
          alreadyApplied = false
        }
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          settings?: { themePreference?: string | null; hiddenHomeModules?: unknown }
        }
        const settings = data.settings
        if (!settings) return
        if (!alreadyApplied && settings.themePreference) {
          setTheme(settings.themePreference)
          try {
            window.sessionStorage.setItem(appliedKey, '1')
          } catch {
            /* sessionStorage 不可用时退化为每次应用，不阻断 */
          }
        }
        // 模块掩码每次进站都以云端为准（它没有本机会话级的手动覆盖入口）
        writeLocalHiddenHomeModules(parseHiddenHomeModules(settings.hiddenHomeModules))
      } catch {
        // 同步失败不阻断页面：本机设置仍在
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('navhub_settings_changed', onSettingsChanged)
    }
  }, [setTheme, defaultTheme])

  return null
}
