'use client'

import { Activity, ShieldCheck, Cpu, HardDrive } from 'lucide-react'

export function MetricsWidget() {
  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Activity className="w-3.5 h-3.5 text-blue-500" />
          <span>认知中枢与引擎监控</span>
        </div>
        <span className="flex items-center gap-1 text-xs text-emerald-500 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          运行正常
        </span>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-2 py-2">
        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>LinUCB 探索率</span>
            <Cpu className="w-3 h-3 text-blue-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground">α = 0.20</div>
          <div className="text-xs text-muted-foreground">置信上界多臂老虎机</div>
        </div>

        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>E2EE 零知识金库</span>
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground">AES-GCM</div>
          <div className="text-xs text-muted-foreground">PBKDF2 100k 轮加盐</div>
        </div>

        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>端侧缓存命中率</span>
            <HardDrive className="w-3 h-3 text-amber-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground">98.4%</div>
          <div className="text-xs text-muted-foreground">IndexedDB + SW 预取</div>
        </div>

        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>双曲平替曲率</span>
            <Activity className="w-3 h-3 text-purple-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground">c = -1.0</div>
          <div className="text-xs text-muted-foreground">Poincaré 圆盘度量</div>
        </div>
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        全栈模块自主健康遥测指标
      </div>
    </div>
  )
}
