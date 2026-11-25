import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { SimilarHubClient } from '@/components/similar-hub-client'
import { pageShareMetadata } from '@/lib/seo/metadata'

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>
}): Promise<Metadata> {
  const sp = searchParams ? await searchParams : {}
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q
  const q = typeof rawQ === 'string' ? rawQ.trim().slice(0, 60) : ''

  // 注意：根 layout 已配 title.template = '%s - 山羊胡网址导航大全'，此处不再重复拼接站名后缀
  const title = q ? `与 ${q} 最相似的网站与平替` : '相似网站发现与竞品平替分析'
  const description = q
    ? `基于标签特异性、BGE 语义向量、分类亲缘与图谱受众 5 大维度，为你实时挖掘与「${q}」最相似的网站与高质量平替方案。`
    : '输入任意网址、域名或网站名称，融合标签特异性、语义内容、分类亲缘、产品属性与图谱受众 5 大维度，秒级发现最相似的替代网站。'

  return {
    title,
    description,
    ...pageShareMetadata({
      title,
      description,
      url: q ? `/similar?q=${encodeURIComponent(q)}` : '/similar',
    }),
  }
}

export default function SimilarSitesPage() {
  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-6">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '相似网站发现', path: '/similar' },
          ]}
        />
        <Suspense
          fallback={
            <div className="h-64 rounded-3xl border border-border/70 bg-card/50 animate-pulse" />
          }
        >
          <SimilarHubClient />
        </Suspense>
      </div>
      <Footer />
    </Container>
  )
}
