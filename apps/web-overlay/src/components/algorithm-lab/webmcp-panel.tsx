'use client'

/**
 * 算法 8：端侧 WebMCP 运行态网桥。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/registry/new-york/ui/tabs'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Cpu,
  Orbit,
  ShieldCheck,
  ShieldAlert,
  Zap,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
  CheckCircle2,
  Layers,
  ArrowLeft,
  Lock,
  Unlock,
  Network,
  Palette,
  Bot,
  Send,
  Radio,
  Share2,
  Wrench,
  Sliders,
  Activity,
} from 'lucide-react'
import Link from 'next/link'
import {
  parseSpeculativeIntent,
} from '@/lib/speculative'
import {
  encryptVault,
  decryptVault,
  type EncryptedVaultPayload,
  type VaultItem,
} from '@/lib/vault'
import {
  findShortestTechPath,
  analyzeStackCompatibility,
  PRESET_TECH_GRAPH,
} from '@/lib/knowledge-graph'
import {
  analyzeVisualFingerprint,
} from '@/lib/visual-fingerprint'
import {
  getWebMcpBridge,
  type JsonRpcResponse,
} from '@/lib/webmcp-bridge'
import {
  privatizeVector,
  rankItemsWithPrivacy,
  type CandidateItem,
} from '@/lib/federated-recommendation'
import {
  compileSpeculationRules,
  renderSpeculationRulesScript,
  generateFallbackLinkTags,
  type SpeculationCandidate,
} from '@/lib/speculative-prerender'
import {
  isSafeUrl,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  parseOpenApiToSpecs,
} from '@/lib/dynamic-tool-synthesizer'
import {
  CrdtStore,
  compareVectorClocks,
  type VectorClock,
} from '@/lib/crdt-sync'

// 时间取值收敛到模块作用域：把 impure 调用留在组件体外，
// 避免 react-hooks/purity 判为渲染期副作用。

// 时间取值收敛到模块作用域：调用点都在事件处理器里，但把 impure 调用
// 留在组件体内会被 react-hooks/purity 判为渲染期副作用。
const nowMs = () => Date.now()
const perfNow = () => performance.now()

export function WebMcpPanel() {
  /* --- 模块 8：端侧 WebMCP 网桥状态 --- */
  const [mcpToolName, setMcpToolName] = useState('navhub_system_info')
  const [mcpArgMsg, setMcpArgMsg] = useState('Hello from NavHub In-Browser Agent!')
  const [mcpResponse, setMcpResponse] = useState<JsonRpcResponse | null>(null)
  const [mcpLatency, setMcpLatency] = useState<number | null>(null)

  const handleRunMcpTool = async (tool: string) => {
    const bridge = getWebMcpBridge()
    const t0 = perfNow()
    const args = tool === 'navhub_echo' ? { message: mcpArgMsg } : {}
    const res = await bridge.handleRpc({
      jsonrpc: '2.0',
      id: nowMs(),
      method: 'tools/call',
      params: { name: tool, arguments: args },
    })
    const elapsed = Math.round(perfNow() - t0)
    setMcpResponse(res)
    setMcpLatency(elapsed)
  }

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <Bot className="w-4 h-4" />
                    </div>
                    <span>浏览器端端侧 WebMCP JSON-RPC 2.0 通信总线</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    为端侧 AI Agent、浏览器扩展及 Chrome Built-in AI 提供原生的 Model Context Protocol 协议交互入口，在浏览器内零网络开销执行本地工具。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/5 text-xs font-mono">
                  JSON-RPC 2.0
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {/* 工具调用快速触发面板 */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-muted-foreground">选择端侧 MCP 工具并执行：</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { tool: 'navhub_system_info', label: '查询系统能力 (navhub_system_info)' },
                    { tool: 'navhub_echo', label: '测试回显通道 (navhub_echo)' },
                  ].map((item) => (
                    <Button
                      key={item.tool}
                      size="sm"
                      variant={mcpToolName === item.tool ? 'default' : 'outline'}
                      onClick={() => {
                        setMcpToolName(item.tool)
                        handleRunMcpTool(item.tool)
                      }}
                      className={`text-xs h-8 px-3.5 rounded-lg transition-all ${
                        mcpToolName === item.tool ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'border-border/60 hover:border-emerald-500/40'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5 mr-1.5" />
                      {item.label}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const bridge = getWebMcpBridge()
                      const t0 = performance.now()
                      const res = await bridge.handleRpc({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' })
                      setMcpResponse(res)
                      setMcpLatency(Math.round(performance.now() - t0))
                    }}
                    className="text-xs h-8 px-3.5 rounded-lg border-border/60 hover:border-emerald-500/40"
                  >
                    列出所有工具 (tools/list)
                  </Button>
                </div>
              </div>

              {mcpToolName === 'navhub_echo' && (
                <div className="flex gap-2 items-center">
                  <Input aria-label="输入要发送给 WebMCP 的 Echo 消息"
                    value={mcpArgMsg}
                    onChange={(e) => setMcpArgMsg(e.target.value)}
                    placeholder="输入要发送给 WebMCP 的 Echo 消息..."
                    className="text-xs h-9"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleRunMcpTool('navhub_echo')}
                    className="text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                  >
                    <Send className="w-3.5 h-3.5" /> 发送
                  </Button>
                </div>
              )}

              {/* 实时响应结果 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-emerald-500 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    JSON-RPC 2.0 运行态响应结果：
                  </span>
                  {mcpLatency !== null && (
                    <span className="font-mono text-muted-foreground text-[11px]">
                      端侧耗时：<span className="text-emerald-500 font-bold">{mcpLatency} ms</span>
                    </span>
                  )}
                </div>
                <pre className="p-3.5 rounded-lg bg-background border border-border/50 text-[11px] font-mono overflow-x-auto text-foreground/90 max-h-60">
                  {mcpResponse ? JSON.stringify(mcpResponse, null, 2) : '// 点击上方工具按钮，实时在浏览器端执行 JSON-RPC 2.0 协议交互'}
                </pre>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
