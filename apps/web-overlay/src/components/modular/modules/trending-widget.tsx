'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, RefreshCw, TrendingUp, ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { fetchTrending } from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { safeHref } from '@/lib/safe-url'

/**
 * 热度榜小卡。
 *
 * 旧版有三处不诚实，而且全是用户直接看得见的：
 *  1. `s.trendScore ?? s.visitCount ?? 100` —— 两个指标都没测到时编一个 100；
 *  2. 星形图标 + `Math.round(score / 1000)k` —— 把「站内热度」画成 GitHub 星标。
 *     而 trendScore 的真实量纲是 log1p(访问) + 1.5·log1p(收藏) − 0.1·站点天数
 *     （见 packages/core/src/ranking.ts），正常落在 0~15 这个区间，除以 1000 再取整
 *     就等于**每一行都渲染成「0k」**：既不是星数，也不是任何可读的数；
 *  3. 底注写死「全网开发者实时协同偏好」——这里的数据只有本站自己的访问与收藏。
 *
 * 现在：每个指标按自己的量纲显示，缺测显示「—」，测到 0 如实说「暂无互动」，
 * 取数失败给出原因和重试，演示数据继续挂「演示数据」徽标。
 */
interface HotRow {
  id: string
  title: string
  url: string
  description?: string
  /** trendScore：对数热度指数（0~15 量级）；中枢没给就是 null */
  heat: number | null
  /** visitCount：累计访问次数；中枢没给就是 null */
  visits: number | null
}

/**
 * 兜底演示数据。
 *
 * 必须显式标注「演示数据」：以前中枢不可用时，这几条硬编码站点会以
 * 和真实榜单完全相同的样式渲染在「今日技术飙升热度榜」标题下，
 * 用户会把编造的分数当成全网事实（对比：天气 / RSS 小卡早就标了演示数据）。
 * 数值刻意与真实量纲一致（热度 0~15、访问几千），演示至少不教学期。
 */
const DEMO_SITES: HotRow[] = [
  { id: '1', title: 'Next.js 15', url: 'https://nextjs.org', description: '全栈 React 框架', heat: 12.4, visits: 12400 },
  { id: '2', title: 'Tailwind CSS v4', url: 'https://tailwindcss.com', description: '实用类优先 CSS', heat: 9.8, visits: 8200 },
  { id: '3', title: 'Vitest 3', url: 'https://vitest.dev', description: '极速下一代测试框架', heat: 7.1, visits: 4500 },
  { id: '4', title: 'Hono', url: 'https://hono.dev', description: '轻量边缘 Web 框架', heat: 5.6, visits: 2300 },
]

function numOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 热度指数：保留一位小数（量纲本来就是个位数指数，不需要 k 缩写） */
export function heatLabel(heat: number | null): string {
  return heat === null ? '—' : heat.toFixed(1)
}

/** 访问次数：万位以上缩写，其余原样；null 是「没测到」，不是 0 */
export function visitLabel(visits: number | null): string {
  if (visits === null) return '—'
  if (visits >= 10_000) return `${(visits / 1000).toFixed(1)}k`
  return String(Math.round(visits))
}

export interface RowMetric {
  kind: 'heat' | 'visits' | 'none'
  text: string
}

/**
 * 单行右侧那个数字到底该写什么。
 *
 * 优先热度指数（它才是这个榜的排序依据），其次退回访问量；
 * 两者都测到 0 说明「互动尚未发生」，与「中枢没给字段」是两件事，
 * 所以前者写「暂无互动」、后者写「—」，绝不补一个看起来像数据的数。
 */
export function rowMetric(heat: number | null, visits: number | null): RowMetric {
  if (heat !== null && heat > 0) return { kind: 'heat', text: `热度 ${heatLabel(heat)}` }
  if (visits !== null && visits > 0) return { kind: 'visits', text: `访问 ${visitLabel(visits)}` }
  if (heat === null && visits === null) return { kind: 'none', text: '—' }
  return { kind: 'none', text: '暂无互动' }
}

