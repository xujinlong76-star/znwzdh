'use client'

import Link from 'next/link'
import { useSiteViewModel } from '@/components/site-view-context'
import type { SiteConfig } from '@/types/site'

interface FooterProps {
  siteInfo?: SiteConfig
}

export function Footer({ siteInfo }: FooterProps) {
  // 服务端组件里渲染期取年份：跨年瞬间（12/31 23:59:59.999）服务端与客户端
  // 可能算出不同年份 → 水合不匹配。加 suppressHydrationWarning 让 React 以
  // 客户端值为准，不必把整个页脚改成客户端组件。
  const currentYear = new Date().getFullYear()
  // 品牌名 / 页脚文案 / 备案号统一取自根布局注入的站点视图：
  // 这三个字段只有后台能改，若继续依赖调用方传 siteInfo，33 处挂载里有一半传的是
  // undefined（/tags /hot /favorites…），改设置对它们永远是空转。
  const site = useSiteViewModel()
  const title = site?.brand || siteInfo?.basic?.title || '山羊胡'
  const footerText = site?.footerText
  const icp = site?.icp

  return (
    <footer className="border-t border-border/40 pt-8 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:pb-8 bg-muted/10 mt-auto">
      <div className="container flex flex-col items-center justify-between gap-4 md:flex-row px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Link href="/" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">主页</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/me" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">用户中心</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/me" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">设为首页领经验加速</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/favorites" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">我的收藏 (E2EE)</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/graph" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">技术生态图谱</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/algorithms" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">前沿算法实验室<span className="ml-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-primary/10 text-primary border border-primary/20">Lab</span></Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/import" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">智能书签导入</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/hot" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">热度趋势榜</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/brief" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">每日简报</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/tags" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">全景标签云</Link>
          <span className="text-border" aria-hidden="true">·</span>
          {/* SEO：站点目录与合集入口 */}
          <Link href="/sites" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">全部站点目录</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/collections" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">精选专题合集</Link>
          <span className="text-border" aria-hidden="true">·</span>
          {/* emerald-600 在 12px 白底上只有 3.62:1（AA 需 4.5），700 才达标 */}
          <Link href="/custom" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">模块化工作台<span className="ml-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">DIY</span></Link>
          <span className="text-border" aria-hidden="true">·</span>
          {/* rose-600 在页脚底上实测 4.47:1 不足 AA，强调色走 700（a11y-contrast 门禁） */}
          <Link href="/marketplace" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors text-rose-700 dark:text-rose-400 font-medium">插件市场</Link>
          <span className="text-border" aria-hidden="true">·</span>
          {/* SEO：/videos 与 /submit 入口 */}
          <Link href="/videos" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">视频资源墙</Link>
          <span className="text-border" aria-hidden="true">·</span>
          <Link href="/submit" className="inline-flex items-center min-h-6 py-0.5 px-1 rounded-md hover:text-foreground transition-colors">网站投稿</Link>
        </div>
        <div className="flex flex-col items-center gap-1.5 md:items-end">
          <p className="text-center text-xs text-muted-foreground font-mono md:text-right">
            &copy; <span suppressHydrationWarning>{currentYear}</span> {title} · AI-Native Cognitive Navigation
          </p>
          {/* 后台「页脚文案」：纯文本渲染，绝不 dangerouslySetInnerHTML */}
          {footerText && (
            <p className="max-w-[46rem] text-center text-xs leading-relaxed text-muted-foreground md:text-right">
              {footerText}
            </p>
          )}
          {icp && (
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {icp}
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}
