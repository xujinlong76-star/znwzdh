'use client'

/**
 * 对照页壳（Batch 4 Phase 1 第 2 项）。
 *
 * 只做三件事：读 `searchParams.siteIds`、校验 2–4 个、懒加载对照表。
 * 对照表组件用 `next/dynamic` + `{ ssr: false }`（照抄
 * `app/favorites/page.tsx:124-150` 的范式），不进 `/compare` 首屏 chunk。
 * 取数与渲染全在 `components/compare-view.tsx`；元信息（noindex）在
 * `app/compare/layout.tsx`（客户端组件无法导出 metadata）。
 */

import { Suspense } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { parseCompareSiteIds, validateCompareSiteIds } from '@/lib/compare'

const CompareView = dynamic(
  () => import('@/components/compare-view').then((m) => m.CompareView),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">正在加载对照表…</p>,
  },
)

/** 快照面板同款懒加载（Batch 4 Phase 2 P2-3）：保存/历史/diff，不进首屏 chunk。 */
const SnapshotPanel = dynamic(
  () => import('@/components/snapshot-panel').then((m) => m.SnapshotPanel),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">正在加载快照面板…</p>,
  },
)

function ComparePageBody() {
  const searchParams = useSearchParams()
  const siteIds = parseCompareSiteIds(searchParams.get('siteIds'))
  const validated = validateCompareSiteIds(siteIds)

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 max-w-6xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">横向对比</h1>
          <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
            并排对照我收藏的同类站点：只比能验证的硬字段，每个格子带来源与日期，缺失写“未验证”；不排名、不打分。
          </p>
        </header>

        {!validated.ok ? (
          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">还不能开始对比</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{validated.error}</p>
            <div>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href="/favorites">去收藏夹勾选 2–4 个站点</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <CompareView siteIds={validated.siteIds} />
            <SnapshotPanel siteIds={validated.siteIds} />
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground px-4 py-6">正在加载对照页…</p>}>
      <ComparePageBody />
    </Suspense>
  )
}