export function TrendingWidget() {
  const [rows, setRows] = useState<HotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // 重试在事件回调里置 loading，effect 内不再同步 setState
  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((key) => key + 1)
  }, [])

  useEffect(() => {
    let unmounted = false
    const showDemo = () => {
      if (unmounted) return
      setRows(DEMO_SITES)
      setDemo(true)
    }
    // fetchTrending 的降级原则是「失败也返回空数组」，所以真实原因只能从这个回调拿
    let failure: unknown = null
    fetchTrending(5, (error) => {
      failure = error
    })
      .then((items) => {
        if (unmounted) return
        if (failure !== null) {
          setNotice(describeDegrade(failure))
          showDemo()
          return
        }
        if (!items || items.length === 0) {
          setRows([])
          setDemo(false)
          setNotice(null)
          return
        }
        setRows(
          items.map((s) => ({
            id: s.id,
            title: s.title,
            url: s.url,
            description: s.description ?? undefined,
            heat: numOf(s.trendScore),
            visits: numOf(s.visitCount),
          }))
        )
        setDemo(false)
        setNotice(null)
      })
      .catch(() => {
        if (unmounted) return
        setNotice({ message: '榜单取数异常，已回退到演示数据。', retryable: true })
        showDemo()
      })
      .finally(() => {
        if (!unmounted) setLoading(false)
      })
    return () => {
      unmounted = true
    }
  }, [reloadKey])

  const hasSignal = rows.some((row) => (row.heat ?? 0) > 0 || (row.visits ?? 0) > 0)

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
          <span>热度榜</span>
          {demo && !loading && (
            <span className="px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-normal leading-none">
              演示数据
            </span>
          )}
        </div>
        <Link href="/hot" className="text-xs text-primary hover:underline flex items-center gap-0.5">
          <span>完整榜单</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5 space-y-1.5">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            正在拉取站内趋势...
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground text-center px-2">
            <span>中枢在线，但榜上还没有可排序的收录</span>
            <span className="text-[10px] opacity-80">收录站点后这里会按热度填充</span>
          </div>
        ) : (
          rows.map((site, index) => {
            const metric = rowMetric(site.heat, site.visits)
            return (
              <a
                key={site.id}
                href={safeHref(site.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      index === 0
                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                        : index === 1
                        ? 'bg-slate-400/20 text-slate-500'
                        : index === 2
                        ? 'bg-amber-700/20 text-amber-700'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                      {site.title}
                    </div>
                    {site.description && (
                      <div className="text-xs text-muted-foreground truncate">{site.description}</div>
                    )}
                  </div>
                </div>
                <div
                  className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground tabular-nums"
                  title={
                    metric.kind === 'heat'
                      ? '热度指数 = 近 7 天访问与收藏的对数加权，减去站点年龄惩罚'
                      : metric.kind === 'visits'
                        ? '该站点的累计访问次数'
                        : '这条记录没有可用的热度或访问数据'
                  }
                >
                  {metric.kind === 'visits' && <Eye className="w-3 h-3" />}
                  {metric.kind === 'heat' && <TrendingUp className="w-3 h-3 text-amber-500" />}
                  <span>{metric.text}</span>
                </div>
              </a>
            )
          })
        )}
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono flex flex-col items-center gap-1">
        {demo ? (
          <span>演示数据 · 中枢趋势暂不可用</span>
        ) : hasSignal ? (
          <span>按站内热度指数排序（访问 + 收藏加权）</span>
        ) : rows.length > 0 ? (
          <span>站内互动数据尚未积累 · 榜单按收录位排序</span>
        ) : (
          <span>暂无榜单数据</span>
        )}
        {notice && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <span className="truncate">{notice.message}</span>
            {notice.retryable && (
              <button
                type="button"
                onClick={reload}
                className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:opacity-80"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                重试
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
