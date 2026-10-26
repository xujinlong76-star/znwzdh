'use client'

import { useEffect, useState } from "react"
import { Download, X } from "lucide-react"
import {
  INSTALL_DISMISS_KEY,
  INSTALL_VISIT_KEY,
  bumpVisitCount,
  installDismissedUntil,
  parseVisitCount,
  shouldOfferInstall,
} from "@/lib/install-prompt"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const counted = sessionStorage.getItem("navhub:install-counted")
      const visitsRaw = localStorage.getItem(INSTALL_VISIT_KEY)
      const visits = counted ? parseVisitCount(visitsRaw) : bumpVisitCount(visitsRaw)
      if (!counted) {
        localStorage.setItem(INSTALL_VISIT_KEY, String(visits))
        sessionStorage.setItem("navhub:install-counted", "1")
      }
      const dismissedUntil = Number(localStorage.getItem(INSTALL_DISMISS_KEY) ?? 0)
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
      const offer = (canPrompt: boolean) =>
        setVisible(shouldOfferInstall({ visits, dismissedUntil, now: Date.now(), standalone, canPrompt }))

      const onPrompt = (e: Event) => {
        e.preventDefault()
        setDeferred(e as BeforeInstallPromptEvent)
        offer(true)
      }
      const onInstalled = () => {
        setVisible(false)
        setDeferred(null)
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
  }, [])

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === "accepted") {
      localStorage.removeItem(INSTALL_VISIT_KEY)
    } else {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(installDismissedUntil(Date.now())))
    }
    setVisible(false)
    setDeferred(null)
  }

  const later = () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(installDismissedUntil(Date.now())))
    setVisible(false)
  }

  if (!visible || !deferred) return null

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[80] sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="rounded-xl border border-border/80 bg-background/95 p-3.5 shadow-lg backdrop-blur">
        <div className="flex items-start gap-2.5">
          <Download className="mt-0.5 h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">把 山羊胡装到桌面</p>
            <p className="mt-0.5 text-xs text-muted-foreground">像 App 一样打开，离线也能看最近访问。</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button onClick={install} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">安装</button>
              <button onClick={later} className="text-xs text-muted-foreground">稍后</button>
            </div>
          </div>
          <button onClick={later} aria-label="关闭安装提示" className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )
}
