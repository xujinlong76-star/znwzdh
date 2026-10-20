'use client'

/**
 * 管理端：插件（网址包）可达性体检。
 *
 * 为什么单独一页而不是塞进「插件审核管理」：审核页是状态机操作台，
 * 体检是**外部可达性**的观测与复核，职责不同；拆开也避免与并发改动争同一个大文件。
 */

import { PluginUrlHealthPanel } from '@/components/plugins/plugin-url-health-panel'

export default function AdminPluginHealthPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">插件网址体检</h1>
        <p className="text-sm text-muted-foreground">
          对网址包声明清单里的 URL 抽样探活（未安装的包也能测），回答「这包里的网址是不是真的能用」。
        </p>
      </header>
      <PluginUrlHealthPanel />
    </div>
  )
}
