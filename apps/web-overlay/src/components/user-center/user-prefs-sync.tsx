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
import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { probeClientSession } from '@/lib/client-session'
import { readLocalUserSettings } from '@/lib/user-settings'
import { parseHiddenHomeModules, writeLocalHiddenHomeModules } from '@/lib/personal-home-modules'

export function UserPrefsSync() {
  const { setTheme } = useTheme()

  useEffect(() => {
    let cancelled = false

    const applyFromLocal = () => {
      const s = readLocalUserSettings()
      if (s.themePreference) setTheme(s.themePreference)
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
  }, [setTheme])

  return null
}
