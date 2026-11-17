import Link from 'next/link'
import type { HubPluginItem } from '@/lib/navhub-api'
import {
  MARKETPLACE_CATEGORIES_PATH,
  MARKETPLACE_KIND_LABELS,
} from '@/lib/plugins/marketplace-categories'

/**
 * 首页插件精选区（P2-12，2026-11-17）。
 *
 * 此前首页 page.tsx 零 marketplace/plugin 命中，插件市场只藏在全局工具栏
 * 下拉与页脚里。本区放在 HomeTodayZone 之后、导航内容之前：标题 + 两条
 * 常驻入口（进入市场 / 按分类浏览）+ 至多 6 个精选插件直链。
 *
 * 服务端组件、无 JS：精选取不到（中枢抖动）时不编假插件名，只留入口与
 * 一句如实说明——空精选不是空市场。
 */
export function HomePluginSpotlight({ items }: { items: HubPluginItem[] | null }) {
  const featured = (items ?? []).slice(0, 6)
  return (
    <section
      data-testid="home-plugin-spotlight"
      aria-label="插件市场精选"
      className="mx-auto w-full max-w-7xl px-3 sm:px-4 pt-4"
    >
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">插件市场精选</h2>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Link href="/marketplace" className="text-primary hover:underline">
              进入插件市场 →
            </Link>
            <Link href={MARKETPLACE_CATEGORIES_PATH} className="text-primary hover:underline">
              按分类浏览 →
            </Link>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          声明式网址包、工作台预设与主题扩展，一键装进你的导航——无可执行代码，只改配置。
        </p>
        {featured.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {featured.map((plugin) => (
              <li key={plugin.id}>
                <Link
                  href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/70 bg-background text-xs text-foreground hover:text-primary hover:border-primary/40 transition-colors"
                >
                  <span>{plugin.name}</span>
                  <span className="text-muted-foreground">· {MARKETPLACE_KIND_LABELS[plugin.kind]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground" role="status">
            精选暂时不可用，先去分类页逛逛。
          </p>
        )}
      </div>
    </section>
  )
}
