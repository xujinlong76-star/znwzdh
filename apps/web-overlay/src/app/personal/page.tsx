import type { Metadata } from "next"
import { PersonalDataPage } from "@/components/personal-data-page"

/**
 * 「我的数据与隐私」页（2026-11-20 20:00 战略研究 W9 落地）。
 * 纯本地页：说明文案 + 存储用量 + 导出/导入/清除入口，不登录、不联网。
 */
export const metadata: Metadata = {
  title: "我的数据与隐私",
  description: "「我的常用」的数据只在你的浏览器里：查看本地用量、导出备份、导入恢复、一键清除。",
  robots: { index: false, follow: true },
}

export default function PersonalPage() {
  return (
    <main id="main-content" className="min-h-screen">
      <PersonalDataPage />
    </main>
  )
}
