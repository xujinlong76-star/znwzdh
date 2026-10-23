'use client'

/**
 * 「插件中心」：把散落在 /marketplace 的用户域入口收拢到用户中心。
 *
 * 数据只读 `GET /api/me` 的 counts（已装 / 星标 / 我发布），不新增接口；
 * 取数失败必须落 error + 重试，**不得把失败渲染成 0**。
 */
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/footer'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { useMeOverview } from '@/hooks/use-me-overview'
import { ArrowRight, LayoutGrid, Package, PackageCheck, Send, Sparkles, Star } from 'lucide-react'

export function MePluginsView() {
  const { state, overview, error, reload } = useMeOverview()

  const counts = overview?.counts
  const cards = [
    {
      href: '/marketplace/installed',
      title: '已安装插件',
      hint: '主题、搜索包、网址包；升级与卸载',
      icon: PackageCheck,
      count: counts?.activePluginInstalls,
    },
    {
      href: '/marketplace/mine',
      title: '我发布的插件',
      hint: '版本、审核状态与更新',
      icon: Sparkles,
      count: counts?.authoredPlugins,
    },
    {
      href: '/marketplace',
      title: '星标插件',
      hint: '在插件市场里查看已星标内容',
      icon: Star,
      count: counts?.pluginStars,
    },
    {
      href: '/submit',
      title: '投稿新站点 / 插件',
      hint: '提交后进入审核队列',
      icon: Send,
      count: undefined,
    },
  ] as const

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="插件中心"
        icon={Package}
        eyebrow="扩展"
        back={{ href: '/me', label: '用户中心' }}
        description="已安装、我发布、星标与投稿都在这里；具体管理仍在插件市场的对应页面完成。"
        actions={
          <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
            <Link href="/marketplace">前往插件市场</Link>
          </Button>
        }
      />

      {state === 'loading' && (
        <SectionState variant="loading" rows={4} rowClassName="h-28" loadingLabel="正在加载插件数据" />
      )}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="插件数据暂时取不到"
          description={error ?? '这不代表你没有安装插件——恢复后计数会回来。'}
          onRetry={() => void reload()}
        />
      )}

      {(state === 'ready' || state === 'anonymous') && (
        <>
          {state === 'anonymous' && (
            <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
              当前是匿名身份：插件安装记录保存在本机，登录后自动同步到云端。下方计数按 0 展示。
            </section>
          )}

          <section aria-label="插件入口" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cards.map(({ href, title, hint, icon: Icon, count }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate">{title}</span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
                {typeof count === 'number' && (
                  <p className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{count}</p>
                )}
              </Link>
            ))}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <LayoutGrid className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              工作台与扩展
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              首页模块化布局保存在你的金库（E2EE），换设备后可在工作台恢复。
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
                <Link href="/custom">模块化工作台</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
                <Link href="/preferences">偏好与 AI 配置</Link>
              </Button>
            </div>
          </section>
        </>
      )}

      <Footer />
    </Container>
  )
}
