import Link from 'next/link'
import { ArrowRight, Flame } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { formatHotValue, loadBriefToday } from '@/lib/server/brief'

/**
 * 首页「今日简报」紧凑条（服务端渲染）。
 *
 * 只放三样真实内容：小猫猫开场白、各源第 1 名、一句新收录提示，
 * 全部来自中枢按天组版的简报缓存；取不到或全空时整条不渲染，
 * 不让首页为一个模块开天窗或放占位假数据。完整版在 /brief。
 */
export async function HomeBriefStrip() {
  const brief = await loadBriefToday(300)
  if (!brief) return null
  const firsts = [...new Map(brief.hotPicks.map((p) => [p.source, p])).values()].slice(0, 5)
  if (firsts.length === 0 && brief.newSites.length === 0) return null

  return (
    <section aria-label="今日简报" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-primary/10 via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Flame className="h-4 w-4 text-orange-500" aria-hidden />
            今日简报 · {brief.date.slice(5)}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{brief.opening}</p>
          <Link href="/brief" className="inline-flex min-h-6 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
            看完整简报 <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {firsts.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {firsts.map((pick) => {
              const hot = formatHotValue(pick.hotValue)
              return (
                <li key={pick.source} className="inline-flex min-h-6 min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-medium text-foreground/70">{pick.sourceName}</span>
                  <a
                    href={safeHref(pick.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-56 truncate hover:text-primary"
                  >
                    {pick.title}
                  </a>
                  {hot ? <span className="shrink-0">{hot}</span> : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
