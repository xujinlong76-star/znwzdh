'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ArrowLeft, AlertCircle, CheckCircle2, Lock, KeyRound } from 'lucide-react'
import { Icons } from '@/components/icons'

/**
 * 重置密码页。
 *
 * 从 query 读 token，填写新密码后调用 /api/hub/account/reset-password。
 * 令牌一次性消费，成功后引导登录。
 */
// 契约级补缺（主理人 2026-11-01 23:5x）：useSearchParams 必须包在 Suspense 边界内，否则构建期
// CSR bailout 报错阻断全仓 next build；仅加边界，不改页面逻辑，未随本会话提交。
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  )
}

function ResetPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams?.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    if (password.length < 8) {
      setErrorMessage('密码至少 8 个字符')
      return
    }
    if (password !== confirm) {
      setErrorMessage('两次输入的密码不一致')
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch('/api/hub/account/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSuccessMessage(data?.message ?? '密码已重置')
        setIsLoading(false)
        setTimeout(() => router.push('/auth/signin'), 1800)
        return
      }
      setIsLoading(false)
      setErrorMessage(data?.error ?? '重置失败，链接可能已失效')
    } catch {
      setIsLoading(false)
      setErrorMessage('网络异常，请稍后重试')
    }
  }

  return (
    <main id="main-content" className="min-h-screen w-full bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px] border-border/70 shadow-lg backdrop-blur-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl sm:text-2xl text-center font-bold tracking-tight">设置新密码</CardTitle>
          <CardDescription className="text-center text-xs sm:text-sm">
            为你的山羊胡账号设置一个新密码
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs leading-snug animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}
          {successMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs leading-snug animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{successMessage}</div>
            </div>
          )}
          {!token && !successMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 text-xs leading-snug">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">缺少重置令牌，请通过邮件中的链接进入本页面</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                新密码
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="至少 8 个字符"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading || !token}
                className="h-9 text-xs"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-xs font-medium flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                确认新密码
              </Label>
              <Input
                id="confirm"
                type="password"
                placeholder="再次输入新密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={isLoading || !token}
                className="h-9 text-xs"
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full h-9 text-xs font-medium" disabled={isLoading || !token}>
              {isLoading ? (
                <>
                  <Icons.spinner className="mr-2 h-3.5 w-3.5 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  重置密码
                </>
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 pt-2 border-t border-border/50 text-center">
          <Link
            href="/auth/signin"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            返回登录
          </Link>
        </CardFooter>
      </Card>
    </main>
  )
}
