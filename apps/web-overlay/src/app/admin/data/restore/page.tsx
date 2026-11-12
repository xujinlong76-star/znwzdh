'use client'

import dynamic from 'next/dynamic'

/**
 * 管理端冷备恢复页：整页是一个三步表单向导（选文件本地解析 → 预演 →
 * 确认执行，另含后台任务进度卡），首屏预算超 22 KB。
 *
 * 页内没有可单独拆出的重型子组件：Card / Button / Checkbox 都是全页共用
 * 的基础件，JobProgress 只在后台任务时出现但与主表单同文件。按
 * /admin/site 的既成做法（整页表单挪进异步 chunk，骨架先渲染）把整页
 * 移进 ./page.impl，首屏只留骨架；恢复是低频管理操作，表单 JS 后到无
 * 体验损失。
 */
const RestoreBackupImpl = dynamic(() => import('./page.impl').then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" aria-busy="true" aria-label="正在加载恢复冷备">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  ),
})

export default function RestoreBackupPage() {
  return <RestoreBackupImpl />
}
