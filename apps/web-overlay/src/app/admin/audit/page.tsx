'use client'

/**
 * 管理端：审计日志。
 *
 * 与鉴权配套的可见性闭环——「谁在什么时候改了什么」。
 * 支持按 action / actor 过滤（如只看 token 调用、只看删除）、分页加载、diff 展开。
 */

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { hubGet } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'

interface AuditItem {
  id: number
  actor: string
  actorKind: string
  action: string
  target: string | null
  diff: unknown
  ip: string | null
  createdAt: number
}

interface AuditResponse {
  items: AuditItem[]
  hasMore: boolean
  limit: number
  offset: number
  actions: string[]
}

const KIND_LABELS: Record<string, string> = {
  token: 'token',
  static: '引导',
  anonymous: '匿名',
  user: '用户',
}

/** diff 可能较大，表格里只给摘要，点「详情」再展开 */
function summarize(diff: unknown): string {
  if (diff == null) return '—'
  if (typeof diff === 'string') return diff
  try {
    const s = JSON.stringify(diff)
    return s.length > 80 ? s.slice(0, 80) + '…' : s
  } catch {
    return '—'
  }
}

export default function AdminAuditPage() {
  const [items, setItems] = useState<AuditItem[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback((offset: number) => {
    const params = new URLSearchParams({ limit: '50' })
    if (offset > 0) params.set('offset', String(offset))
    if (action) params.set('action', action)
    if (actor) params.set('actor', actor)
    // 必须自己兜住失败：原来这里是裸的 .then()，中枢挂掉时
    // setLoading(false) 永远不会执行 —— 页面就永远停在「加载中…」，
    // 用户既看不到原因，也没有重试入口。
    void (async () => {
      try {
        const d = await hubGet<AuditResponse>('/api/hub/admin/audit?' + params.toString())
        setItems((prev) => (offset === 0 ? d.items : [...prev, ...d.items]))
        setHasMore(d.hasMore)
        setActions(d.actions)
        setLoadError(null)
      } catch (error) {
        setLoadError(error)
      } finally {
        setLoading(false)
      }
    })()
  }, [action, actor])

  const retry = () => {
    setLoading(true)
    setItems([])
    load(0)
  }

  // 换筛选条件 = 回到第一页
  useEffect(() => {
    setLoading(true)
    setItems([])
    load(0)
  }, [load])

  const notice = loadError === null ? null : describeDegrade(loadError)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-2">审计日志</h1>
      <p className="text-xs text-muted-foreground mb-4">
        记录所有写操作的执行者与影响面。token 调用显示 token 名称（actorKind=token），开放模式显示 api。
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">全部动作</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input
          className="h-8 rounded-md border border-input bg-background px-2 text-sm w-44"
          placeholder="按执行者过滤"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        {(action || actor) && (
          <Button size="sm" variant="ghost" onClick={() => { setAction(''); setActor('') }}>
            清除筛选
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">加载中…</div>
      ) : notice && items.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <p>{notice.message}</p>
          <p className="mt-1 text-xs">审计记录并未被删除，只是这次没取到。</p>
          {notice.retryable && (
            <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
              重试
            </Button>
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground text-sm">暂无审计记录</div>
      ) : (
        <>
          {notice && (
            <div className="mb-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {notice.message} 已加载的记录仍然可用，可点「加载更多」重试。
            </div>
          )}
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 font-medium">时间</th>
                  <th className="text-left px-3 py-2 font-medium">执行者</th>
                  <th className="text-left px-3 py-2 font-medium">动作</th>
                  <th className="text-left px-3 py-2 font-medium">目标</th>
                  <th className="text-left px-3 py-2 font-medium">详情</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <Fragment key={it.id}>
                    <tr
                      className="border-b last:border-0 cursor-pointer hover:bg-accent/40"
                      onClick={() => setExpanded(expanded === it.id ? null : it.id)}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(it.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{it.actor}</span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({KIND_LABELS[it.actorKind] ?? it.actorKind})
                        </span>
                      </td>
                      <td className="px-3 py-2">{it.action}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[180px] truncate" title={it.target ?? ''}>
                        {it.target ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px] truncate" title={summarize(it.diff)}>
                        {summarize(it.diff)}
                      </td>
                    </tr>
                    {expanded === it.id && (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="text-xs space-y-1">
                            <div>
                              <span className="text-muted-foreground">执行者：</span>
                              {it.actor}（{it.actorKind}）
                              {it.ip && <span className="ml-2 text-muted-foreground">IP {it.ip}</span>}
                            </div>
                            <div>
                              <span className="text-muted-foreground">目标：</span>
                              {it.target ?? '—'}
                            </div>
                            <div>
                              <span className="text-muted-foreground">diff：</span>
                              <pre className="mt-1 rounded bg-background border p-2 overflow-x-auto max-h-48">
                                {it.diff == null ? '—' : typeof it.diff === 'string' ? it.diff : JSON.stringify(it.diff, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="mt-3 text-center">
              <Button size="sm" variant="outline" onClick={() => load(items.length)}>
                加载更多（已显示 {items.length} 条）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
