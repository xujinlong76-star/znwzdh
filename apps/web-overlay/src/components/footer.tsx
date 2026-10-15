import Link from 'next/link'
import { Icons } from '@/components/icons'
import type { SiteConfig } from '@/types/site'

interface FooterProps {
  siteInfo?: SiteConfig
}

export function Footer({ siteInfo }: FooterProps) {
  const currentYear = new Date().getFullYear()
  // 新增页面（/tags /hot /favorites）不传 siteInfo 时用默认品牌名，
  // 避免为了一个页脚把整站配置异步加载进每个新页面。
  const title = siteInfo?.basic?.title ?? 'NavHub'

  return (
    <footer className="border-t border-border/40 py-8 bg-muted/10 mt-auto">
      <div className="container flex flex-col items-center justify-between gap-4 md:flex-row px-4">
        <div className="flex flex-wrap items-center justify-center gap-3.5 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors font-medium">主页</Link>
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
          <Link href="/collections" className="hover:text-foreground transition-colors">精选专题</Link>
          <span className="text-border">·</span>
          <Link href="/custom" className="hover:text-foreground transition-colors text-emerald-600 dark:text-emerald-400 font-medium">模块化工作台</Link>
        </div>
        <p className="text-center text-xs text-muted-foreground/80 font-mono">
          &copy; {currentYear} {title} · AI-Native Cognitive Navigation
        </p>
      </div>
    </footer>
  )

}
