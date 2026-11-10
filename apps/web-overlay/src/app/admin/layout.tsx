import { redirect } from 'next/navigation'
import NextAuth from 'next-auth'
import { authConfig, authSecret } from '@/lib/auth.config'
import { AdminLayoutClient } from './AdminLayoutClient'
import { Toaster } from "@/registry/new-york/ui/toaster"
import { readSiteSettings } from '@/lib/site-config-source'
import { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  // 后台标签页图标原来写死上游的 /assets/images/favicon.webp：
  // 管理员在站点设置里换了 favicon，前台变了、后台还是上游那张，看起来像「设置没生效」。
  const settings = await readSiteSettings()
  const icon = settings.appearance.favicon || '/icons/icon-192.png'
  return {
    // 管理后台的标题用**嵌套模板**：子页面只写自己的名字（如「审计日志」），
    // 这里拼「· 管理后台」，最外层再由根 layout 追加站点名。
    // 原来的 'NavSphere Admin' 既和站点品牌（NavHub）不一致，又让十几个后台页面共用一个标题。
    title: {
      default: '管理后台',
      template: '%s · 管理后台',
    },
    description: '管理后台：站点、分类、标签、资源、审计与运维',
    // 后台必须自行退出索引（2026-11-06 深扫 F-4）。
    // robots.ts 只写了 `Disallow: /admin`，而按爬虫规范 Disallow 只阻止抓取、
    // **不阻止收录**：如果 URL 从外部被链接过，仍可能以「无 description 的空结果」
    // 出现在 SERP。必须同时下发 noindex。项目内 auth / me / favorites / preferences
    // 四个 layout 都已有这一行，这里是遗漏（22 个后台页共用一个 layout）。
    robots: { index: false, follow: true },
    icons: {
      icon,
      shortcut: icon,
      apple: settings.appearance.appleTouchIcon || '/icons/apple-touch-icon.png',
    }
  }
}

/**
 * 会话读取走 edge 安全的分离配置（auth.config），不引 @/lib/auth 全量模块：
 * 后者静态 import node:crypto（服务端令牌加密），而 /admin 下多个底座页面
 * 声明 runtime='edge'，页面运行时会把同段 layout 一起编译到 edge，
 * 静态加载 node:crypto 直接让生产构建在 Collecting page data 阶段失败
 * （2026-11-10 实测卡在 /admin/navigation/[id]/items）。读已有会话 Cookie
 * 只需要 callbacks + secret，不需要 providers 与令牌仓——这是 NextAuth
 * 官方的 edge 分离模式，proxy.ts 已同款用法。
 */
const { auth } = NextAuth({ ...authConfig, secret: authSecret })

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/auth/signin')
  }

  // 后台侧边栏 logo 走站点设置（与前台、manifest、后台 favicon 同一口径）；
  // 没配品牌图时回退内置图，避免后台回到「上传了 logo 但后台还是上游图」的观感。
  const settings = await readSiteSettings()

  return (
    <>
      <AdminLayoutClient
        brandLogo={settings.appearance.logo || '/assets/images/alogo.webp'}
        user={{
          name: session.user.name,
          email: session.user.email,
          image: session.user.image
        }}
      >
        {children}
      </AdminLayoutClient>
      <Toaster />
    </>
  )
}