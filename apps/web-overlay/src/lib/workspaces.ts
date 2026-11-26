/**
 * 工作区定义（纯数据层，与 WorkspaceFilter 组件分离）。
 *
 * 为什么单独抽出来（U-358 首屏包体积）：
 * 首页胶囊行（HomeCapsuleRow）只用 WORKSPACES 这一份数据，但它之前只能从
 * `@/components/workspace-filter` 拿——于是首屏静态 import 图里多带了整段
 * `WorkspaceFilter` 组件体（约 5.6KB 源码，含长串 Tailwind 类名与键盘漫游），
 * 而该组件在首屏早已被 HomeCapsuleRow 取代、没有任何挂载点。数据抽到这里后，
 * 首屏图里只剩本文件；workspace-filter.tsx 已随 B5（2026-11-27）删除，
 * 不再 re-export WORKSPACES——本文件就是 WORKSPACES 的唯一来源
 * （home-capsule-row 等旧导入方改从这里取）。数据本身逐字照搬，不改任何 id / 文案 / 图标。
 */
import type { ComponentType } from 'react'
import { Bot, Code2, Coffee, Compass, Palette } from 'lucide-react'
import type { DaypartWorkspaceId } from '@/lib/daypart'

export type WorkspaceId = DaypartWorkspaceId

export interface WorkspaceConfig {
  id: WorkspaceId
  label: string
  icon: ComponentType<{ className?: string }>
  desc: string
}

export const WORKSPACES: WorkspaceConfig[] = [
  { id: 'all', label: '全部探索', icon: Compass, desc: '全库漫游' },
  { id: 'dev', label: '研发全栈', icon: Code2, desc: '开发/部署/代码/API' },
  { id: 'design', label: 'UI & 设计', icon: Palette, desc: '素材/图标/画板/灵感' },
  { id: 'ai', label: 'AI 实验室', icon: Bot, desc: '大模型/代码助手/绘画' },
  { id: 'efficiency', label: '效率创作', icon: Coffee, desc: '知识库/协作/在线工具' },
]
