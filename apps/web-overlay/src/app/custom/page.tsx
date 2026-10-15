import { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { ModularCanvasClient } from '@/components/modular/modular-canvas-client'
import { Footer } from '@/components/footer'
import Link from 'next/link'
import { ArrowLeft, LayoutGrid, Sparkles, Move, Maximize2, ShieldCheck } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

export const metadata: Metadata = {
  title: '模块化自定义工作台 - NavHub 4.0+',
  description: '全响应式 12 栅格模块化页面系统，支持鼠标自由拖拽换位、双轴尺寸缩放、独立小组件即插即用与本地静止持久化。',
}

export default function CustomPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <main className="flex-1 py-6 sm:py-8">
        <Container className="space-y-6">
          {/* 顶部 Hero 展板 */}
          <div className="relative overflow-hidden rounded-2xl border border-border/80 p-6 sm:p-8 glass-surface subtle-mesh shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Link href="/">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-background/80 border border-border/50 gap-1.5 transition-all"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>返回主页</span>
                    </Button>
                  </Link>
                  <span className="text-xs text-muted-foreground">/ 模块化排版系统</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground flex items-center gap-2.5">
                  <LayoutGrid className="w-6 h-6 text-primary shrink-0" />
                  <span>模块化自定义工作台</span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
                  页面由多个独立功能模块组成。支持开启编辑后通过鼠标自由拖拽模块位置、横向及纵向缩放尺寸，并在移动端、平板与宽屏桌面间平滑自适应。
                </p>
              </div>

              {/* 架构特性指标胶囊 */}
              <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-1.5 shrink-0">
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  <Move className="w-3.5 h-3.5" />
                  <span>鼠标自由拖拽换位</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-medium">
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>12 栅格无级缩放</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>独立沙箱 · 本地持久化</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>支持 Ctrl+Z 历史撤销</span>
                </span>
              </div>
            </div>
          </div>

          {/* 模块化排版核心画布 */}
          <ModularCanvasClient />
        </Container>
      </main>

      <Footer />
    </div>
  )
}
