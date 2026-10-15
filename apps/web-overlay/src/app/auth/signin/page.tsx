'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Icons } from "@/components/icons"
import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ShieldCheck, KeyRound, ArrowLeft, AlertCircle, Sparkles, Lock, User } from 'lucide-react'

function SignInContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const callbackUrl = searchParams?.get('callbackUrl') || '/admin'
  const urlError = searchParams?.get('error')

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isBypassLoading, setIsBypassLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [availableProviders, setAvailableProviders] = useState<string[]>([])

  // 检测可用的登录方式
  useEffect(() => {
    fetch('/api/auth/providers')
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        setAvailableProviders(Object.keys(data || {}))
      })
      .catch(() => {
        setAvailableProviders(['credentials'])
      })
  }, [])

  // 映射 URL 传来的 NextAuth 错误代码
  useEffect(() => {
    if (!urlError) return
    if (urlError === 'CredentialsSignin') {
      setErrorMessage('管理员账号密码或 Token 不匹配，请重试')
    } else if (urlError === 'AccessDenied') {
      setErrorMessage('该账号不在管理员白名单 (NAVHUB_ADMIN_IDS) 中，无法访问后台')
    } else if (urlError === 'OAuthSignin' || urlError === 'OAuthCallbackError') {
      setErrorMessage('GitHub OAuth 登录遇到错误，请检查应用配置或改用管理密码登录')
    } else {
      setErrorMessage('登录失败，请重试或检查后台配置')
    }
  }, [urlError])

  // 1. 凭证登录（密码 / Token）
  const handleCredentialsSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setIsLoading(true)
    try {
      const res = await signIn('credentials', {
        username: username.trim() || 'admin',
        password: password.trim(),
        callbackUrl,
        redirect: false,
      })

      if (res?.error) {
        setErrorMessage('密码或 Token 凭证错误，请重新输入（默认口令为 admin123 或留空快捷进入）')
        setIsLoading(false)
      } else if (res?.ok) {
        window.location.href = callbackUrl
      } else {
        setIsLoading(false)
      }
    } catch (err) {
      setIsLoading(false)
      setErrorMessage('登录服务连接失败，请稍后重试')
      console.error('Credentials signin error:', err)
    }
  }

  // 2. 本地开发 / 免密环境一键快捷进入
  const handleBypassSignIn = async () => {
    setErrorMessage(null)
    setIsBypassLoading(true)
    try {
      const res = await signIn('credentials', {
        bypass: 'true',
        username: 'admin',
        password: '',
        callbackUrl,
        redirect: false,
      })

      if (res?.ok) {
        window.location.href = callbackUrl
      } else {
        setIsBypassLoading(false)
        setErrorMessage(res?.error || '本地快捷登录未启用，请输入管理密码')
      }
    } catch (err) {
      setIsBypassLoading(false)
      setErrorMessage('快捷登录失败，请尝试密码登录')
      console.error('Bypass login error:', err)
    }
  }

  // 3. GitHub OAuth 登录
  const handleGithubSignIn = async () => {
    setErrorMessage(null)
    setIsLoading(true)
    try {
      await signIn('github', {
        callbackUrl,
        redirect: true,
      })
    } catch (error) {
      setIsLoading(false)
      setErrorMessage('无法唤起 GitHub 授权登录，请检查网络或使用密码登录')
      console.error('GitHub 登录失败:', error)
    }
  }

  const hasGithub = availableProviders.includes('github')

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2 bg-background">
      {/* 左侧品牌展示 */}
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex select-none">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="relative w-8 h-8 overflow-hidden rounded-lg border border-white/20 shadow-md">
              <img
                src="/assets/images/alogo.webp"
                alt="NavSphere Logo"
                className="object-cover w-full h-full"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold leading-none tracking-tight text-white">
                NavSphere
              </span>
              <span className="text-[11px] text-zinc-400 mt-0.5 tracking-wider uppercase font-semibold">
                Control Center
              </span>
            </div>
          </Link>
        </div>
        <div className="relative z-20 my-auto max-w-md space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>安全管理控制台</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-zinc-100">
            统一导航架构与中枢管理
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            支持基于密码凭证、API Token 以及 GitHub 账号的统一多模态身份认证，保障站点配置、数据审计与资产运维安全。
          </p>
        </div>
        <div className="relative z-20 mt-auto pt-6 border-t border-white/10 flex items-center justify-between text-xs text-zinc-400">
          <span>&copy; {new Date().getFullYear()} NavSphere Team</span>
          <Link href="/" className="inline-flex items-center gap-1 hover:text-white transition-colors">
            <ArrowLeft className="w-3 h-3" />
            返回前台首页
          </Link>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex flex-col justify-center items-center p-4 sm:p-8">
        <div className="mx-auto flex w-full max-w-[390px] flex-col justify-center space-y-6">
          {/* 移动端展示 Logo */}
          <div className="flex lg:hidden flex-col items-center gap-2 mb-2 text-center">
            <div className="relative w-10 h-10 overflow-hidden rounded-xl border border-border shadow-md">
              <img
                src="/assets/images/alogo.webp"
                alt="Logo"
                className="object-cover w-full h-full"
              />
            </div>
            <span className="text-xl font-bold tracking-tight">NavSphere 管理后台</span>
          </div>

          <Card className="border-border/70 shadow-lg backdrop-blur-sm">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-xl sm:text-2xl text-center font-bold tracking-tight">
                登录管理后台
              </CardTitle>
              <CardDescription className="text-center text-xs sm:text-sm">
                请验证管理员凭证以访问系统控制台
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-0">
              {errorMessage && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs leading-snug animate-in fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">{errorMessage}</div>
                </div>
              )}

              <Tabs defaultValue="credentials" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="credentials" className="text-xs">
                    <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                    管理员密码
                  </TabsTrigger>
                  <TabsTrigger value="github" className="text-xs">
                    <Icons.github className="w-3.5 h-3.5 mr-1.5" />
                    GitHub 账号
                  </TabsTrigger>
                </TabsList>

                {/* 密码/Token 登录面板 */}
                <TabsContent value="credentials" className="space-y-3 mt-0">
                  <form onSubmit={handleCredentialsSignIn} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-xs font-medium flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        管理身份
                      </Label>
                      <Input
                        id="username"
                        type="text"
                        placeholder="admin"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={isLoading || isBypassLoading}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password" className="text-xs font-medium flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                          密码或 Token
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                          支持管理密码 / API Token
                        </span>
                      </div>
                      <Input
                        id="password"
                        type="password"
                        placeholder="输入管理口令 (默认 admin123)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading || isBypassLoading}
                        className="h-9 text-xs"
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-9 text-xs font-medium"
                      disabled={isLoading || isBypassLoading}
                    >
                      {isLoading ? (
                        <>
                          <Icons.spinner className="mr-2 h-3.5 w-3.5 animate-spin" />
                          验证凭证中...
                        </>
                      ) : (
                        <>
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                          登 录
                        </>
                      )}
                    </Button>
                  </form>

                  {/* 本地快捷登录按钮 */}
                  <div className="relative my-3">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        本地单机 / 开发调试通道
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBypassSignIn}
                    className="w-full h-8 text-xs border-dashed border-primary/40 text-primary hover:bg-primary/10 gap-1.5"
                    disabled={isLoading || isBypassLoading}
                  >
                    {isBypassLoading ? (
                      <>
                        <Icons.spinner className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        正在进入...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        以管理员身份一键进入 (快捷通道)
                      </>
                    )}
                  </Button>
                </TabsContent>

                {/* GitHub OAuth 面板 */}
                <TabsContent value="github" className="space-y-3 mt-0">
                  {hasGithub ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        使用经系统授权的 GitHub 账号快速登录，登录后将校验是否命中管理员白名单。
                      </p>
                      <Button
                        onClick={handleGithubSignIn}
                        className="w-full h-9 bg-[#24292F] hover:bg-[#24292F]/90 text-white text-xs font-medium"
                        disabled={isLoading || isBypassLoading}
                      >
                        {isLoading ? (
                          <>
                            <Icons.spinner className="mr-2 h-3.5 w-3.5 animate-spin" />
                            正在跳转 GitHub 授权...
                          </>
                        ) : (
                          <>
                            <Icons.github className="mr-2 h-3.5 w-3.5" />
                            GitHub 账号快捷登录
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 p-3.5 rounded-lg bg-muted/40 border border-border/70 text-xs">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                        <span>未配置 GitHub OAuth</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        当前环境未配置 <code className="text-xs bg-muted px-1 py-0.5 rounded">GITHUB_CLIENT_ID</code> 与 <code className="text-xs bg-muted px-1 py-0.5 rounded">GITHUB_CLIENT_SECRET</code>，请切换至「管理员密码」标签登录，或点击快捷通道进入。
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleBypassSignIn}
                        className="w-full h-8 text-xs mt-1"
                      >
                        使用本地快捷通道登录
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>

            <CardFooter className="flex flex-col gap-2 pt-2 border-t border-border/50 text-center">
              <Link
                href="/"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                返回网站首页
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Icons.spinner className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs font-medium">加载登录页面...</span>
          </div>
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  )
}