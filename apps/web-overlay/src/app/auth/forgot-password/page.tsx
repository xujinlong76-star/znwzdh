'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { ArrowLeft, AlertCircle, CheckCircle2, Mail, KeyRound } from 'lucide-react'
import { Icons } from '@/components/icons'

/**
 * 忘记密码页。
 *
 * 输入邮箱后调用 /api/hub/account/forgot-password。无论邮箱是否注册都返回
 * 同一文案（防账号枚举）；若已注册，重置链接会发送到该邮箱。
 */
export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsLoading(true)
    try {
      const res = await fetch('/api/hub/account/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSuccessMessage(data?.message ?? '若该邮箱已注册，重置链接已发送')
        setIsLoading(false)
        return
      }
      setIsLoading(false)
      setErrorMessage(data?.error ?? '请求失败，请稍后重试')
    } catch {
      setIsLoading(false)
      setErrorMessage('网络异常，请检查服务是否可用')
    }
  }

  return (
    <main id="main-content" className="min-h-screen w-full bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px] border-border/70 shadow-lg backdrop-blur-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl sm:text-2xl text-center font-bold tracking-tight">重置密码</CardTitle>
          <CardDescription className="text-center text-xs sm:text-sm">
            输入注册邮箱，我们会发送重置链接
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

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                注册邮箱
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="h-9 text-xs"
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full h-9 text-xs font-medium" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Icons.spinner className="mr-2 h-3.5 w-3.5 animate-spin" />
                  发送中...
                </>
              ) : (
                <>
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  发送重置链接
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
