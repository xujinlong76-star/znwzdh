import "@/styles/globals.css"
import { cn } from "@/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { ThemeToggle } from '@/components/theme-toggle'
import { Providers } from '@/components/providers'
import { PwaRegister } from '@/components/pwa-register'
import { getFileContent } from '@/lib/github'
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
  const siteName = site?.basic?.title ?? 'NavHub';

  return {
    title: {
      default: siteName,
      template: '%s - ' + siteName,
    },
    description: 'AI 原生的网址导航',
    // PWA：manifest 由 app/manifest.ts 自动注入
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'NavHub',
    },
    icons: {
      icon: site?.appearance?.favicon ?? '/favicon.ico',
    },
  };
}

/** PWA 主题色（与 manifest.theme_color 一致；Next 15 的 viewport 导出） */
export const viewport: Viewport = {
  themeColor: '#378ADD',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gaId = process.env.GA_ID

  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth" className={inter.variable}>
      <head>
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
        <PwaRegister />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            {children}
          </Providers>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
