'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from 'lucide-react'

type Phase = 'loading' | 'success' | 'error'

/**
 * 邮箱验证页。
 *
 * 从 query 读 token，调用 /api/hub/account/verify-email 完成一次性消费。
 * 成功 → 引导登录；失败 → 提示重新发送。
 */
// 契约级补缺（主理人 2026-11-01）：useSearchParams 必须包 Suspense，否则构建期 CSR bailout 阻断
// 全仓 next build；仅加边界不改业务逻辑，未随本会话提交。
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  )
}

function VerifyEmailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams?.get('token') ?? ''
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('正在验证你的邮箱...')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!token) {
      setPhase('error')
      setMessage('缺少验证令牌，请通过邮件中的链接进入本页面')
      return
    }
    void (async () => {
      try {
        const res = await fetch('/api/hub/account/verify-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setPhase('success')
          setMessage(data?.message ?? '邮箱验证成功')
        } else {
          setPhase('error')
          setMessage(data?.error ?? '验证失败，链接可能已失效或已使用')
        }
      } catch {
        setPhase('error')
        setMessage('网络异常，请稍后重试')
      }
    })()
  }, [token])

  return (
    <main id="main-content" className="min-h-screen w-full bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px] border-border/70 shadow-lg backdrop-blur-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl sm:text-2xl text-center font-bold tracking-tight">邮箱验证</CardTitle>
          <CardDescription className="text-center text-xs sm:text-sm">
            验证你的邮箱以激活山羊胡账号
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {phase === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">{message}</p>
            </div>
          )}
          {phase === 'success' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <p className="text-sm font-medium text-foreground">{message}</p>
              <p className="text-xs text-muted-foreground">现在可以使用邮箱和密码登录</p>
            </div>
          )}
          {phase === 'error' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-8 h-8 text-destructive" />
              <p className="text-sm font-medium text-foreground">{message}</p>
              <Link
                href="/auth/signin"
                className="text-xs text-primary hover:underline"
              >
                返回登录
              </Link>
            </div>
          )}
        </CardContent>
        {phase === 'success' && (
          <CardFooter className="flex flex-col gap-2 pt-2 border-t border-border/50">
            <Button className="w-full h-9 text-xs" onClick={() => router.push('/auth/signin')}>
              <MailCheck className="mr-1.5 h-3.5 w-3.5" />
              前往登录
            </Button>
          </CardFooter>
        )}
        {phase === 'error' && (
          <CardFooter className="flex flex-col gap-2 pt-2 border-t border-border/50">
            <Link href="/auth/forgot-password" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              重新发送验证邮件
            </Link>
          </CardFooter>
        )}
      </Card>
    </main>
  )
}
