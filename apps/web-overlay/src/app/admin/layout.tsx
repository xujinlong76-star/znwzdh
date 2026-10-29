import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
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
    icons: {
      icon,
      shortcut: icon,
      apple: settings.appearance.appleTouchIcon || '/icons/apple-touch-icon.png',
    }
  }
}

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