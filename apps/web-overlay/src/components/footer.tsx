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
        <div className="flex flex-wrap items-center justify-center gap-3.5 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors font-medium">主页</Link>
          <span className="text-border">·</span>
          <Link href="/me" className="hover:text-foreground transition-colors">用户中心</Link>
          <span className="text-border">·</span>
          <Link href="/favorites" className="hover:text-foreground transition-colors">我的收藏 (E2EE)</Link>
          <span className="text-border">·</span>
          <Link href="/graph" className="hover:text-foreground transition-colors">技术生态图谱</Link>
          <span className="text-border">·</span>
          <Link href="/algorithms" className="hover:text-foreground transition-colors text-primary font-semibold">前沿算法实验室</Link>
          <span className="text-border">·</span>
          <Link href="/import" className="hover:text-foreground transition-colors">智能书签导入</Link>
          <span className="text-border">·</span>
          <Link href="/hot" className="hover:text-foreground transition-colors">热度趋势榜</Link>
          <span className="text-border">·</span>
          <Link href="/tags" className="hover:text-foreground transition-colors">全景标签云</Link>
          <span className="text-border">·</span>
          {/* SEO：站点目录与合集入口此前页脚完全没有，导致 1013 个详情页与 4 个合集页全是孤岛 */}
          <Link href="/sites" className="hover:text-foreground transition-colors">全部站点目录</Link>
          <span className="text-border">·</span>
          <Link href="/collections" className="hover:text-foreground transition-colors">精选专题合集</Link>
          <span className="text-border">·</span>
          {/* emerald-600 在 12px 白底上只有 3.62:1（AA 需 4.5），700 才达标 */}
          <Link href="/custom" className="hover:text-foreground transition-colors text-emerald-700 dark:text-emerald-400 font-medium">模块化工作台</Link>
          <span className="text-border">·</span>
          <Link href="/marketplace" className="hover:text-foreground transition-colors text-rose-700 dark:text-rose-400 font-medium">插件市场</Link>
          <span className="text-border">·</span>
          {/* SEO：/videos 与 /submit 此前全站无 SSR 入链（link-graph 最后 2 个
              真实内容页孤岛），补页脚入口后链接图 100% 可达 */}
          <Link href="/videos" className="hover:text-foreground transition-colors">视频资源墙</Link>
          <span className="text-border">·</span>
          <Link href="/submit" className="hover:text-foreground transition-colors">网站投稿</Link>
        </div>
        <div className="flex flex-col items-center gap-1.5 md:items-end">
          <p className="text-center text-xs text-muted-foreground font-mono md:text-right">
            &copy; <span suppressHydrationWarning>{currentYear}</span> {title} · AI-Native Cognitive Navigation
          </p>
          {/* 后台「页脚文案」：纯文本渲染，绝不 dangerouslySetInnerHTML —— 这个字段由
              后台写入、所有访客页面输出，是天然的存储型 XSS 面。 */}
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
