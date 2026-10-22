import { Container } from '@/components/ui/container'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { safeDecodeParam } from '@/lib/server/route-params'

/**
 * 作者页只挂服务端面包屑；title/description/canonical 由 page.tsx 提供。
 * 旧的静态 title 会让所有作者共享同一个标题，已移除。
 */
export default async function MarketplaceAuthorLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ key: string }>
}) {
  const { key } = await params
  const safeKey = safeDecodeParam(key)
  return (
    <>
      <Container className="pt-4">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '插件市场', path: '/marketplace' },
            ...(safeKey
              ? [{ label: '作者主页', path: `/marketplace/author/${encodeURIComponent(safeKey)}` }]
              : []),
          ]}
        />
      </Container>
      {children}
    </>
  )
}
