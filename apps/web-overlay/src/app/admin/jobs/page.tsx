'use client'

/**
 * 管理端：任务队列面板。
 * 展示 jobs 状态，支持入队四种任务（Runner 30s 内自动消费）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface Job {
  id: string
  kind: string
  status: string
  attempts: number
  error: string | null
  createdAt: number
  updatedAt: number
}

const KIND_LABELS: Record<string, string> = {
  health_check: '健康巡检',
  refetch_metadata: '元数据刷新',
  recompute_rank: '热度重算',
  reindex: '索引重建',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  done: '已完成',
  failed: '失败',
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [enqueuing, setEnqueuing] = useState<string | null>(null)

  const load = useCallback(() => {
    void hubGet<Job[]>('/api/hub/jobs?limit=50').then((j: Job[]) => { setJobs(j); setLoading(false) })
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  const enqueue = async (kind: string) => {
    setEnqueuing(kind)
    try {
      await hubSend('/api/hub/jobs', 'POST', { kind })
      load()
    } finally {
      setEnqueuing(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-6">任务队列</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(KIND_LABELS).map(([kind, label]) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            disabled={enqueuing === kind}
            onClick={() => void enqueue(kind)}
          >
            {enqueuing === kind ? '入队中…' : '入队：' + label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">加载中…</div>
      ) : jobs.length === 0 ? (
        <div className="text-muted-foreground text-sm">暂无任务</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">类型</th>
                <th className="text-left px-3 py-2 font-medium">状态</th>
                <th className="text-left px-3 py-2 font-medium">尝试</th>
                <th className="text-left px-3 py-2 font-medium">错误</th>
                <th className="text-left px-3 py-2 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{KIND_LABELS[j.kind] ?? j.kind}</td>
                  <td className="px-3 py-2">
                    <span className={
                      j.status === 'done' ? 'text-green-600' :
                      j.status === 'failed' ? 'text-red-600' :
                      j.status === 'running' ? 'text-blue-600' : 'text-muted-foreground'
                    }>
                      {STATUS_LABELS[j.status] ?? j.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{j.attempts}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[240px] truncate" title={j.error ?? ''}>
                    {j.error ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(j.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
