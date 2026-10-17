'use client'

import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { NAV_ICON_FALLBACK, resolveNavIcon } from '@/lib/nav-icons'

/**
 * 表外图标的按需兜底。
 *
 * `lib/nav-icons.ts` 的静态映射覆盖了真实数据里的全部名字（有测试守着），
 * 但分类图标是后台自由文本，谁也无法保证将来不会出现一个新名字。
 * 以前为了兜住这种可能，整包 lucide 被静态打进了首屏（实测 620 kB 原始体积）。
 *
 * 这里改成：只有真的遇到表外名字时，才 `import('lucide-react')` 拉一个异步 chunk。
 * 于是
 *   - 已知名字：静态映射，零额外体积、无闪烁；
 *   - 未知名字：先显示兜底图标，异步 chunk 到位后换成真实图标（行为与旧实现一致）；
 *   - 名字根本不存在：和旧实现一样落到 `NAV_ICON_FALLBACK`。
 */
let allIconsPromise: Promise<Record<string, unknown>> | null = null

function loadAllIcons(): Promise<Record<string, unknown>> {
  if (!allIconsPromise) {
    allIconsPromise = import('lucide-react') as unknown as Promise<Record<string, unknown>>
  }
  return allIconsPromise
}

/** lucide 的图标是 forwardRef 对象；用它把 r(e)-export 里的非组件成员排掉 */
function isIconLike(value: unknown): value is LucideIcon {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in value
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const [Icon, setIcon] = useState<LucideIcon>(() => resolveNavIcon(name) ?? NAV_ICON_FALLBACK)

  useEffect(() => {
    const staticIcon = resolveNavIcon(name)
    if (staticIcon) {
      setIcon(() => staticIcon)
      return
    }

    let cancelled = false
    loadAllIcons()
      .then((all) => {
        if (cancelled) return
        const found = all[name.trim()]
        setIcon(() => (isIconLike(found) ? found : NAV_ICON_FALLBACK))
      })
      .catch(() => {
        if (!cancelled) setIcon(() => NAV_ICON_FALLBACK)
      })

    return () => {
      cancelled = true
    }
  }, [name])

  return <Icon className={className} />
}
