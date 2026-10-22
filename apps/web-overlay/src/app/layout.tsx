import "@/styles/globals.css"
// 必须排在 globals.css 之后：同优先级下按加载顺序取胜，这样减弱动态效果的规则才能覆盖动效定义
import "@/styles/reduced-motion.css"
import "@/styles/skip-link.css"
import { cn } from "@/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { ThemeToggle } from '@/components/theme-toggle'
import { Providers } from '@/components/providers'
import { PwaRegister } from '@/components/pwa-register'
import { InstallPrompt } from '@/components/install-prompt'
import { WebVitalsReporter } from '@/components/web-vitals-reporter'
import { OfflineBanner } from '@/components/offline-banner'
import MobileNav from '@/components/mobile-nav'
import { SessionSync } from '@/components/user-center/session-sync'
import { getFileContent } from '@/lib/github'
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

/** 与页面层保持一致的路径常量 */
const SITE_PATH = 'src/navsphere/content/site.json'

/**
 * NavHub 改动：站点名改为读取中枢的站点配置。
 *
 * 上游在这里硬编码了 'NavSphere'，导致所有子页面的 <title> 都被追加 " - NavSphere"，
 * 与中枢里的品牌名（NavHub 导航）不一致 —— 用户看到的是两个品牌混在一起。
 * 改成从 getFileContent 读取后，标题里的品牌名与后台配置保持单一来源。
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getFileContent<{ basic?: { title?: string }; appearance?: { favicon?: string } }>(SITE_PATH);
  const siteName = normalizeBrandName(site?.basic?.title);
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
      ...(origin ? { images: [{ ...DEFAULT_OG_IMAGE, alt: siteName }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      ...(origin ? { images: [{ url: DEFAULT_OG_IMAGE.url, alt: siteName }] } : {}),
    },
    // PWA：manifest 由 app/manifest.ts 自动注入
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'NavHub',
    },
    icons: {
      // 默认指向真实存在的 PWA 图标：public/ 下没有 favicon.ico（曾 404 刷屏），用 icon-192 兜底
      icon: site?.appearance?.favicon ?? '/icons/icon-192.png',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 安全：GA_ID 会内插进 dangerouslySetInnerHTML 与 script src，必须白名单。
  // 非法值（如攻击者通过环境注入 `"'><script>`）直接不注入，避免存储型 XSS。
  const rawGaId = process.env.GA_ID
  const safeGaId = rawGaId && /^G-[A-Z0-9]+$/.test(rawGaId) ? rawGaId : null
  const gaId = safeGaId

  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth" className={inter.variable}>
      <head>
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

                // 本地开发环境自动清理旧 SW 与 CacheStorage，杜绝历史缓存导致的水合与分包不一致
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
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
                }
              })();
            `,
          }}
        />
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        {/* iOS 桌面图标（apple-touch-icon）：用显式 link 而不是 metadata.icons.apple——
            实测 Next 15.5 只渲染 appleWebApp 的 meta 而不渲染该 link */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        {/* Google Analytics */}
        {gaId && (
          <>
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
        {/* 登录后把会话身份同步到用户中心，并合并本机匿名数据（幂等） */}
        <SessionSync />
        <PwaRegister />
        <InstallPrompt />
        {/* RUM：NEXT_PUBLIC_RUM=1 时采集 LCP/INP/CLS/TTFB，默认关闭 */}
        <WebVitalsReporter />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            {children}
          </Providers>
          {/* 移动端底部导航（sm 以下可见；footer 已预留安全区，勿再加负 margin） */}
          <MobileNav />
          {/* 网络状态提示：全站可见。离线时告诉用户「是你的网络断了，不是站点没数据」 */}
          <OfflineBanner />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
