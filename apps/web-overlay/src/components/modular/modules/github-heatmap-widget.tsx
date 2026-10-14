'use client'

import React, { useState, useMemo } from 'react'
import { GitCommit, Github, Flame, Calendar, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface GithubHeatmapWidgetProps {
  config?: {
    username?: string
    theme?: 'emerald' | 'amber' | 'purple' | 'cyan'
  }
}

// 伪随机确定性种子发生器
function seededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000
  return x - Math.floor(x)
}

export function GithubHeatmapWidget({ config }: GithubHeatmapWidgetProps) {
  const username = config?.username?.trim() || 'torvalds'
  const theme = config?.theme || 'emerald'
  const [seedOffset, setSeedOffset] = useState(0)
  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number } | null>(null)

  // 主题色类映射
  const themeClasses = {
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
  }[theme]

  // 生成近 24 周（周日到周六）提交矩阵数据
  const { weeks, totalCommits, streak } = useMemo(() => {
    let nameHash = 0
    for (let i = 0; i < username.length; i++) {
      nameHash = (nameHash << 5) - nameHash + username.charCodeAt(i)
    }

    const numWeeks = 24
    const matrix: Array<Array<{ date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }>> = []
    let total = 0
    let currentStreak = 0
    let maxStreak = 0

    const now = new Date()

    for (let w = numWeeks - 1; w >= 0; w--) {
      const days = []
      for (let d = 0; d < 7; d++) {
        const dayOffset = w * 7 + (6 - d)
        const cellDate = new Date(now.getTime() - dayOffset * 86400000)
        const dateStr = cellDate.toISOString().slice(0, 10)

        const r = seededRandom(Math.abs(nameHash) + dayOffset * 17 + seedOffset)
        let count = 0
        let level: 0 | 1 | 2 | 3 | 4 = 0

        if (r > 0.4) {
          if (r > 0.88) {
            count = Math.floor(r * 15) + 6
            level = 4
          } else if (r > 0.72) {
            count = Math.floor(r * 8) + 4
            level = 3
          } else if (r > 0.55) {
            count = Math.floor(r * 4) + 2
            level = 2
          } else {
            count = 1
            level = 1
          }
        }

        total += count
        if (count > 0) {
          currentStreak++
          if (currentStreak > maxStreak) maxStreak = currentStreak
        } else {
          currentStreak = 0
        }

        days.push({ date: dateStr, count, level })
      }
      matrix.push(days)
    }

    return { weeks: matrix, totalCommits: total, streak: Math.min(36, maxStreak) }
  }, [username, seedOffset])

  return (
    <div className="h-full flex flex-col justify-between p-3.5 select-none space-y-2">
      {/* 顶部标题与用户信息 */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center text-foreground shrink-0 border border-border/60">
            <Github className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-foreground truncate">@{username}</span>
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded-full border ${themeClasses.badge}`}>
                热力矩阵
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() => setSeedOffset((s) => s + 1)}
            title="刷新活跃度模拟"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
          <a
            href={`https://github.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-muted-foreground hover:text-primary transition-colors"
            title="前往 GitHub 个人主页"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* 核心指标统计横幅 */}
      <div className="grid grid-cols-3 gap-2 py-1 text-center bg-muted/20 rounded-xl p-2 border border-border/40">
        <div>
          <div className="text-xs text-muted-foreground">统计贡献数</div>
          <div className={`text-sm font-bold font-mono ${themeClasses.text}`}>
            {totalCommits.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">连续打卡</div>
          <div className="text-sm font-bold font-mono text-amber-500 flex items-center justify-center gap-0.5">
            <Flame className="w-3 h-3 fill-amber-500" />
            <span>{streak} 天</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">活跃周期</div>
          <div className="text-sm font-bold font-mono text-foreground">24 周</div>
        </div>
      </div>

      {/* 24 周热力图矩阵 */}
      <div className="flex-1 flex flex-col justify-center min-h-[95px] overflow-x-auto py-1">
        <div className="inline-flex gap-1 items-center mx-auto">
          {weeks.map((week, wIndex) => (
            <div key={wIndex} className="flex flex-col gap-1">
              {week.map((cell, dIndex) => (
                <div
                  key={dIndex}
                  onMouseEnter={() => setHoveredCell({ date: cell.date, count: cell.count })}
                  onMouseLeave={() => setHoveredCell(null)}
                  className={`w-2.5 h-2.5 rounded-2xs border transition-transform hover:scale-125 cursor-pointer ${
                    themeClasses[cell.level]
                  }`}
                  title={`${cell.date}: ${cell.count} 次提交`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 底部悬浮提示与图例 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40">
        <div className="truncate max-w-[180px]">
          {hoveredCell ? (
            <span className="font-mono text-foreground font-medium">
              {hoveredCell.date}: <strong className={themeClasses.text}>{hoveredCell.count}</strong> 次提交
            </span>
          ) : (
            <span className="text-muted-foreground/80">悬浮方块查看单日贡献</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs">少</span>
          <div className="w-2 h-2 rounded-2xs bg-muted/40 border border-border/20" />
          <div className={`w-2 h-2 rounded-2xs ${themeClasses[1]}`} />
          <div className={`w-2 h-2 rounded-2xs ${themeClasses[2]}`} />
          <div className={`w-2 h-2 rounded-2xs ${themeClasses[3]}`} />
          <div className={`w-2 h-2 rounded-2xs ${themeClasses[4]}`} />
          <span className="text-xs">多</span>
        </div>
      </div>
    </div>
  )
}
