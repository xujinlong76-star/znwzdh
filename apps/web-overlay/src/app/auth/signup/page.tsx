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
import { ArrowLeft, AlertCircle, UserPlus, Mail, Lock, User } from 'lucide-react'
import { Icons } from '@/components/icons'
import { normalizeCallbackUrl } from '@/lib/safe-callback'

/**
 * 用户注册页。
 *
 * 调用 /api/hub/account/register（BFF 转发到 API 中枢）。注册成功后引导用户
 * 查收验证邮件；开发环境未配 SMTP 时邮件会打印到 API 服务端日志。
 */
// 契约级补缺（主理人 2026-11-01）：useSearchParams 必须包 Suspense，否则构建期 CSR bailout 阻断
// 全仓 next build；仅加边界不改业务逻辑，未随本会话提交。
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  )
}

function SignUpInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = normalizeCallbackUrl(
    searchParams?.get('callbackUrl'),
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  )

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsLoading(true)
    try {
      const res = await fetch('/api/hub/account/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSuccessMessage(data?.message ?? '注册成功，请查收验证邮件')
        setIsLoading(false)
        // 短暂展示成功态后回到登录页（带已注册提示）
        setTimeout(() => {
          router.push(`/auth/signin?registered=1&email=${encodeURIComponent(email.trim())}`)
        }, 2200)
        return
      }
      setIsLoading(false)
      setErrorMessage(data?.error ?? '注册失败，请稍后重试')
    } catch {
      setIsLoading(false)
      setErrorMessage('网络异常，请检查服务是否可用')
    }
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2 bg-background">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex select-none">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="relative w-8 h-8 overflow-hidden rounded-lg border border-white/20 shadow-md">
              <img src="/assets/images/alogo.webp" alt="山羊胡 Logo" className="object-cover w-full h-full" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold leading-none tracking-tight text-white">山羊胡</span>
              <span className="text-[11px] text-zinc-400 mt-0.5 tracking-wider uppercase font-semibold">
                Control Center
              </span>
            </div>
          </Link>
        </div>
        <div className="relative z-20 my-auto max-w-md space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-medium">
            <UserPlus className="w-3.5 h-3.5" />
            <span>创建你的账号</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-zinc-100">加入山羊胡</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            注册后可云端同步收藏、个性化推荐与多端数据。验证邮箱后即可获得完整体验。
          </p>
        </div>
        <div className="relative z-20 mt-auto pt-6 border-t border-white/10 flex items-center justify-between text-xs text-zinc-400">
          <span suppressHydrationWarning>&copy; {new Date().getFullYear()} 山羊胡 Team</span>
          <Link href="/" className="inline-flex items-center gap-1 hover:text-white transition-colors">
            <ArrowLeft className="w-3 h-3" />
            返回前台首页
          </Link>
        </div>
      </div>

      <main id="main-content" className="flex flex-col justify-center items-center p-4 sm:p-8">
        <div className="mx-auto flex w-full max-w-[390px] flex-col justify-center space-y-6">
          <div className="flex lg:hidden flex-col items-center gap-2 mb-2 text-center">
            <div className="relative w-10 h-10 overflow-hidden rounded-xl border border-border shadow-md">
              <img src="/assets/images/alogo.webp" alt="Logo" className="object-cover w-full h-full" />
            </div>
            <span className="text-xl font-bold tracking-tight">注册山羊胡账号</span>
          </div>

          <Card className="border-border/70 shadow-lg backdrop-blur-sm">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-xl sm:text-2xl text-center font-bold tracking-tight">创建账号</CardTitle>
              <CardDescription className="text-center text-xs sm:text-sm">
                填写信息即可完成注册，我们会发送验证邮件
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
                  <Mail className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">{successMessage}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-xs font-medium flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    用户名
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="例如 zhangsan"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    className="h-9 text-xs"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    邮箱
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

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                    密码
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="至少 8 个字符"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="h-9 text-xs"
                    autoComplete="new-password"
                  />
                </div>

                <Button type="submit" className="w-full h-9 text-xs font-medium" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Icons.spinner className="mr-2 h-3.5 w-3.5 animate-spin" />
                      注册中...
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                      注册
                    </>
                  )}
                </Button>
              </form>
            </CardContent>

            <CardFooter className="flex flex-col gap-2 pt-2 border-t border-border/50 text-center">
              <Link
                href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                已有账号？返回登录
              </Link>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  )
}
