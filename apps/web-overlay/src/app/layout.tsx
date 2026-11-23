import "@/styles/globals.css"
// 必须排在 globals.css 之后：同优先级下按加载顺序取胜，这样减弱动态效果的规则才能覆盖动效定义
import "@/styles/reduced-motion.css"
import "@/styles/skip-link.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { UndoBar } from "@/components/undo-bar"
import { Providers } from '@/components/providers'
// 首屏瘦身 Step 5：六件后台能力件改走客户端挂载壳（ssr:false 动态加载），
// JSX 与挂载位置不动；普通 dynamic 在 Server Component 里不挪字节（已实测）。
import {
  InstallPrompt,
  OfflineBanner,
  PwaRegister,
  SessionSync,
  UserPrefsSync,
  WebVitalsReporter,
} from '@/components/shell-background'
import MobileNav from '@/components/mobile-nav'
import { GlobalFloatingDock } from '@/components/global-floating-dock'
import { Suspense } from 'react'
import { GrowthTracker } from '@/components/growth/growth-tracker'
// 横幅改走客户端动态边界（第 75 轮第二小刀）：根 layout 是 Server
// Component，next/dynamic 不能直接写在这里（不切 chunk；ssr: false
// 更是构建错误），故 import 指向 'use client' 包装 homepage-banner-lazy；
// 渲染点与位置不变，见 homepage-banner-top-guard。
import { DENSITY_PREPAINT_SCRIPT } from '@/lib/density-bootstrap'
import { FONT_SIZE_PREPAINT_SCRIPT } from '@/lib/font-size'
import { ELDER_MODE_PREPAINT_SCRIPT } from '@/lib/elder-mode'
import { HIGH_CONTRAST_PREPAINT_SCRIPT } from '@/lib/high-contrast'
import { readSiteSettings } from '@/lib/site-config-source'
import { isAnnouncementVisible, resolveDefaultTheme } from '@/lib/site-settings'
import { AnnouncementBar } from '@/components/announcement-bar'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { DEFAULT_OG_IMAGE, normalizeBrandName } from '@/lib/seo/metadata'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
/**
 * 字体配置：优雅回退至原生跨平台系统字体栈，解耦构建期对外部 Google Fonts 网络的脆弱依赖，
 * 避免因外部网络环境对 fonts.googleapis.com 的 TLS 握手断开导致构建挂起或失败。
 */
const inter = {
  variable: '',
}

