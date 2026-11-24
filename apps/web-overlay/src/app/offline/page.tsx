import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, CloudOff, WifiOff } from "lucide-react"
import { OfflineContent } from "@/components/offline-content"

// 自愈周期（ISR 3600s）：本页是静态外壳（数据都在客户端）。缺 NAVHUB_SITE_URL 的
// 构建会把 http://localhost:3000 兜底地址（canonical/og:url/og:image/JSON-LD）烤进
// revalidate=false 的永久快照，被 check-isr-routes.mjs 判红；按门禁提示「给它 revalidate」
// 补一份自愈周期即可。生产配置了 NAVHUB_SITE_URL 时地址本就正确，行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: "离线阅读",
  description: "断网时也能打开最近访问的站点",
  robots: { index: false, follow: true },
}

export default function OfflinePage() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:py-10">
      {/* 展板（对齐市场轮展板语言） */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-56 h-56 bg-sky-400/10 rounded-full blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-44 h-44 bg-emerald-400/10 rounded-full blur-3xl" />
        <CloudOff
          aria-hidden
          strokeWidth={1}
          className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
        />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回主页</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-muted-foreground">断网也能看</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20 shadow-xs">
              <WifiOff className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <span>离线阅读</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            最近在山羊胡打开过的站点会保存在本机。断网时这里仍可查看。
          </p>
          <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-500/25 bg-sky-500/5 text-xs text-sky-700 dark:text-sky-400">
              <CloudOff className="w-3 h-3" />
              本机快照
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
              不占云端 · 可随时清空
            </span>
          </div>
        </div>
      </div>

      <OfflineContent />
    </main>
  )
}
