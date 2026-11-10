'use client'

/**
 * 「设为首页」引导卡：按访客浏览器给出真实操作步骤 + 一键复制网址，
 * 支持 PWA 安装提示时优先给一键安装；设置完回来点「我已设置好了」
 * 领取一次性经验并开启 ×1.5 加速。
 *
 * 诚实约定（文案里也写明）：网页无法替用户修改浏览器主页，也无法
 * 检测他是否真的设置了——所以这是自述领取，奖励只放大他之后真实
 * 使用功能赚到的经验，不设假检测、不装成功动画骗人。
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, Home, Zap } from 'lucide-react'
import {
  BOOST_MULTIPLIER,
  GROWTH_UPDATED_EVENT,
  HOMEPAGE_CLAIM_XP,
  claimHomepage,
  loadGrowthProfile,
} from '@/lib/growth'
import { BROWSER_LABEL, detectBrowser, homepageSteps, type BrowserKind } from '@/lib/homepage-guide'
import { cn } from '@/lib/utils'

export function HomepageGuideCard({ compact = false }: { compact?: boolean }) {
  const [kind, setKind] = useState<BrowserKind>('unknown')
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [canInstall, setCanInstall] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [justClaimed, setJustClaimed] = useState(0)

  const refresh = useCallback(() => {
    setClaimed(loadGrowthProfile().homepageClaimedAt !== null)
  }, [])

  useEffect(() => {
    setKind(detectBrowser(navigator.userAgent))
    setOrigin(window.location.origin)
    setCanInstall(Boolean(window.__navhubInstallPrompt))
    refresh()
    const onInstall = () => setCanInstall(true)
    window.addEventListener('navhub:install-available', onInstall)
    window.addEventListener(GROWTH_UPDATED_EVENT, refresh)
    return () => {
      window.removeEventListener('navhub:install-available', onInstall)
      window.removeEventListener(GROWTH_UPDATED_EVENT, refresh)
    }
  }, [refresh])

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(origin)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用时用户可长按上方网址手动复制 */
    }
  }

  const install = async () => {
    const prompt = window.__navhubInstallPrompt
    if (!prompt) return
    try {
      await prompt.prompt()
    } catch {
      /* 用户取消安装不算错，图文步骤还在 */
    }
  }

  const claim = () => {
    const { gained } = claimHomepage()
    if (gained > 0) setJustClaimed(gained)
    refresh()
  }

  const steps = homepageSteps(kind)

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="把本站设为首页">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Home className="h-4 w-4 text-primary" aria-hidden />
          把本站设为首页，下次一键回来
        </h3>
        {claimed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Zap className="h-3 w-3" aria-hidden /> 经验加速 ×{BOOST_MULTIPLIER} 进行中
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            设置好可领 +{HOMEPAGE_CLAIM_XP} 经验并开启 ×{BOOST_MULTIPLIER} 加速
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        检测到你在用 {BROWSER_LABEL[kind]}。浏览器不让网页直接改主页设置，照下面 {steps.length} 步点一点就行：
      </p>

      <ol className={cn('mt-3 space-y-1.5 text-sm', compact && 'space-y-1')}>
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-muted px-2.5 py-1.5 text-sm">{origin || '本站网址'}</code>
        <button
          type="button"
          onClick={copyUrl}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:border-primary/50"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? '已复制' : '一键复制网址'}
        </button>
        {canInstall && (
          <button
            type="button"
            onClick={install}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            <Download className="h-4 w-4" aria-hidden /> 一键添加到主屏幕
          </button>
        )}
      </div>

      <div className="mt-4 border-t border-border/60 pt-3">
        {claimed ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" aria-hidden />
            已领取首页守护奖励，之后用功能赚的经验都会 ×{BOOST_MULTIPLIER}。
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={claim}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Home className="h-4 w-4" aria-hidden /> 我已设置好了，领取 +{HOMEPAGE_CLAIM_XP} 经验
            </button>
            {justClaimed > 0 && <span className="ml-2 text-sm font-medium text-primary">+{justClaimed} 经验到账！</span>}
            <p className="mt-2 text-xs text-muted-foreground">
              说句实话：网页没法替你检查浏览器设置有没有改好，所以这里靠你点一下确认；奖励放大的也只是你之后真实使用本站功能赚到的经验。
            </p>
          </>
        )}
      </div>
    </section>
  )
}