/**
 * NavHub 改动：站点名改为读取中枢的站点配置。
 *
 * 上游在这里硬编码了 'NavSphere'，导致所有子页面的 <title> 都被追加 " - NavSphere"，
 * 与中枢里的品牌名（NavHub 导航）不一致 —— 用户看到的是两个品牌混在一起。
 * 改成从站点配置读取后，标题里的品牌名与后台配置保持单一来源。
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await readSiteSettings();
  const siteName = normalizeBrandName(settings.basic.title);
  const shareImage = settings.basic.ogImage;
  // canonical / OG 相对地址的解析基准。
  //
  // 这里刻意用 configuredSiteOrigin()（只读 NAVHUB_SITE_URL，绝不碰 headers()）
  // 而不是 siteOrigin()：根布局的 generateMetadata 参与每一条路由的解析，
  // 它一旦读 headers()，`/sites` 这类**没有动态段**的收录页就在构建期被判成
  // ƒ（每次请求现渲），`revalidate` 全废 —— 而 Docker 的 `pnpm build` 阶段拿不到
  // NAVHUB_SITE_URL（它在运行时才注入，见 docker/Dockerfile.web 与 compose）。
  //
  // 代价：构建期没有 origin 时 metadataBase 缺席，首份快照的 og:url 是相对地址，
  // 运行时后台 revalidate 读得到配置，绝对地址在一个周期内自愈。
  // og:image 不参与这个自愈窗口：Next 会拿 metadataBase 的兜底值
  // `http://localhost:3000` 把它绝对化，于是分享图被烤成别人机器上的地址，
  // 且 `revalidate=false` 的静态路由永远不会重生成（实测 /algorithms）。
  // 所以下面缺 origin 时直接不输出图。
  // 生产部署仍必须注入 NAVHUB_SITE_URL（否则永远是相对地址，分享卡质量下降）。
  const origin = configuredSiteOrigin();
  // 后台配了「默认分享大图」就用它，没配回退构建期内置图；两者都只在有 origin 时输出
  const shareImageCard = shareImage
    ? { url: shareImage, alt: siteName }
    : { ...DEFAULT_OG_IMAGE, alt: siteName };

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: {
      default: siteName,
      template: '%s - ' + siteName,
    },
    description: 'AI 原生的网址导航',
    openGraph: {
      type: 'website',
      siteName,
      locale: 'zh_CN',
      // 1200×630 大图卡：512 方图只能进 summary 小卡，分享预览面积不足
      // 缺 origin 时不输出（见上方注释）：相对地址会被 Next 绝对化成 localhost:3000。
      ...(origin ? { images: [shareImageCard] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      ...(origin ? { images: [{ url: shareImage ?? DEFAULT_OG_IMAGE.url, alt: siteName }] } : {}),
    },
    // PWA：manifest 由 app/manifest.ts 自动注入
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      // 原来是硬编码 '山羊胡'：后台改品牌名后 iOS「添加到主屏幕」仍是旧名
      title: siteName,
    },
    icons: {
      // 后台配了 favicon 就用它，否则回退 PWA icon-192。public/favicon.ico 也已补齐，
      // 浏览器直请 /favicon.ico 不再 404（旧注释「没有 favicon.ico」已过时）。
      icon: settings.appearance.favicon || '/icons/icon-192.png',
      apple: settings.appearance.appleTouchIcon || '/icons/apple-touch-icon.png',
    },
  };
}

/** PWA 主题色（与 manifest.theme_color 一致；Next 15 的 viewport 导出） */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-visual',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#090d16' },
  ],
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 站点设置里两个「以前能存不能生效」的字段：默认主题与链接打开方式。
  // generateMetadata 已经读同一份配置（进程内 2.5s 缓存 + Next Data Cache），
  // 这里不会多打一次中枢。
  const settings = await readSiteSettings()
  // 注入给客户端消费方（页脚 / 超级控制台）的视图：品牌名在这里收敛一次，
  // 客户端组件不必再 import 服务端的 seo 模块。
  const siteView = {
    brand: normalizeBrandName(settings.basic.title),
    linkTarget: settings.navigation.linkTarget,
    externalLinkRel: settings.navigation.externalLinkRel,
    footerText: settings.footer?.text,
    icp: settings.footer?.icp,
  }
  // 安全：GA_ID 会内插进 dangerouslySetInnerHTML 与 script src，必须白名单。
  // 非法值（如攻击者通过环境注入 `"'><script>`）直接不注入，避免存储型 XSS。
  const rawGaId = process.env.GA_ID
  const safeGaId = rawGaId && /^G-[A-Z0-9]+$/.test(rawGaId) ? rawGaId : null
  const gaId = safeGaId

  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth" className={inter.variable}>
      <head>
        {/* 水合前把用户存的卡片密度写进 <html data-density>：密度变量决定整片网格的间距，
            等 DensityProvider 的 effect 再落就变成「先按默认档画一屏、水合后集体重排」。
            必须排在 head 最前，样式表之前。 */}
        <script id="density-prepaint" dangerouslySetInnerHTML={{ __html: DENSITY_PREPAINT_SCRIPT }} />
        {/* 水合前把用户存的字号档位写进 <html> font-size：与密度同理，防大字用户首屏闪烁重排 */}
        <script id="font-size-prepaint" dangerouslySetInnerHTML={{ __html: FONT_SIZE_PREPAINT_SCRIPT }} />
        {/* 长辈模式：开启时在字号脚本之后覆盖为特大字 + data-elder-mode（宽松间距与触控目标见 globals.css），顺序不能反 */}
        <script id="elder-mode-prepaint" dangerouslySetInnerHTML={{ __html: ELDER_MODE_PREPAINT_SCRIPT }} />
        {/* 高对比：开启时落 <html data-high-contrast="on">（颜色 token 覆盖见 globals.css），与长辈模式正交可叠加；防首屏闪烁 */}
        <script id="high-contrast-prepaint" dangerouslySetInnerHTML={{ __html: HIGH_CONTRAST_PREPAINT_SCRIPT }} />
        {/* 浏览器插件隔离护盾：阻断宿主浏览器第三方插件（如 QoderWork 等）产生的无害通讯断开报错 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window === 'undefined') return;
                function isExtensionError(err) {
                  var m = (err && (err.message || err.reason || err)) || '';
                  if (typeof m !== 'string') return false;
                  return m.indexOf('Could not establish connection') !== -1 ||
                         m.indexOf('Receiving end does not exist') !== -1 ||
                         m.indexOf('message channel closed') !== -1 ||
                         m.indexOf('Extension context invalidated') !== -1;
                }
                window.addEventListener('unhandledrejection', function(e) {
                  if (e && isExtensionError(e.reason)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                  }
                }, true);
                window.addEventListener('error', function(e) {
                  if (e && (isExtensionError(e.message) || isExtensionError(e.error))) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return true;
                  }
                }, true);

                // 首屏防闪烁（Anti-FOUC）：在 React Hydration 之前同步读取已删减的模块/分类掩码并挂载到 <html>
                try {
                  var prunedRaw = window.localStorage.getItem('nav_pruned_ids');
                  if (prunedRaw) {
                    var pruned = JSON.parse(prunedRaw);
                    if (Array.isArray(pruned) && pruned.length > 0) {
                      document.documentElement.setAttribute('data-pruned', pruned.join(' '));
                    }
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* P2-12：本地开发环境旧 SW 与 CacheStorage 清理移出首屏阻塞脚本（原在隔离盾内，
            801B、仅 localhost/127.0.0.1 生效、生产是死代码）。改走 afterInteractive，
            水合后执行即可——清理针对的是历史缓存，不影响当前帧渲染。错误监听与
            Anti-FOUC 读取仍留首屏同步脚本（必须在水合/插件注入前生效）。 */}
        <Script
          id="dev-sw-cache-cleanup"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window === 'undefined') return;
                if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return;
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    for (var i = 0; i < regs.length; i++) regs[i].unregister();
                  }).catch(function() {});
                }
                if ('caches' in window) {
                  caches.keys().then(function(keys) {
                    for (var j = 0; j < keys.length; j++) caches.delete(keys[j]);
                  }).catch(function() {});
                }
              })();
            `,
          }}
        />
        {/* iOS 桌面图标（apple-touch-icon）：用显式 link 而不是 metadata.icons.apple——
            实测 Next 15.5 只渲染 appleWebApp 的 meta 而不渲染该 link */}
        <link rel="apple-touch-icon" href={settings.appearance.appleTouchIcon || '/icons/apple-touch-icon.png'} />
        {/* Google Analytics */}
        {gaId && (
          <>
            {/* preconnect 只在 GA 真正启用时建立：未配置 GA_ID 的部署不该为每个访客
                多开一条到 googletagmanager.com 的 DNS/TLS 连接（隐私 + 首屏开销）。 */}
            <link rel="preconnect" href="https://www.googletagmanager.com" />
            <Script
              strategy="afterInteractive"
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            />
            <Script
              id="google-analytics"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${gaId}');
                `,
              }}
            />
          </>
        )}
      </head>
      <body suppressHydrationWarning>
        {/* WCAG 2.4.1 Bypass Blocks：键盘与读屏用户不必逐个 Tab 穿过整条导航才能到主体内容。
            锚点 #main-content 由各页面的主内容地标提供（Container as="main" 或页面自带的 <main>），
            样式在 styles/skip-link.css —— 默认不可见，聚焦后出现在左上角。 */}
        <a href="#main-content" className="skip-to-content">
          跳到主要内容
        </a>
        {/* 全站公告（后台站点设置控制：开关 + 定时窗口在此判断，关/未到/过期都不渲染） */}
        {isAnnouncementVisible(settings) ? (
          <AnnouncementBar announcement={settings.announcement} />
        ) : null}
        {/* 登录后把会话身份同步到用户中心，并合并本机匿名数据（幂等） */}
        <SessionSync />
        <PwaRegister />
        <InstallPrompt />
        {/* RUM：NEXT_PUBLIC_RUM=1 时采集 LCP/INP/CLS/TTFB，默认关闭 */}
        <WebVitalsReporter />
        <ThemeProvider
          attribute="class"
          defaultTheme={resolveDefaultTheme(settings)}
          enableSystem
          disableTransitionOnChange
        >
          {/* 首页顶部「设为首页」引导条：必须在 {children} 之前渲染。
              原先挂在 ThemeProvider 末尾，落在文档底部、页脚之后，用户
              基本看不到（2026-11-15 第 72 轮核实）。组件自身只在 `/`
              且未关闭、未领取时渲染，非首页恒为 null，放这里不影响
              其他路由；它不依赖 Providers 上下文，移动无依赖风险。 */}
          <Providers site={siteView}>
            {children}
          </Providers>
          {/* 账号级偏好落地：登录后把云端主题/首页模块隐藏同步到本机运行时 */}
          <UserPrefsSync />
          {/* 移动端底部导航（sm 以下可见；footer 已预留安全区，勿再加负 margin） */}
          <MobileNav />
          {/* 网络状态提示：全站可见。离线时告诉用户「是你的网络断了，不是站点没数据」 */}
          <OfflineBanner />
          <Toaster />
          {/* 全局撤销条（8 秒内存撤销的唯一出口，不复用 toast：见 components/undo-bar.tsx） */}
          <UndoBar />
          {/* 小猫猫 AI 助手挂件 v7：右下角悬浮小猫（public/xiaomaomao/xiaomaomao.js，头像真图多姿势 + 聊天找站 + 摸猫/喂鱼/接星星/成长联动/语音输入；v6：深色整套图自动切换 + 庆祝视频钩子（media 文件就位即生效）+ 拖动补强（触摸/真尺寸钳制）+ 闲时贴边吸附（安全内边距） + 用户自改形象（图库/上传，本机保存）；v7：猫自身控件平时零遮挡——控件收进猫上方悬浮坞、悬停/轻点才唤出、闲置 3 秒自动收起，全套 UI 图标换手工 SVG；640–1024px 区间猫默认抬到半屏下沉栏之上（见 xiaomaomao.js 内媒体规则，栏高 56px + 呼吸位），拖动过的猫以用户自选位置为准、可能再盖住底栏） */}
          {/* 2026-11-21 统一右下角浮坞：回顶按钮由 React 侧渲染，
              小猫挂件由下面的脚本自绘（已在 CSS 里对齐同一套 right/bottom/z 值）。 */}
          <GlobalFloatingDock />
          {settings.features.xiaomaomao ? (
            <Script src="/xiaomaomao/xiaomaomao.js" strategy="lazyOnload" />
          ) : null}
          {/* 成长档案感知层（挂机/路由/点击计数，无可见 UI）。
              GrowthTracker 用了 useSearchParams，必须包 Suspense，否则静态生成
              /404 时报 missing-suspense-with-csr-bailout（2026-11-10 构建实测）。
              首页「设为首页」引导条已移到 {children} 之前（见上），不在此处。 */}
          <Suspense fallback={null}>
            <GrowthTracker />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  )
}
