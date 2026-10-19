import type { Metadata } from "next"
import { OfflineRecentList } from "@/components/offline-recent-list"

export const metadata: Metadata = {
  title: "离线阅读",
  description: "断网时也能打开最近访问的站点",
}

export default function OfflinePage() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">离线阅读</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        最近在 NavHub 打开过的站点会保存在本机。断网时这里仍可查看。
      </p>
      <OfflineRecentList />
    </main>
  )
}
