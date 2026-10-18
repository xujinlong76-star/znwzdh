import { Metadata } from 'next'
import { EcosystemGraph } from '@/components/ecosystem-graph'

/**
 * 标题只写页面名：站点名由根 layout 的 title.template 统一追加。
 * 这里再拼一次品牌名会渲染成「技术生态与平替拓扑图谱 - NavHub - NavHub」。
 */
export const metadata: Metadata = {
  title: '技术生态与平替拓扑图谱',
  description: '全景交互式探索前端、AI、全栈开发与设计工具链生态，发现开源与高性价比替代方案。',
}

export default function GraphPage() {
  return <EcosystemGraph />
}
