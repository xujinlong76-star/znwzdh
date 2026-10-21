import { Metadata } from 'next'
import { AlgorithmLab } from '@/components/algorithm-lab'
import { Footer } from '@/components/footer'

/** 标题只写页面名，站点名由根 layout 的 title.template 追加（避免品牌名重复两次） */
export const metadata: Metadata = {
  title: '前沿自适应算法实验室',
  description: '探索并交互式体验 LinUCB 多臂老虎机融合、Poincaré 双曲几何平替推演、Shannon 文本熵防软 404 及 0-RTT 意图预执行引擎。',
  alternates: { canonical: '/algorithms' },
  openGraph: { url: '/algorithms' },
}

export default function AlgorithmsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <main id="main-content" className="flex-1">
        <AlgorithmLab />
      </main>
      <Footer />
    </div>
  )
}
