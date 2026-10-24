'use client'

/**
 * GitHub 提交热力足迹。
 *
 * 数据来自 GitHub 公开事件 API（真实 PushEvent 提交数），取不到就直说取不到。
 * 以前这张卡片整块是 `Math.sin` 伪随机造出来的假贡献记录，且默认用户名写死、
 * 界面上无处可改；模拟矩阵现在只在用户显式点「预览模拟布局」时出现，并常驻「模拟数据」标记。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, FlaskConical, Flame, Github, Loader2, RefreshCw, Settings2, ExternalLink } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  HEATMAP_WEEKS,
  buildHeatmap,
  fetchPublicPushEvents,
  localDateKey,
  simulateCounts,
  type HeatmapData,
} from '@/lib/modular/github-heatmap'

type ThemeName = 'emerald' | 'amber' | 'purple' | 'cyan'

interface GithubHeatmapWidgetProps {
  config?: {
    username?: string
    theme?: ThemeName
  }
}

const THEME_CLASSES: Record<ThemeName, Record<string | number, string>> = {
  emerald: {
    0: 'bg-muted/40 dark:bg-muted/20 border-border/20',
    1: 'bg-emerald-500/25 dark:bg-emerald-500/20 border-emerald-500/30',
    2: 'bg-emerald-500/50 dark:bg-emerald-500/45 border-emerald-500/50',
    3: 'bg-emerald-500/75 dark:bg-emerald-500/70 border-emerald-500/70',
    4: 'bg-emerald-500 text-white font-bold border-emerald-600',
    text: 'text-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  amber: {
    0: 'bg-muted/40 dark:bg-muted/20 border-border/20',
    1: 'bg-amber-500/25 dark:bg-amber-500/20 border-amber-500/30',
    2: 'bg-amber-500/50 dark:bg-amber-500/45 border-amber-500/50',
    3: 'bg-amber-500/75 dark:bg-amber-500/70 border-amber-500/70',
    4: 'bg-amber-500 text-white font-bold border-amber-600',
    text: 'text-amber-500',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  purple: {
    0: 'bg-muted/40 dark:bg-muted/20 border-border/20',
    1: 'bg-purple-500/25 dark:bg-purple-500/20 border-purple-500/30',
    2: 'bg-purple-500/50 dark:bg-purple-500/45 border-purple-500/50',
    3: 'bg-purple-500/75 dark:bg-purple-500/70 border-purple-500/70',
    4: 'bg-purple-500 text-white font-bold border-purple-600',
    text: 'text-purple-500',
    badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  cyan: {
    0: 'bg-muted/40 dark:bg-muted/20 border-border/20',
    1: 'bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/30',
    2: 'bg-cyan-500/50 dark:bg-cyan-500/45 border-cyan-500/50',
    3: 'bg-cyan-500/75 dark:bg-cyan-500/70 border-cyan-500/70',
    4: 'bg-cyan-500 text-white font-bold border-cyan-600',
    text: 'text-cyan-500',
    badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  },
}

/** 未登录按 IP 限流 60 次/小时；同一用户名 15 分钟内复用结果，避免每次挂载都打满 */
const CACHE_TTL_MS = 15 * 60 * 1000
const liveCache = new Map<string, { at: number; day: string; data: HeatmapData }>()

const ERROR_TEXT: Record<string, string> = {
  invalid_user: '用户名格式不合法：只允许字母、数字与单个连字符（1-39 位）。',
  not_found: 'GitHub 上没有这个用户。',
  rate_limited: '未登录调用被 GitHub 限流（按 IP 60 次/小时），稍后再刷新。',
  queued: 'GitHub 正在生成该用户的事件数据，稍后重试。',
  network: '连不上 api.github.com（网络受限或被拦截）。',
  http: 'GitHub 事件接口返回异常。',
}

function errorText(reason: string, status?: number): string {
  if (reason === 'http' && status) return `GitHub 事件接口返回 HTTP ${status}。`
  return ERROR_TEXT[reason] ?? ERROR_TEXT.http
}

function makeDemo(username: string, offset: number): HeatmapData {
  return buildHeatmap(simulateCounts(username, { offset }), { weeks: HEATMAP_WEEKS, source: 'demo' })
}

