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
import { AnonymousHintInline } from '@/components/user-center/anonymous-hint'
import { SectionState } from '@/components/user-center/section-state'
import { useMeOverview } from '@/hooks/use-me-overview'
import { ArrowRight, LayoutGrid, Package, PackageCheck, Send, Sparkles, Star } from 'lucide-react'

export function MePluginsView() {
  const { state, overview, error, reload } = useMeOverview()

  const counts = overview?.counts
  // 卡片语言与概览统计卡一致：专属色相芯片 + 悬浮微抬升；投稿是行动入口而非计数，
  // 用 cta 文案占住数字位，避免四张卡出现“缺一角”的节奏断层
  const cards: Array<{
    href: string
    title: string
    hint: string
    icon: typeof PackageCheck
    count: number | undefined
    chip: string
    cta?: string
  }> = [
    {
      href: '/marketplace/installed',
      title: '已安装插件',
      hint: '主题、搜索包、网址包；升级与卸载',
      icon: PackageCheck,
      count: counts?.activePluginInstalls,
      chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    },
    {
      href: '/marketplace/mine',
      title: '我发布的插件',
      hint: '版本、审核状态与更新',
      icon: Sparkles,
      count: counts?.authoredPlugins,
      chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
    {
      href: '/marketplace',
      title: '星标插件',
      hint: '在插件市场里查看已星标内容',
      icon: Star,
      count: counts?.pluginStars,
      chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    },
    {
      href: '/submit',
      title: '投稿新站点 / 插件',
      hint: '提交后进入审核队列',
      icon: Send,
      count: undefined,
      chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      cta: '立即投稿',
    },
  ]

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
            <AnonymousHintInline>
              当前是匿名身份：插件安装记录保存在本机，登录后自动同步到云端。下方计数按 0 展示。
            </AnonymousHintInline>
          )}

          <section aria-label="插件入口" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cards.map(({ href, title, hint, icon: Icon, count, chip, ...rest }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md dark:hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}>
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="truncate text-sm font-medium">{title}</span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-border transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
                {typeof count === 'number' ? (
                  <p className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{count}</p>
                ) : (
                  <p className="text-xs font-medium text-primary">
                    {rest.cta}
                    <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">→</span>
                  </p>
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
