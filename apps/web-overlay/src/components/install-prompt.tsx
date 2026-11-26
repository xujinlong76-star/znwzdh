'use client'

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Download, X } from "lucide-react"
import {
  INSTALL_DISMISS_KEY,
  INSTALL_VISIT_KEY,
  bumpVisitCount,
  installDismissedUntil,
  isIOSUserAgent,
  parseVisitCount,
  shouldOfferInstall,
  shouldOfferIosManualInstall,
} from "@/lib/install-prompt"
import { isStandalonePwa } from "@/lib/platform"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}
export function InstallPrompt() {
  const pathname = usePathname()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  /**
   * U-366：iOS 手动安装卡。iOS Safari 从不触发 beforeinstallprompt，
   * deferred 恒 null、原生卡恒不出现；iOS 分支改走两步手动卡
   * （分享 → 添加到主屏幕），门槛与节流与原生卡同一套。
   * 原生事件优先：deferred 非空时不展示手动卡。
   */
  const [iosManualVisible, setIosManualVisible] = useState(false)
  // 仅在首页按访问阈值接管安装横幅：管理后台、插件详情（/marketplace/*）、投稿表单（/submit）、
  // 登录页（/auth/*）等专注子页不拦截 beforeinstallprompt，避免打断当前任务并消除浏览器
  // "Banner not shown: beforeinstallpromptevent.preventDefault() called" 告警。
  const isHomeRoute = pathname === "/"

  useEffect(() => {
    if (!isHomeRoute) return
    try {
      const counted = sessionStorage.getItem("navhub:install-counted")
      const visitsRaw = localStorage.getItem(INSTALL_VISIT_KEY)
      const visits = counted ? parseVisitCount(visitsRaw) : bumpVisitCount(visitsRaw)
      if (!counted) {
        localStorage.setItem(INSTALL_VISIT_KEY, String(visits))
        sessionStorage.setItem("navhub:install-counted", "1")
      }
      const dismissedUntil = Number(localStorage.getItem(INSTALL_DISMISS_KEY) ?? 0)
      // 统一走 lib/platform 的 isStandalonePwa：它同时认 standalone、fullscreen 与 iOS navigator.standalone。
      // 此前这里内联只判 "(display-mode: standalone)"，漏掉 fullscreen ——
      // 「装到主屏后以全屏方式打开」会被误判成未安装，反复弹出安装横幅。
      const standalone = isStandalonePwa()
      const offer = (canPrompt: boolean) =>
        setVisible(shouldOfferInstall({ visits, dismissedUntil, now: Date.now(), standalone, canPrompt }))
      // U-366：iOS 上 beforeinstallprompt 永不触发，offer(false) 恒 false；
      // 另算手动卡：iOS + 未 standalone + 访问 ≥3 次 + 关闭期满。
      const isIOS =
        typeof window !== 'undefined' &&
        isIOSUserAgent(window.navigator.userAgent, window.navigator.maxTouchPoints ?? 0)
      setIosManualVisible(
        shouldOfferIosManualInstall({ visits, dismissedUntil, now: Date.now(), standalone, isIOS }),
      )

      const onPrompt = (e: Event) => {
        // 仅当用户真正满足展示安装横幅资格时，才 preventDefault 并接管提示；
        // 避免在不满足展示条件时盲目 preventDefault 导致浏览器抛出 "Banner not shown: preventDefault called" 告警
        const canOffer = shouldOfferInstall({ visits, dismissedUntil, now: Date.now(), standalone, canPrompt: true })
        if (!canOffer) return
        e.preventDefault()
        const promptEvent = e as BeforeInstallPromptEvent
        window.__navhubInstallPrompt = promptEvent
        window.dispatchEvent(new CustomEvent("navhub:install-available"))
        setDeferred(promptEvent)
        offer(true)
      }
      const onInstalled = () => {
        setVisible(false)
        setDeferred(null)
        window.__navhubInstallPrompt = undefined
        localStorage.removeItem(INSTALL_VISIT_KEY)
      }
      window.addEventListener("beforeinstallprompt", onPrompt)
      window.addEventListener("appinstalled", onInstalled)
      offer(false)
      return () => {
        window.removeEventListener("beforeinstallprompt", onPrompt)
        window.removeEventListener("appinstalled", onInstalled)
      }
    } catch {
      // 隐私模式 / 存储被禁用：安装提示是增强，不阻断页面
    }
  }, [isHomeRoute])

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    try {
      if (choice.outcome === "accepted") {
        localStorage.removeItem(INSTALL_VISIT_KEY)
      } else {
        localStorage.setItem(INSTALL_DISMISS_KEY, String(installDismissedUntil(Date.now())))
      }
    } catch {
      // 存储访问受限时不影响提示隐藏
    }
    setVisible(false)
    setDeferred(null)
  }

  const later = () => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(installDismissedUntil(Date.now())))
    } catch {
      // 存储访问受限时不影响提示隐藏
    }
    setVisible(false)
  }

  /** U-366：手动卡关闭复用同一把关闭节流钥匙（INSTALL_DISMISS_KEY，14 天）。 */
  const dismissIosManual = () => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(installDismissedUntil(Date.now())))
    } catch {
      // 存储访问受限时不影响提示隐藏
    }
    setIosManualVisible(false)
  }

  // U-366：iOS 两步手动卡。iOS Safari 没有原生安装弹窗，只能教用户手动装：
  // 第 1 步点 Safari 底部的「分享」按钮，第 2 步选「添加到主屏幕」。
  // 原生事件优先：deferred 非空时走原生卡，不展示手动卡。
  if (iosManualVisible && !deferred) {
    return (
      <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[80] sm:left-auto sm:right-4 sm:max-w-sm">
        <div className="rounded-xl border border-border/80 bg-background/95 p-3.5 shadow-lg backdrop-blur">
          <div className="flex items-start gap-2.5">
            <Download className="mt-0.5 h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">把山羊胡装到主屏幕</p>
              <p className="mt-0.5 text-xs text-muted-foreground">iPhone 不支持一键安装，手动两步即可，像 App 一样打开：</p>
              <ol className="mt-2 space-y-1 text-xs text-muted-foreground list-none">
                <li><span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">1</span>点 Safari 底部工具栏的「分享」按钮</li>
                <li><span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">2</span>在分享菜单里选择「添加到主屏幕」</li>
              </ol>
              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={dismissIosManual} className="rounded-md bg-primary min-h-11 px-4 py-2 text-xs font-medium text-primary-foreground">知道了</button>
                <button onClick={dismissIosManual} className="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground">稍后</button>
              </div>
            </div>
            <button onClick={dismissIosManual} aria-label="关闭安装提示" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    )
  }

  if (!visible || !deferred) return null

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[80] sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="rounded-xl border border-border/80 bg-background/95 p-3.5 shadow-lg backdrop-blur">
        <div className="flex items-start gap-2.5">
          <Download className="mt-0.5 h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">把山羊胡装到桌面</p>
            <p className="mt-0.5 text-xs text-muted-foreground">像 App 一样打开，离线也能看最近访问。</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button onClick={install} className="rounded-md bg-primary min-h-11 px-4 py-2 text-xs font-medium text-primary-foreground">安装</button>
              <button onClick={later} className="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground">稍后</button>
            </div>
          </div>
          <button onClick={later} aria-label="关闭安装提示" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )
}
