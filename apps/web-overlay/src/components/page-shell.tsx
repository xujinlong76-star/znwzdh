import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'
import { Container } from '@/components/ui/container'

/**
 * 页面框架（2026-11-25 UI 评审 P0-1 阶段 B）：收编各页随手写的
 * 「Container + py-* + space-y-* + max-w-*」组合，让四类页面共享同一套
 * 纵向节奏与宽度语义，不再每页各配一套。
 *
 * 三档宽度语义（width）：
 *   - `doc`  居中窄栏（类目总览 / 站点目录这类文档型页）：max-w-5xl
 *   - `list` 全宽目录 / 榜单（趋势热榜 / 列表页）：吃满 Container
 *
 * 统一纵向节奏：`py-6 sm:py-10 space-y-6`——替换 /hot 的 `py-4 sm:py-8
 * space-y-5 sm:space-y-6` 与 /sites、/category 的 `py-6 sm:py-10 space-y-6`
 * 两套写法（后者即为本值，前者只是历史微调，统一后差异 ≤4px）。
 *
 * 地标契约：`as="main" id="main-content"` 时本组件就是主内容地标。
 * **调用方必须把 `id="main-content"` 字面量写在自己的源码里**——
 * main-landmark.test.ts 按字面量扫描页面/主体文件（见该文件 §LANDMARK_ELSEWHERE），
 * 省掉 id 会让守卫判「页面没有地标」。
 *
 * Footer 不在本框架内：各页 Footer 挂载位置（Container 内外）尚未统一，
 * 留给后续批次，本组件只管内容帧。
 */

export type PageShellWidth = 'doc' | 'list'

const WIDTH_CLASS: Record<PageShellWidth, string> = {
  doc: 'max-w-5xl mx-auto',
  list: '',
}

export function PageShell({
  width = 'list',
  as,
  id,
  className,
  children,
}: {
  width?: PageShellWidth
  /** 传 'main' + id="main-content" 时成为页面主内容地标（字面量必须留在调用方源码） */
  as?: 'div' | 'main'
  id?: string
  /** 追加到内容帧的类名；仅用于页面级特殊布局，不覆盖内置纵向节奏 */
  className?: string
  children: ReactNode
}) {
  return (
    <Container as={as} id={id}>
      <div className={cn('py-6 sm:py-10 space-y-6', WIDTH_CLASS[width], className)}>{children}</div>
    </Container>
  )
}

/**
 * 页面头（标题 + 描述 + 枢纽互链导航）：/sites 与 /category 此前各写一份
 * 一模一样的 `<header>` + h1 + 导航轨，这里收成一处。
 *
 * `links` 渲染「站内目录」互链轨（· 分隔、text-primary 链接）；需要完全
 * 自定义的导航可改传 `nav` 节点，两者同时传时 `nav` 优先。
 */
export function PageHeader({
  title,
  description,
  links,
  nav,
  className,
}: {
  title: string
  description?: ReactNode
  /** 枢纽互链（按分类浏览 / 按标签浏览 …），自动加 · 分隔 */
  links?: Array<{ href: string; label: string }>
  /** 完全自定义的头部导航（与 links 二选一，优先级更高） */
  nav?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('space-y-2', className)}>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {nav ? (
        nav
      ) : links && links.length > 0 ? (
        <nav aria-label="站内目录" className="flex flex-wrap items-center gap-3 text-xs pt-1">
          {links.map((link, i) => (
            <span key={link.href} className="flex items-center gap-3">
              {i > 0 ? (
                <span className="text-border" aria-hidden>
                  ·
                </span>
              ) : null}
              <Link href={safeHref(link.href)} className="text-primary hover:underline">
                {link.label}
              </Link>
            </span>
          ))}
        </nav>
      ) : null}
    </header>
  )
}
