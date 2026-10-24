'use client'

/**
 * 登录设备管理（T8 会话治理）：列出活跃会话并支持踢出。
 *
 * 实现口径：会话行由 BFF 在代理 /api/me/* 时惰性登记（sid 的 sha256 + UA +
 * 最近活跃）。「当前设备」由 BFF 比对自己的 sidHash 标记；踢出后该设备的下一个
 * /api/me/* 请求起 401。列表为空不是故障——旧会话或从未走过 BFF 的调用方没有行。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, LogOut, MonitorSmartphone } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface SessionDevice {
  token: string
  userAgent: string | null
  createdAt: number
  lastSeenAt: number
  expiresAt: number
}

function formatTime(ts: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

/** 把 UA 压缩成一行可读摘要：不去猜浏览器品牌（猜错比不猜更尴尬），只截断 */
function summarizeAgent(ua: string | null): string {
  if (!ua) return '未知设备'
  return ua.length > 60 ? ua.slice(0, 60) + '…' : ua
}

export function SessionDevicesPanel() {
  const { toast } = useToast()
  const [devices, setDevices] = useState<SessionDevice[] | null>(null)
  const [currentSidHash, setCurrentSidHash] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busyToken, setBusyToken] = useState<string | null>(null)
  const [confirmToken, setConfirmToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch('/api/me/sessions', { cache: 'no-store' })
      if (!res.ok) {
        setLoadError(true)
        setDevices(null)
        return
      }
      const data = (await res.json()) as { devices?: SessionDevice[]; currentSidHash?: string | null }
      setDevices(Array.isArray(data.devices) ? data.devices : [])
      setCurrentSidHash(typeof data.currentSidHash === 'string' ? data.currentSidHash : null)
    } catch {
      setLoadError(true)
      setDevices(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const revoke = useCallback(
    async (token: string) => {
      if (busyToken) return
      setBusyToken(token)
      try {
        const res = await fetch('/api/me/sessions/' + token, { method: 'DELETE', cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          toast({ title: '踢出失败', description: body.error ?? '请稍后重试', variant: 'destructive' })
          return
        }
        toast({
          title: '设备已踢出',
          description: token === currentSidHash ? '这是当前设备：下一次操作会要求重新登录。' : '该设备的下一个请求起将失去访问能力。',
        })
        setConfirmToken(null)
        await load()
      } finally {
        setBusyToken(null)
      }
    },
    [busyToken, currentSidHash, load, toast],
  )

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MonitorSmartphone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          登录设备
        </h2>
        <span className="text-[11px] text-muted-foreground">被踢出的设备从下一个请求起失去访问能力</span>
      </div>

      {devices === null && !loadError && (
        <p className="mt-3 text-xs text-muted-foreground" aria-busy="true">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden />
          正在加载设备列表…
        </p>
      )}

      {loadError && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground" role="alert">
            设备列表暂时取不到（这不代表有异常登录）。
          </p>
          <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}

      {devices !== null && devices.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
          暂无可展示的设备记录（本功能上线前的旧会话不会出现在这里）。
        </p>
      )}

      {devices !== null && devices.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60">
          {devices.map((d) => {
            const isCurrent = d.token === currentSidHash
            const confirming = confirmToken === d.token
            return (
              <li key={d.token} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      isCurrent ? 'bg-primary/10 text-primary' : 'bg-muted/70 text-muted-foreground'
                    }`}
                  >
                    <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-xs font-medium">
                      <span className="truncate">{summarizeAgent(d.userAgent)}</span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          当前设备
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      最近活跃 {formatTime(d.lastSeenAt)} · 登录于 {formatTime(d.createdAt)}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={confirming ? 'destructive' : 'outline'}
                  className="w-full shrink-0 text-xs sm:w-auto"
                  disabled={busyToken === d.token}
                  onClick={() => {
                    if (!confirming) {
                      setConfirmToken(d.token)
                      return
                    }
                    void revoke(d.token)
                  }}
                >
                  {busyToken === d.token ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {confirming ? '确认踢出' : '踢出'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
