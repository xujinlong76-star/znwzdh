'use client'

/**
 * 算法 4：0-RTT 推测性意图执行。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Badge } from '@/components/ui/badge'
import { Zap, Sparkles } from 'lucide-react'
import { parseSpeculativeIntent } from '@/lib/speculative'


export function IntentPanel() {
  /* --- 模块 4：推测意图测试 --- */
  const [intentInput, setIntentInput] = useState('SGVsbG8gV29ybGQ=')
  const intentResult = useMemo(() => parseSpeculativeIntent(intentInput), [intentInput])

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span>0-RTT 推测意图预执行试验台</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    搜索框不仅是跳板，而是微任务执行终点。键入代码短串时瞬间原地出结果，杜绝跳转摩擦。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/5 text-xs">
                  延迟 &lt; 1ms
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-muted-foreground">快速加载特征串测试：</label>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('SGVsbG8gV29ybGQ=')}>
                    Base64 串
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('1710328900')}>
                    Unix 时间戳
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('#ff4500')}>
                    HEX 色彩
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('(128 + 64) * 8')}>
                    算术表达式
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('{"site":"navhub","v":4}')}>
                    JSON 美化
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('e10adc3949ba59abbe56e057f20f883e')}>
                    MD5 哈希
                  </Button>
                </div>
                <Input aria-label="键入 Base64、时间戳、RGB/HEX、算术公式"
                  className="mt-2 font-mono text-sm h-10 border-border/70 focus-visible:ring-amber-500/40"
                  value={intentInput}
                  onChange={(e) => setIntentInput(e.target.value)}
                  placeholder="在此键入 Base64、时间戳、RGB/HEX、算术公式..."
                />
              </div>

              {/* 呈现推测执行卡片 */}
              {intentResult ? (
                <div className="p-4 sm:p-5 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent space-y-3.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-bold">{intentResult.title}</span>
                      <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10 font-mono px-2 py-0.5">
                        0-RTT 命中
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{intentResult.subtitle}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {intentResult.type === 'color' && (
                      <div
                        className="w-9 h-9 rounded-lg border border-border/60 shadow-inner shrink-0"
                        style={{ backgroundColor: intentResult.previewValue }}
                      />
                    )}
                    <div className="flex-1 p-3 rounded-lg bg-background border border-border/60 font-mono text-xs break-all select-all shadow-2xs">
                      {intentResult.previewValue}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl bg-muted/10">
                  当前输入暂未命中特定微任务语法，按回车将触发自适应多通道混合检索。
                </div>
              )}
            </CardContent>
          </Card>
    </div>
  )
}
