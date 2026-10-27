'use client'

import React, { useState } from 'react'
import {
  runWasmSandbox,
  VirtualFS,
  type ExecutionResult,
} from '@/lib/video-wasm-runtime'
import { Button } from '@/registry/new-york/ui/button'
import { Play, RotateCcw, Terminal, Database, Code2, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoWasmTerminalPaneProps {
  initialLanguage?: 'python' | 'sql' | 'bash'
  initialCode?: string
  className?: string
}

export function VideoWasmTerminalPane({
  initialLanguage = 'bash',
  initialCode,
  className,
}: VideoWasmTerminalPaneProps) {
  const [vfs] = useState(() => new VirtualFS({
    'deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web-api',
    'config.json': '{\n  "port": 8080,\n  "debug": false\n}',
  }))

  const [lang, setLang] = useState<'python' | 'sql' | 'bash'>(initialLanguage)
  const [code, setCode] = useState(() => {
    if (initialCode) return initialCode
    if (initialLanguage === 'bash') {
      return '# 容器云原生调试命令演练\npwd\nls\ncat deployment.yaml\necho "Cluster verification completed"'
    } else if (initialLanguage === 'sql') {
      return 'CREATE TABLE services (id INT, name VARCHAR(50));\nSELECT * FROM services;'
    }
    return '# Python 自动化运维测试\nfor i in range(3):\n    print(f"Checking cluster health node-{i + 1}...")'
  })

  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<ExecutionResult | null>(null)

  const handleRun = async () => {
    setIsRunning(true)
    try {
      const res = await runWasmSandbox(code, lang, vfs)
      setResult(res)
    } finally {
      setIsRunning(false)
    }
  }

  const handleSwitchLanguage = (newLang: 'python' | 'sql' | 'bash') => {
    setLang(newLang)
    setResult(null)
    if (newLang === 'bash') {
      setCode('# 容器云原生调试命令演练\npwd\nls\ncat deployment.yaml\necho "Cluster verification completed"')
    } else if (newLang === 'sql') {
      setCode('CREATE TABLE services (id INT, name VARCHAR(50));\nSELECT * FROM services;')
    } else {
      setCode('# Python 自动化运维测试\nfor i in range(3):\n    print(f"Checking cluster health node-{i + 1}...")')
    }
  }

  return (
    <div className={cn("flex flex-col rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl text-xs", className)}>
      {/* Header with language picker */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/90 border-b border-zinc-800">
        <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span>WASM 极速容器运行环境</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => handleSwitchLanguage('bash')}
            className={cn("px-2 py-0.5 rounded text-[11px] font-mono transition-colors", lang === 'bash' ? "bg-emerald-500/20 text-emerald-300 font-bold" : "text-zinc-400 hover:text-zinc-200")}
          >
            Bash
          </button>
          <button
            onClick={() => handleSwitchLanguage('python')}
            className={cn("px-2 py-0.5 rounded text-[11px] font-mono transition-colors", lang === 'python' ? "bg-blue-500/20 text-blue-300 font-bold" : "text-zinc-400 hover:text-zinc-200")}
          >
            Python
          </button>
          <button
            onClick={() => handleSwitchLanguage('sql')}
            className={cn("px-2 py-0.5 rounded text-[11px] font-mono transition-colors", lang === 'sql' ? "bg-amber-500/20 text-amber-300 font-bold" : "text-zinc-400 hover:text-zinc-200")}
          >
            SQL
          </button>
        </div>
      </div>

      {/* Editor Textarea */}
      <div className="p-2 border-b border-zinc-900 bg-zinc-950">
        <textarea aria-label="终端代码输入"
          value={code}
          onChange={e => setCode(e.target.value)}
          rows={6}
          className="w-full bg-transparent font-mono text-[11px] text-zinc-100 resize-none focus:outline-none leading-relaxed"
          placeholder="在此输入需要执行的代码或命令..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-900 text-[11px]">
        <div className="flex items-center gap-1 text-zinc-500 font-mono text-[10px]">
          <Folder className="w-3 h-3" />
          <span>VFS 文件: {vfs.listFiles().join(', ')}</span>
        </div>

        <Button
          size="sm"
          className="h-6 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
          onClick={handleRun}
          disabled={isRunning}
        >
          <Play className="w-3 h-3 fill-current" />
          <span>{isRunning ? '执行中...' : '运行'}</span>
        </Button>
      </div>

      {/* Output Console */}
      <div className="p-3 bg-black font-mono text-[11px] min-h-[100px] max-h-[220px] overflow-y-auto leading-relaxed select-text">
        {result ? (
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 pb-1 border-b border-zinc-900 mb-1.5">
              <span className={result.success ? "text-emerald-400" : "text-red-400"}>
                {result.success ? '✔ 运行成功' : '✖ 运行异常'}
              </span>
              <span>耗时: {result.executionTimeMs}ms</span>
            </div>
            {result.stdout && <pre className="text-zinc-200 whitespace-pre-wrap">{result.stdout}</pre>}
            {result.stderr && <pre className="text-red-400 whitespace-pre-wrap pt-1">{result.stderr}</pre>}
          </div>
        ) : (
          <span className="text-zinc-600 italic">点击「运行」在客户端沙箱中即时执行并查看结果</span>
        )}
      </div>
    </div>
  )
}
