'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * 视口驱动的分区懒挂载（2026-11-08 深度扫描 P0-1）。
 *
 * ## 为什么需要它
 *
 * 首页在 SSR 阶段刻意只渲染前 `initialCategoryLimit` 个分类（默认 4，见 `app/page.tsx`
 * 的 `HOME_INITIAL_SSR_CATEGORIES`），把未压缩 HTML 压在预算内。但客户端水合后
 * `renderedCategories` 会**立即揭示全部分类**——于是浏览器实测被撑到
 * **873 张卡片 / 42,803 个 DOM 节点 / 移动端页高 22,426px**，Lighthouse 的
 * 「excessive DOM size」阈值（3,000）被超过 14 倍，低端机上连首屏按钮都要等
 * 12.5 秒才可点（见 `scripts/scan-mobile-diy-timing.mjs` 的实测）。
 *
 * 也就是说：**水合后的行为把 SSR 阶段精心设的预算又还回去了**。本组件把两边对齐——
 * 分类区块只在接近视口时才真正挂载，滚过去之后再回滚也不会卸载（避免抖动）。
 *
 * ## 与 SEO 的关系（这是本改动最容易被误解的地方）
 *
 * 本组件挂载的是「客户端第二次渲染」，改变不了服务端 HTML：爬虫拿到的首字节
 * 仍然包含 `initialCategoryLimit` 个分类的全部卡片链接，与改动前**完全一致**。
 * 未挂载分类的站点详情页由 `/sitemap.xml`（实测 5,193 条 `<loc>`）与
 * 分类页内链兜底发现，不存在「减少收录」的问题。
 *
 * ## 边界
 *
 * - 编辑态 / 多选态必须全量可见（用户要对所有卡片动手），走 `force`。
 * - 不支持 `IntersectionObserver` 的环境直接挂载，不做功能阉割。
 * - 占位块保留分类标题、计数与锚点 id：站内目录带跳转、读屏顺序都不受影响。
 */
export interface LazyMountSectionProps {
  /** 分类锚点 id（占位态挂在占位块上，挂载后由真实 section 承载，不会重复） */
  sectionId: string
  /** 分类标题，用于占位块的可见文案与无障碍名称 */
  title: string
  /** 站点计数，用于占位块与高度估算 */
  count: number
  /** 是否强制挂载（编辑态、多选态、搜索/筛选激活时都应为 true） */
  force?: boolean
  /** 视口预距，默认提前 800px 挂载 */
  rootMargin?: string
  /**
   * 轻量占位（未挂载时渲染）。不传时使用内置的 LazySectionPlaceholder
   * （分类标题 + 计数 + 手动展开入口）。
   */
  placeholder?: ReactNode
  /** 真实分区内容 */
  children: ReactNode
}

export function LazyMountSection({
  sectionId,
  title,
  count,
  force = false,
  rootMargin = '800px',
  placeholder,
  children,
}: LazyMountSectionProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (force) {
      setMounted(true)
      return
    }
    if (mounted) return
    const el = hostRef.current
    if (!el) return
    // 环境不支持时不做功能阉割：直接挂载
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [force, mounted, rootMargin])

  if (mounted || force) return <>{children}</>

  return (
    <div ref={hostRef} id={sectionId} className="col-span-12" aria-label={`${title}（尚未展开）`}>
      {placeholder ?? <LazySectionPlaceholder sectionId={sectionId} title={title} count={count} />}
    </div>
  )
}

/**
 * 默认占位块：给出分类标题 / 计数 / 手动展开按钮。
 *
 * 手动展开按钮对键盘用户是**必需**的——没有它，Tab 顺序里这个分类整个不存在，
 * 而「滚动触发」对只按键盘的用户根本不会发生。
 */
export function LazySectionPlaceholder({
  sectionId,
  title,
  count,
}: {
  sectionId: string
  title: string
  count: number
}) {
  return (
    <section
      id={`${sectionId}-placeholder`}
      className="group relative scroll-m-16 rounded-2xl border border-dashed border-border/60 bg-muted/20 p-4"
      style={{ minHeight: 132 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-5 rounded-full bg-primary/50" />
          <h2 className="text-base sm:text-xl font-bold tracking-tight text-foreground truncate">{title}</h2>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 shrink-0">
            {count} 站点
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            // 交给 IntersectionObserver 之外的显式入口：滚过去即可触发挂载
            const el = document.getElementById(sectionId)
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary cursor-pointer shrink-0"
                >
          <ChevronDown className="w-3.5 h-3.5" />
          <span>滚动加载该分类</span>
        </button>
      </div>
    </section>
  )
}
