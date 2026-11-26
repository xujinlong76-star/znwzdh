'use client'

import Link from 'next/link'
import { useSiteViewModel } from '@/components/site-view-context'
import { HOMEPAGE_CLAIM_XP } from '@/lib/growth-constants'
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

  /*
   * 2026-11-22 底部安全区按浮坞实测高度抬到 6-7rem。
   * 原值：移动端 5.5rem / 平板 4.5rem / 桌面 lg:pb-8(2rem)。
   * 桌面 2rem 明显不够——右下角浮坞（猫 48px + 回顶钮 44px + gap 8px + bottom 16px
   * ≈ 116px）会压住页脚右端的「短剧专区」「DIY」等链接，实测 390x844 复现。
   * 现在统一 6rem(96px) 起、移动端 7rem(112px)，让版权行与链接永远高于浮坞。
   *
   * 2026-11-26 修正：11-22 的模型按浮坞叠层（116px）算，但猫是独立 fixed
   * 元素，不在浮坞栈里——移动端猫带顶沿 = bottom 偏移（3.5rem+32px=88px）
   * + 猫高 40px = 128px，7rem=112px 仍短 16px；390x844 滚到底实测仍压住
   * 页脚链接行（「主页/用户中心/设为首页领 +100 经验」一行）。移动端再抬
   * 到 9rem(144px)，留 16px 余量；平板/桌面猫带顶沿 160px、文本止于 96px，
   * 本就清开，6rem 不动。
   */
  return (
    <footer className="border-t border-border/40 pt-8 bg-muted/10 mt-auto pb-[calc(9rem+env(safe-area-inset-bottom,0px))] min-[640px]:max-[1024px]:pb-[calc(6rem+env(safe-area-inset-bottom,0px))] lg:pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
      <div className="container flex flex-col items-center justify-between gap-4 md:flex-row px-4">
        {/* 2026-11-21 页脚链接改两组规整排布。
            原实现 17 个链接 + 16 个「·」分隔符全部塞进一个 flex-wrap，
            宽屏下自由折成 3 行、每行长度不均，视觉上很松垮。现按语义分两组：
              第一行「核心入口」：主页 / 用户中心 / 收藏 / 热门 / 简报
              第二行「探索与工具」：图谱 / 算法实验室 / 短剧 / 标签 / 站点目录 /
                                    合集 / 模块化 / 插件市场 / 视频 / 投稿 / 导入
            每组内部用 gap 而非分隔符排布，左对齐、统一基线。 */}
        <nav aria-label="页脚导航" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:items-start">
          <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 md:justify-start">
            <li><Link href="/" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">主页</Link></li>
            <li><Link href="/me" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">用户中心</Link></li>
            <li><Link href="/me" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">设为首页领 +{HOMEPAGE_CLAIM_XP} 经验</Link></li>
            <li><Link href="/favorites" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">我的收藏 (E2EE)</Link></li>
            <li><Link href="/hot" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">趋势榜单</Link></li>
            <li><Link href="/brief" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">今日简报</Link></li>
          </ul>
          <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 md:justify-start">
            <li><Link href="/similar" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">相似网站发现</Link></li>
            <li><Link href="/graph" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">技术生态图谱</Link></li>
            <li><Link href="/algorithms" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">前沿算法实验室<span className="ml-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">Lab</span></Link></li>
            <li><Link href="/drama" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">短剧专区</Link></li>
            <li><Link href="/tags" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">标签云</Link></li>
            <li><Link href="/sites" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">站点目录</Link></li>
            <li><Link href="/collections" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">精选合集</Link></li>
            <li><Link href="/custom" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">模块化工作台<span className="ml-1 rounded-full border border-success/20 bg-success/10 px-1.5 py-px text-[10px] font-semibold text-success-foreground">DIY</span></Link></li>
            <li><Link href="/marketplace" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 font-medium text-primary transition-colors hover:text-foreground">插件市场</Link></li>
            <li><Link href="/videos" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">视频资源墙</Link></li>
            <li><Link href="/submit" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">网站投稿</Link></li>
            <li><Link href="/import" className="inline-flex min-h-9 items-center rounded-md px-2.5 py-1.5 transition-colors hover:text-foreground">导入书签</Link></li>
          </ul>
        </nav>
        {/* 2026-11-21 修右侧悬浮挂件遮挡版权：
            本块在 md 起右对齐、贴容器右缘，而小猫猫挂件固定在
            right:24px / bottom:24px。1024×768 实测挂件左下角 (958,608)
            与版权文字「山羊胡网址导航大全」右端 (1008,657) 相交，正好压住
            「大全」二字；1280/1440 只是侥幸没撞上，用户一拖动猫就会再撞。
            这里给右缘留出挂件宽度 + 呼吸位（约 96px），仅在 ≥md 生效
            （窄屏页脚是居中单列，不贴右缘，无需避让）。 */}
        <div className="flex min-w-0 flex-col items-center gap-1 md:min-w-[18rem] md:shrink-0 md:items-end md:pr-24 lg:pr-28">
          {/* 2026-11-21 品牌版权区改两行结构。
              原实现把「© 年份 品牌名 · AI-Native Cognitive Navigation」塞进一个 <p>，
              宽屏下容器宽度不足时被自动折行，正好把品牌名劈成「山羊胡网址导航」
              与「大全」两段（汉字可在任意字间断行），观感很生硬。
              现在拆成两个独立行：品牌名整行 whitespace-nowrap 保证不被劈开，
              英文副标题独立成行、浅灰等宽小字——信息层级也更清楚。 */}
          <p className="whitespace-nowrap text-center text-xs text-muted-foreground md:text-right">
            &copy; <span suppressHydrationWarning>{currentYear}</span> {title}
          </p>
          <p className="whitespace-nowrap text-center font-mono text-[11px] text-muted-foreground md:text-right">
            AI-Native Cognitive Navigation
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
              className="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {icp}
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}