export function GithubHeatmapWidget({ config }: GithubHeatmapWidgetProps) {
  const username = config?.username?.trim() ?? ''
  const theme = config?.theme && THEME_CLASSES[config.theme] ? config.theme : 'emerald'
  const themeClasses = THEME_CLASSES[theme]

  const [data, setData] = useState<HeatmapData | null>(null)
  const [demo, setDemo] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number } | null>(null)

  const load = useCallback(
    async (bypassCache = false) => {
      if (!username) {
        setData(null)
        setDemo(null)
        setError(null)
        return
      }
      const cached = liveCache.get(username)
      if (!bypassCache && cached && cached.day === localDateKey(new Date()) && Date.now() - cached.at < CACHE_TTL_MS) {
        setData(cached.data)
        setDemo(null)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      const res = await fetchPublicPushEvents(username)
      // 用户名在这期间被改掉 / 卡片被卸载：迟到响应不能回填，否则会把别人的数字挂到这里
      if (!username) return
      if (res.ok) {
        const built = buildHeatmap(res.counts, { weeks: HEATMAP_WEEKS, source: 'live', truncated: res.truncated })
        liveCache.set(username, { at: Date.now(), day: localDateKey(new Date()), data: built })
        setData(built)
        setDemo(null)
      } else {
        liveCache.delete(username)
        setData(null)
        setError(errorText(res.reason, res.status))
      }
      setLoading(false)
    },
    [username],
  )

  // 延后一拍再请求：避免 effect 同步 setState
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [load])

  const render = demo ?? data
  const isDemo = render?.source === 'demo'
  const windowDays = useMemo(
    () => (render ? render.weeks.flat().filter((cell) => !cell.future).length : 0),
    [render],
  )

  if (!username) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center border border-border/60">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
        </div>
        <p className="text-xs font-medium text-foreground">尚未设置 GitHub 用户名</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[230px]">
          进入编辑模式，点这张卡片的齿轮，在「GitHub 用户名」里填自己的账号。
          这里不预填别人的名字，也不编一份提交记录。
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col justify-between p-3.5 select-none space-y-2">
      {/* 顶部标题与数据源标注 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center text-foreground shrink-0 border border-border/60">
            <Github className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-foreground truncate">@{username}</span>
              <a
                href={`https://github.com/${encodeURIComponent(username)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors inline-flex"
                title="前往 GitHub 个人主页"
                aria-label="前往 GitHub 个人主页"
              >
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isDemo ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium whitespace-nowrap">
              模拟数据
            </span>
          ) : loading ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/40 bg-muted/40 text-muted-foreground whitespace-nowrap inline-flex items-center gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              读取事件
            </span>
          ) : render ? (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${themeClasses.badge}`}>
              实时事件流
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-destructive/30 bg-destructive/5 text-destructive whitespace-nowrap">
              未取到数据
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (isDemo) setDemo(makeDemo(username, Date.now() % 100000))
              else void load(true)
            }}
            title={isDemo ? '重新生成模拟矩阵' : '重新读取 GitHub 事件'}
            aria-label={isDemo ? '重新生成模拟矩阵' : '重新读取 GitHub 事件'}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center min-h-[95px]">
          <p className="text-[11px] text-destructive leading-relaxed inline-flex items-start gap-1.5 max-w-[270px]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => void load(true)}>
              <RefreshCw className="mr-1 w-2.5 h-2.5" />
              重试
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px]"
              onClick={() => setDemo(makeDemo(username, 0))}
            >
              <FlaskConical className="mr-1 w-2.5 h-2.5" />
              预览模拟布局
            </Button>
          </div>
        </div>
      ) : loading && !render ? (
        <div className="flex-1 flex items-center justify-center min-h-[95px]">
          <div className="flex gap-1 mx-auto opacity-40" aria-hidden>
            {Array.from({ length: HEATMAP_WEEKS }).map((_, w) => (
              <div key={w} className="flex flex-col gap-1">
                {Array.from({ length: 7 }).map((__, d) => (
                  <span key={d} className="w-2.5 h-2.5 rounded-2xs bg-muted animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : render ? (
        <>
          {/* 核心读数：全部来自事件汇总 */}
          <div className="grid grid-cols-3 gap-2 py-1 text-center bg-muted/20 rounded-xl p-2 border border-border/40">
            <div>
              <div className="text-[11px] text-muted-foreground">窗口内提交</div>
              <div className={`text-sm font-bold font-mono ${themeClasses.text}`}>
                {render.totalCommits.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">连续打卡</div>
              <div className="text-sm font-bold font-mono text-amber-500 flex items-center justify-center gap-0.5">
                <Flame className="w-3 h-3 fill-amber-500" />
                <span>{render.currentStreak} 天</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">活跃天数</div>
              <div className="text-sm font-bold font-mono text-foreground">
                {render.activeDays} / {windowDays}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center min-h-[95px] overflow-x-auto py-1">
            <div className="inline-flex gap-1 items-start mx-auto">
              {render.weeks.map((week, wIndex) => (
                <div key={wIndex} className="flex flex-col gap-1">
                  {week.map((cell, dIndex) =>
                    cell.future ? (
                      <span key={`${cell.date}-${dIndex}`} className="w-2.5 h-2.5" aria-hidden />
                    ) : (
                      <div
                        key={`${cell.date}-${dIndex}`}
                        onMouseEnter={() => setHoveredCell({ date: cell.date, count: cell.count })}
                        onMouseLeave={() => setHoveredCell(null)}
                        className={`w-2.5 h-2.5 rounded-2xs border transition-transform hover:scale-125 cursor-pointer ${
                          themeClasses[cell.level]
                        }`}
                        title={`${cell.date}：${cell.count} 次提交`}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
            <div className="truncate max-w-[190px]">
              {hoveredCell ? (
                <span className="font-mono text-foreground font-medium">
                  {hoveredCell.date}：<strong className={themeClasses.text}>{hoveredCell.count}</strong> 次提交
                </span>
              ) : render.totalCommits === 0 ? (
                <span>窗口内的公开事件里没有 push 记录</span>
              ) : (
                <span>悬浮方块查看单日提交</span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((lv) => (
                <div key={lv} className={`w-2 h-2 rounded-2xs ${themeClasses[lv]}`} />
              ))}
              <span>多</span>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/80 leading-snug">
            {isDemo
              ? '模拟矩阵：仅用于预览排版与配色，不是任何人的真实贡献记录。'
              : `色阶按本卡数据分档（单日最高 ${render.maxDaily} 次）· 覆盖 ${render.coveredFrom ?? '—'} ~ ${
                  render.coveredTo ?? '—'
                }${render.truncated ? ' · 事件流被 300 条上限截断，数字仅为可见部分' : ''}`}
          </p>
        </>
      ) : null}
    </div>
  )
}
