import { Metadata } from 'next'
import { AlgorithmLab } from '@/components/algorithm-lab'
import { Footer } from '@/components/footer'

export const metadata: Metadata = {
  title: '前沿自适应算法实验室 - NavHub 4.0+',
  description: '探索并交互式体验 LinUCB 多臂老虎机融合、Poincaré 双曲几何平替推演、Shannon 文本熵防软 404 及 0-RTT 意图预执行引擎。',
}

export default function AlgorithmsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1">
        <AlgorithmLab />
      </div>
      <Footer />
    </div>
  )
}
