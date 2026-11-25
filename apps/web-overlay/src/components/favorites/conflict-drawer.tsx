'use client'
/**
 * 冲突裁决抽屉（2026-11-21）。
 *
 * 只在**同一书签的同一字段**出现分歧时打开——不同条目增删、正交字段修改
 * 都在 mergeThreeWay 里静默解决了，不该打扰用户。
 *
 * 三条设计纪律：
 *  1. 仅高亮差异字段：未变化字段全部隐藏，降低阅读负担
 *  2. 三个明确动作（保留本机 / 采用云端 / 两份都留），杜绝"是/否"歧义
 *  3. 「编辑 vs 删除」默认高亮"两份都留"——绝不默认丢弃离线劳动
 */
import { useEffect } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, Copy, X } from 'lucide-react'
import { useOverlayBehavior } from '@/components/ui/overlay'
import type { ConflictFieldKey, ConflictResolution, SyncConflictItem } from '@/lib/favorites-sync'
import { LOCAL_COPY_SUFFIX, recommendResolution } from '@/lib/favorites-sync'

/** 字段的展示名 */
const FIELD_LABEL: Record<ConflictFieldKey, string> = {
  title: '标题',
  url: '链接',
  folderId: '所属文件夹',
  note: '批注',
  tags: '标签',
  deleted: '删除状态',
}

/** 把快照里的字段值渲染成可读文本 */
function renderValue(v: unknown): string {
  if (v == null) return '（空）'
  if (Array.isArray(v)) return v.length ? v.join('、') : '（空）'
  if (typeof v === 'boolean') return v ? '已删除' : '保留'
  return String(v)
}

function formatRelative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

export interface ConflictDrawerProps {
  conflicts: readonly SyncConflictItem[]
  onResolve: (conflictId: string, resolution: ConflictResolution) => void
  onClose: () => void
  /** 是否有已勾选但未确认的选择（用于离开提醒） */
  onUnconfirmedChange?: (has: boolean) => void
}

export function ConflictDrawer({ conflicts, onResolve, onClose, onUnconfirmedChange }: ConflictDrawerProps) {
  /**
   * 抽屉打开即视为「有未确认的裁决选择」——这正是唯一该触发离开提醒的场景。
   * 关闭时复位。Local-First 下其它任何情况（同步中、待同步）都不拦截离开。
   */
  useEffect(() => {
    onUnconfirmedChange?.(true)
    return () => onUnconfirmedChange?.(false)
  }, [onUnconfirmedChange])
  // 键盘可达性：Esc 关闭、Tab 焦点圈养、关闭还原焦点——统一复用浮层行为层，
  // 不再手搓 role/aria-modal（此前焦点会漏到抽屉背后、Esc 无反应）。
  const { containerProps, scrimProps } = useOverlayBehavior({
    open: conflicts.length > 0,
    onClose,
    ariaLabel: '冲突裁决',
  })
  if (conflicts.length === 0) return null
  const multi = conflicts.length >= 3

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div {...scrimProps} className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
      <div {...containerProps} className="relative flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-border/60 bg-background shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">{conflicts.length} 项冲突待确认</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 批量快捷栏：≥3 条才出现 */}
        {multi ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2">
            <button
              type="button"
              onClick={() => conflicts.forEach((c) => onResolve(c.conflictId, 'keep_local'))}
              className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
            >
              全部保留本机
            </button>
            <button
              type="button"
              onClick={() => conflicts.forEach((c) => onResolve(c.conflictId, 'keep_both'))}
              className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
            >
              全部保留副本
            </button>
          </div>
        ) : null}

        {/* 冲突卡片列表 */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {conflicts.map((c) => {
            const rec = recommendResolution(c)
            const isDeleteConflict = c.conflictType === 'edit_vs_delete'
            return (
              <div key={c.conflictId} className="rounded-xl border border-amber-500/35 bg-amber-500/[0.04] p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.itemTitle}</span>
                  {isDeleteConflict ? (
                    <span className="shrink-0 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-px text-[10px] font-medium text-rose-700 dark:text-rose-400">
                      一端已删除
                    </span>
                  ) : null}
                </div>

                {/* 仅高亮差异字段 */}
                <div className="space-y-2">
                  {c.divergedFields.map((f) => (
                    <div key={f} className="rounded-lg border border-border/50 bg-background/60 p-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {FIELD_LABEL[f]}
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        <div className="rounded border border-emerald-500/25 bg-emerald-500/[0.06] px-2 py-1">
                          <div className="mb-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                            本机修改（{formatRelative(c.localUpdatedAtMs)}）
                          </div>
                          <div className="break-words text-xs">{renderValue(c.localSnapshot?.[f])}</div>
                        </div>
                        <div className="rounded border border-sky-500/25 bg-sky-500/[0.06] px-2 py-1">
                          <div className="mb-0.5 text-[10px] text-sky-700 dark:text-sky-400">
                            云端版本（{formatRelative(c.remoteUpdatedAtMs)}）
                          </div>
                          <div className="break-words text-xs">{renderValue(c.remoteSnapshot?.[f])}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 三个明确动作：推荐项高亮 */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onResolve(c.conflictId, 'keep_local')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      rec === 'keep_local'
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border/60 bg-background hover:border-primary/40'
                    }`}
                  >
                    <Check className="h-3 w-3" />
                    {isDeleteConflict ? '恢复并保留本机修改' : '保留本机'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolve(c.conflictId, 'use_remote')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      rec === 'use_remote' ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/60 bg-background hover:border-primary/40'
                    }`}
                  >
                    <ArrowLeftRight className="h-3 w-3" />
                    采用云端
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolve(c.conflictId, 'keep_both')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      rec === 'keep_both' ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/60 bg-background hover:border-primary/40'
                    }`}
                    title={`本机改动另存为新收藏，标题加「${LOCAL_COPY_SUFFIX}」后缀`}
                  >
                    <Copy className="h-3 w-3" />
                    两份都留
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* E2EE 信任声明 */}
        <div className="border-t border-border/60 px-4 py-2">
          <p className="text-[10px] text-muted-foreground">冲突比对全程在你的浏览器本地解密完成</p>
        </div>
      </div>
    </div>
  )
}
