import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AdminLayoutClient } from './AdminLayoutClient'
import { Toaster } from "@/registry/new-york/ui/toaster"
import { Metadata } from 'next'

export const metadata: Metadata = {
  // 管理后台的标题用**嵌套模板**：子页面只写自己的名字（如「审计日志」），
  // 这里拼「· 管理后台」，最外层再由根 layout 追加站点名。
  // 原来的 'NavSphere Admin' 既和站点品牌（NavHub）不一致，又让十几个后台页面共用一个标题。
  title: {
    default: '管理后台',
    template: '%s · 管理后台',
  },
  description: '管理后台：站点、分类、标签、资源、审计与运维',
  icons: {
    icon: '/assets/images/favicon.webp',
    shortcut: '/assets/images/favicon.webp',
    apple: '/assets/images/favicon.webp',
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

  return (
    <>
      <AdminLayoutClient
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