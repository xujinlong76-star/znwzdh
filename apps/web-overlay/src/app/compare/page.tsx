'use client'

/**
 * 对照页壳（Batch 4 Phase 1 第 2 项）。
 *
 * 只做三件事：读 `searchParams.siteIds`、校验 2–4 个、懒加载对照表。
 * 对照表组件用 `next/dynamic` + `{ ssr: false }`（照抄
 * `app/favorites/page.tsx:124-150` 的范式），不进 `/compare` 首屏 chunk。
 * 取数与渲染全在 `components/compare-view.tsx`；元信息（noindex）在
 * `app/compare/layout.tsx`（客户端组件无法导出 metadata）。
 * 另：匿名用户不进对照表——`useIdentityReady` 就绪后若未登录，先渲染
 * 登录提示面板（附回跳链接），不等 `CompareView` 取数撞 401 才报墙
 * （F-10：匿名对比的登录墙必须出现在流程早期）。
 */

import { Suspense } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { parseCompareSiteIds, validateCompareSiteIds } from '@/lib/compare'
import { useIdentityReady } from '@/hooks/useIdentityReady'

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

/** P12 对比卡 PoC：对比篮视图（篮模式只读本机 localStorage，不要求登录、不发请求）。 */
const DecisionCompareBasketView = dynamic(
  () => import('@/components/decision-compare-basket-view').then((m) => m.DecisionCompareBasketView),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">正在读取对比篮…</p>,
  },
)

function ComparePageBody() {
  const searchParams = useSearchParams()
  const siteIds = parseCompareSiteIds(searchParams.get('siteIds'))
  const validated = validateCompareSiteIds(siteIds)
  // F-10：身份未就绪前不下结论（登录用户在会话同步完成前不闪登录墙）；
  // 就绪后仍匿名则直接亮登录墙，不挂载 CompareView、不发 /api/compare。
  const identityReady = useIdentityReady()
  const isAnonymous = identityReady.ready && (!identityReady.identity || identityReady.isAnonymous)

  // P12 对比卡 PoC：篮模式（`?basket=1`）走本机对比篮，与收藏夹对照流
  // （`?siteIds=`，登录 + 收藏）是两条独立入口：篮内容只存在本机、
  // 不发请求，故不进登录墙、不校验 siteIds。
  if (searchParams.get('basket') === '1') {
    return (
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-6xl mx-auto space-y-6">
          <header className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">横向对比</h1>
            <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
              并排对照对比篮里的同类站点：只比能验证的硬字段，每个格子带来源与日期，缺失写“未验证”；不排名、不打分。
            </p>
          </header>

          <DecisionCompareBasketView />
        </div>
        <Footer />
      </Container>
    )
  }

  if (!validated.ok) {
    return (
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-6xl mx-auto space-y-6">
          <header className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">横向对比</h1>
            <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
              并排对照我收藏的同类站点：只比能验证的硬字段，每个格子带来源与日期，缺失写“未验证”；不排名、不打分。
            </p>
          </header>

          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">还不能开始对比</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{validated.error}</p>
            {isAnonymous && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                横向对比只对登录用户开放，
                <Link href="/auth/signin?callbackUrl=%2Ffavorites" className="text-primary underline underline-offset-2">
                  请先登录
                </Link>
                后再去收藏夹勾选站点。
              </p>
            )}
            <div>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href="/favorites">去收藏夹勾选 2–4 个站点</Link>
              </Button>
            </div>
          </div>
        </div>
        <Footer />
      </Container>
    )
  }

  if (!identityReady.ready) {
    return (
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-6xl mx-auto space-y-6">
          <header className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">横向对比</h1>
            <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
              并排对照我收藏的同类站点：只比能验证的硬字段，每个格子带来源与日期，缺失写“未验证”；不排名、不打分。
            </p>
          </header>
          <p className="text-sm text-muted-foreground">正在加载对照表…</p>
        </div>
        <Footer />
      </Container>
    )
  }

  if (isAnonymous) {
    const callbackUrl = encodeURIComponent(`/compare?siteIds=${validated.siteIds.join(',')}`)
    return (
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-6xl mx-auto space-y-6">
          <header className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">横向对比</h1>
            <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
              并排对照我收藏的同类站点：只比能验证的硬字段，每个格子带来源与日期，缺失写“未验证”；不排名、不打分。
            </p>
          </header>

          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">横向对比需要登录</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              横向对比只对登录用户开放，请先登录后再查看。登录后会直接回到这次对比。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="h-8 text-xs">
                <Link href={`/auth/signin?callbackUrl=${callbackUrl}`}>去登录</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href="/favorites">返回收藏夹</Link>
              </Button>
            </div>
          </div>
        </div>
        <Footer />
      </Container>
    )
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 max-w-6xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">横向对比</h1>
          <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
            并排对照我收藏的同类站点：只比能验证的硬字段，每个格子带来源与日期，缺失写“未验证”；不排名、不打分。
          </p>
        </header>

        <CompareView siteIds={validated.siteIds} />
        <SnapshotPanel siteIds={validated.siteIds} />
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
