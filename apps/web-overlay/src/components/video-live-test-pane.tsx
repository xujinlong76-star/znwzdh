'use client'

import React, { useState } from 'react'
import {
  runLiveCodeTest,
  type TestSuiteResult,
} from '@/lib/video-live-test-runner'
import { Button } from '@/registry/new-york/ui/button'
import { CheckCircle2, XCircle, Play, RotateCcw, Terminal, Code2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoLiveTestPaneProps {
  initialCode?: string
  chapterTitle?: string
}

const DEFAULT_USER_CODE = `// 请补全核心算法：实现二分查找或求数组最大连续和
function findMaxSubArray(nums) {
  let maxSum = nums[0] || 0;
  let currentSum = 0;
  for (let x of nums) {
    currentSum = Math.max(x, currentSum + x);
    maxSum = Math.max(maxSum, currentSum);
  }
  return maxSum;
}

// 导出待测函数
exports.findMaxSubArray = findMaxSubArray;
`

export function VideoLiveTestPane({
  initialCode = DEFAULT_USER_CODE,
  chapterTitle = '核心算法实战',
}: VideoLiveTestPaneProps) {
  const [code, setCode] = useState<string>(initialCode)
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [result, setResult] = useState<TestSuiteResult | null>(null)

  const handleRunTests = async () => {
    setIsRunning(true)

    const testCases = [
      {
        id: 'tc-1',
        title: '基础连续正负数组最大和验证',
        testFn: ({ expect }: any) => {
          // Eval user function
          const fn = new Function(`${code}; return exports.findMaxSubArray;`)()
          expect(typeof fn).toBe('function')
          expect(fn([-2, 1, -3, 4, -1, 2, 1, -5, 4])).toBe(6)
        },
      },
      {
        id: 'tc-2',
        title: '全负数数组边界保护',
        testFn: ({ expect }: any) => {
          const fn = new Function(`${code}; return exports.findMaxSubArray;`)()
          expect(fn([-5, -3, -8, -1, -9])).toBe(-1)
        },
      },
      {
        id: 'tc-3',
        title: '单元素极端场景断言',
        testFn: ({ expect }: any) => {
          const fn = new Function(`${code}; return exports.findMaxSubArray;`)()
          expect(fn([42])).toBe(42)
        },
      },
    ]

    try {
      const res = await runLiveCodeTest(`${chapterTitle} 课后 TDD 单元测试集`, code, testCases)
      setResult(res)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Code2 className="w-4 h-4 text-emerald-400" />
          <span>交互式 TDD 单元测试沙箱</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 gap-1"
            onClick={() => setCode(initialCode)}
            title="重置代码"
          >
            <RotateCcw className="w-3 h-3" /> 重置
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs px-2.5 gap-1 font-semibold"
            onClick={handleRunTests}
            disabled={isRunning}
          >
            <Play className="w-3 h-3" /> {isRunning ? '测试中...' : '运行测试'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden font-mono text-xs">
        <textarea aria-label="实时测试代码"
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          rows={9}
          className="w-full p-2.5 bg-transparent border-0 resize-none focus:outline-none leading-relaxed text-foreground font-mono"
        />
      </div>

      {result && (
        <div className="space-y-2 p-3 rounded-lg border border-border/50 bg-card">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">{result.suiteTitle}</span>
            <div className="flex items-center gap-2 font-mono">
              <span className="text-emerald-400 font-bold">
                ✓ {result.passedCount} 通过
              </span>
              {result.failedCount > 0 && (
                <span className="text-rose-400 font-bold">
                  ✗ {result.failedCount} 失败
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                ({result.durationMs}ms)
              </span>
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            {result.cases.map(c => (
              <div
                key={c.id}
                className={cn(
                  'p-2 rounded-md border flex items-start gap-2 text-xs',
                  c.status === 'passed'
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-foreground'
                    : 'border-rose-500/30 bg-rose-500/5 text-rose-300'
                )}
              >
                {c.status === 'passed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.durationMs}ms
                    </span>
                  </div>
                  {c.error && (
                    <p className="font-mono text-[11px] text-rose-400 leading-snug break-all">
                      {c.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
