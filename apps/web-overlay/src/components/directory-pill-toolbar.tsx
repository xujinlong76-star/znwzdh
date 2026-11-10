'use client'

import { useRef, useState, useMemo, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'
import { useHomeDIY } from '@/lib/modular/use-home-diy'

export interface DirectoryLink {
  id: string
  slug: string
  title: string
  count: number
}

/**
 * 首页「站内目录」的分类胶囊带（WAI-ARIA 复合控件 / roving tabindex）。
 *
 * ## 为什么需要
 *
 * 首页实测主内容区有 **285 个 Tab 停留点**，其中目录带胶囊独占 **41 个**。
 * 对一个「只是顺手列出分类入口」的横条来说，让键盘用户按 41 次 Tab 才能越过它，
 * 与卡片已经采用的复合控件模型（一张卡一个入口 + 方向键内部导航）明显不一致。
 *
 * 现在整条目录带**只有 1 个 Tab 停留点**：
 *   - Tab 进入 → 聚焦当前活动项；
 *   - ← / → / Home / End 在胶囊间移动焦点；
 *   - Enter / Space 走 Link 默认行为（导航到 /category/:slug）；
 *   - Esc 把焦点交还给容器，方便继续按 Tab 离开。
 *
 * ## 无障碍语义
 *
 * `role="toolbar"` + `aria-label` + `aria-orientation="horizontal"`，
 * 每个胶囊 `role="link"`（实际是 <a>，保留中键/新标签页/复制链接等原生能力），
 * `aria-current="page"` 由 Next 的 Link 自己按路径处理（此处不伪造）。
 *
 * ## 性能
 *
 * 与卡片同口径：专注区本身不做虚拟化——41 个 <a> 的 DOM 成本可忽略，
 * 这里收敛的是**键盘成本**而非渲染成本。
 */
export function DirectoryPillToolbar({
  links,
  counts,
}: {
  links: DirectoryLink[]
  /** 分类 id → 本页真实渲染出的站点数（与区块头计数同口径） */
  counts?: Map<string, number>
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLUListElement>(null)
  const { isCategoryHidden, bypassMaskTemporarily } = useFeatureMask()
  const { hiddenCategoryIds } = useHomeDIY()

  const visibleLinks = useMemo(
    () =>
      links.filter(
        (link) =>
          bypassMaskTemporarily ||
          (!isCategoryHidden(link.id) && !hiddenCategoryIds.includes(link.id))
      ),
    [links, bypassMaskTemporarily, isCategoryHidden, hiddenCategoryIds]
  )

  const focusIndex = (next: number) => {
    if (visibleLinks.length === 0) return
    const clamped = (next + visibleLinks.length) % visibleLinks.length
    setActiveIndex(clamped)
    const el = rootRef.current?.querySelectorAll<HTMLAnchorElement>('[data-dir-pill]')[clamped]
    el?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        focusIndex(activeIndex + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        focusIndex(activeIndex - 1)
        break
      case 'Home':
        e.preventDefault()
        focusIndex(0)
        break
      case 'End':
        e.preventDefault()
        focusIndex(visibleLinks.length - 1)
        break
      case 'Escape':
        e.preventDefault()
        rootRef.current?.focus()
        break
      default:
        break
    }
  }

  if (visibleLinks.length === 0) return null

  return (
    <ul
      ref={rootRef}
      role="toolbar"
      aria-label="站内分类目录（方向键切换，回车打开）"
      aria-orientation="horizontal"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        // 从外部 Tab 进来时，把焦点交给当前活动项，而不是停在容器上
        if (e.target === rootRef.current) {
          const el = rootRef.current?.querySelectorAll<HTMLAnchorElement>('[data-dir-pill]')[activeIndex]
          el?.focus()
        }
      }}
      className="flex flex-wrap items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 rounded-lg"
    >
      {visibleLinks.map((link, index) => (
        <li key={link.id}>
          <Link
            href={`/category/${encodeURIComponent(link.slug)}`}
            data-dir-pill=""
            tabIndex={index === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(index)}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 min-h-6 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {link.title}
            <span className="font-mono text-[10px] opacity-70">
              {counts?.get(link.id) ?? link.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
