import { Metadata } from 'next'
import { EcosystemGraph } from '@/components/ecosystem-graph'

export const metadata: Metadata = {
  title: '技术生态与平替拓扑图谱 - NavHub',
  description: '全景交互式探索前端、AI、全栈开发与设计工具链生态，发现开源与高性价比替代方案。',
}

export default function GraphPage() {
  return <EcosystemGraph />
}
