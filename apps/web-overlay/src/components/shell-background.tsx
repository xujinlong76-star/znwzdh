'use client'

/**
 * 首屏瘦身 Step 5：后台能力件的客户端挂载壳。
 *
 * layout 是 Server Component，不能用 ssr:false；普通 dynamic 在服务端仍会
 * 把组件代码留在同步集（实测：PwaRegister 0 B、InstallPrompt -114 B）。
 * 故六件收进这个 'use client' 壳里，用 ssr:false 的 dynamic 导出——
 * 六件全是 effect 驱动（登录同步/偏好落地/PWA 注册/性能上报/离线横幅/
 * 安装提示），水合后挂载与原来一致，只是晚一个 chunk 加载。
 * 调用方只改 import 源，JSX 与挂载位置一字不动；UserPrefsSync 照旧留在
 * ThemeProvider 内（它用 useTheme）。
 */
import dynamic from 'next/dynamic'

export const SessionSync = dynamic(
  () => import('@/components/user-center/session-sync').then((m) => m.SessionSync),
  { ssr: false, loading: () => null },
)

export const PwaRegister = dynamic(
  () => import('@/components/pwa-register').then((m) => m.PwaRegister),
  { ssr: false, loading: () => null },
)

export const InstallPrompt = dynamic(
  () => import('@/components/install-prompt').then((m) => m.InstallPrompt),
  { ssr: false, loading: () => null },
)

export const WebVitalsReporter = dynamic(
  () => import('@/components/web-vitals-reporter').then((m) => m.WebVitalsReporter),
  { ssr: false, loading: () => null },
)

export const UserPrefsSync = dynamic(
  () => import('@/components/user-center/user-prefs-sync').then((m) => m.UserPrefsSync),
  { ssr: false, loading: () => null },
)

export const OfflineBanner = dynamic(
  () => import('@/components/offline-banner').then((m) => m.OfflineBanner),
  { ssr: false, loading: () => null },
)
