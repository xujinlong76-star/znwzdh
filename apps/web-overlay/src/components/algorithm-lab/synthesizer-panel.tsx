'use client'

/**
 * 算法 11：动态 WebMCP 工具合成器与 SSRF 沙箱。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, CheckCircle2, Wrench } from 'lucide-react'
import { type EncryptedVaultPayload, type VaultItem } from '@/lib/vault'
import { type JsonRpcResponse } from '@/lib/webmcp-bridge'
import { type CandidateItem } from '@/lib/federated-recommendation'
import { type SpeculationCandidate } from '@/lib/speculative-prerender'
import {
  isSafeUrl,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  parseOpenApiToSpecs
} from '@/lib/dynamic-tool-synthesizer'
import { type VectorClock } from '@/lib/crdt-sync'


export function SynthesizerPanel() {
  /* --- 模块 11：动态 WebMCP 工具合成器与 SSRF 沙箱状态 --- */
  const [synthToolType, setSynthToolType] = useState<'rest' | 'site_search' | 'openapi'>('rest')
  const [synthRestUrl, setSynthRestUrl] = useState<string>('https://api.github.com/repos/{owner}/{repo}')
  const [synthRestMethod, setSynthRestMethod] = useState<'GET' | 'POST'>('GET')
  const [ssrfTestUrl, setSsrfTestUrl] = useState<string>('http://169.254.169.254/latest/meta-data')
  const ssrfVerdict = useMemo(() => isSafeUrl(ssrfTestUrl), [ssrfTestUrl])

  const synthesizedSampleTool = useMemo(() => {
    if (synthToolType === 'site_search') {
      return synthesizeSiteSearchTool({
        siteId: 'github',
        siteName: 'GitHub 源码仓',
        searchUrlTemplate: 'https://github.com/search?q={query}',
        category: '开源代码',
      }).definition
    }
    if (synthToolType === 'openapi') {
      const parsed = parseOpenApiToSpecs({
        openapi: '3.0.0',
        servers: [{ url: 'https://api.example.com' }],
        paths: {
          '/search': {
            get: {
              operationId: 'search_resources',
              summary: '根据关键词查询资源清单',
              parameters: [
                { name: 'keyword', in: 'query', required: true, description: '搜索词' },
                { name: 'limit', in: 'query', schema: { type: 'integer' }, description: '单页条数' },
              ],
            },
          },
        },
      })
      if (parsed[0]) {
        return synthesizeRestTool(parsed[0]).definition
      }
    }
    return synthesizeRestTool({
      name: 'github_get_repo',
      description: '获取 GitHub 指定仓库的元数据信息',
      url: synthRestUrl,
      method: synthRestMethod,
      parameters: [
        { name: 'owner', in: 'path', type: 'string', required: true, description: '组织或用户名' },
        { name: 'repo', in: 'path', type: 'string', required: true, description: '仓库名' },
      ],
    }).definition
  }, [synthToolType, synthRestUrl, synthRestMethod])

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-500">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span>动态 WebMCP 工具合成器与严苛 SSRF 纵深防护沙箱</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    将外部 REST API、OpenAPI 3.0 或站点检索实时合成为 AI Agent 可调用的工具契约，集成 0.0.0.0/8、127.0.0.1、169.254.169.254 云元数据与内网穿透阻断。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-orange-500 border-orange-500/30 bg-orange-500/5 text-xs font-mono">
                  SSRF Shield
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-6">
              {/* 工具合成类型选择 */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-muted-foreground">选择合成模式：</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={synthToolType === 'rest' ? 'default' : 'outline'}
                    onClick={() => setSynthToolType('rest')}
                    className="text-xs h-8"
                  >
                    REST 接口规范合成
                  </Button>
                  <Button
                    size="sm"
                    variant={synthToolType === 'site_search' ? 'default' : 'outline'}
                    onClick={() => setSynthToolType('site_search')}
                    className="text-xs h-8"
                  >
                    站点站内检索工具化
                  </Button>
                  <Button
                    size="sm"
                    variant={synthToolType === 'openapi' ? 'default' : 'outline'}
                    onClick={() => setSynthToolType('openapi')}
                    className="text-xs h-8"
                  >
                    OpenAPI 3.0 规格解析
                  </Button>
                </div>
              </div>

              {/* 合成工具契约预览 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-orange-500 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    已实时合成的 WebMCP 工具定义 (Input Schema)：
                  </span>
                  <span className="font-mono text-muted-foreground text-[11px]">
                    tool: {synthesizedSampleTool.name}
                  </span>
                </div>
                <pre className="p-3.5 rounded-lg bg-background border border-border/50 text-[11px] font-mono overflow-x-auto text-foreground/90 max-h-56">
                  {JSON.stringify(synthesizedSampleTool, null, 2)}
                </pre>
              </div>

              {/* SSRF 严格防护测试沙箱 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/15 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-orange-500" />
                    SSRF 攻击探测与内网隔离防护演练：
                  </span>
                  <Badge variant={ssrfVerdict.safe ? 'secondary' : 'destructive'} className="text-[10px]">
                    {ssrfVerdict.safe ? '通行 (外网合法)' : `阻断: ${ssrfVerdict.reason}`}
                  </Badge>
                </div>

                <div className="flex gap-2">
                  <Input aria-label="输入待探测的目标 URL"
                    value={ssrfTestUrl}
                    onChange={(e) => setSsrfTestUrl(e.target.value)}
                    placeholder="输入待探测的目标 URL..."
                    className="text-xs h-9 font-mono"
                  />
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="text-muted-foreground self-center text-[11px]">典型渗透 Payload 快速注入：</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSsrfTestUrl('http://169.254.169.254/latest/meta-data')}
                    className="text-[11px] h-7"
                  >
                    AWS/GCP 元数据 (169.254)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSsrfTestUrl('http://127.0.0.1:8080/admin')}
                    className="text-[11px] h-7"
                  >
                    本地回环 (127.0.0.1)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSsrfTestUrl('http://192.168.1.1/router')}
                    className="text-[11px] h-7"
                  >
                    私有内网 (192.168)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSsrfTestUrl('https://api.github.com/zen')}
                    className="text-[11px] h-7"
                  >
                    合法公共 API
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
