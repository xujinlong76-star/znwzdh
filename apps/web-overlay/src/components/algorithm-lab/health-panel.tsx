'use client'

/**
 * 算法 3：页面健康与防假 200 巡检。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldAlert, CheckCircle2 } from 'lucide-react'
const SAMPLE_HTMLS = {
  normal: {
    name: '正常技术开发站 (React 官网)',
    html: `<!DOCTYPE html><html><body><h1>React 用于构建 Web 的库</h1><p>通过组合组件快速搭建现代化交互式 Web 应用。声明式视图、组件化架构，以及与 Vite 和 Next.js 的无缝整合。</p></body></html>`,
  },
  parked: {
    name: '域名抢注停放广告 (Dan.com / GoDaddy)',
    html: `<html><body><h1>This domain is for sale! Buy this domain on Dan.com</h1><p>Inquire about this domain or renew this domain name. HugeDomains parking network.</p></body></html>`,
  },
  soft404: {
    name: 'SPA 单页软 404 (假 200 空白首页)',
    html: `<html><head><title>Page Not Found</title></head><body><h1>404 Not Found 页面未找到</h1><p>请返回首页或者访问其他链接</p></body></html>`,
  },
}

import { auditPageHealth } from '@/lib/health-sentinel'

/**
 * 2026-11-10 修正：此面板此前**手写了 calculateTextEntropy**，并内联硬编码了 6 个停放关键词，
 * 而 core 的 health-sentinel 是一个完整的防虚假 200 引擎：
 *
 *  - 19 条停放/错误关键词（面板只复刻了 6 条，漏掉 dan.com / godaddy / sedo /
 *    域名出售 / forbidden / access denied / blocked by cloudflare 等）;
 *  - stripHtmlToText() 独立函数（去标签、去 script/style），面板用单条正则近似；
 *  - 支持视觉感知哈希比对（汉明距离 ≤8 判停放模板）;
 *  - 带 confidence 与 textLength/truncated 感知 —— 截断页不会被误判。
 *
 * 面板标题写的是「Shannon 文本信息熵与防虚假 200 巡检引擎」，
 * 那它就该用引擎，而不是复刻一小半。
 */
export function HealthPanel() {
  /* --- 模块 3：页面健康状态 --- */
  const [healthSnippet, setHealthSnippet] = useState(SAMPLE_HTMLS.parked.html)
  const healthAudit = useMemo(() => {
    // 走真引擎：19 条关键词 + 独立 HTML 剥离 + 置信度 + 截断感知
    const audit = auditPageHealth("https://example.com/demo", healthSnippet)
    return {
      entropy: audit.shannonEntropy,
      matched: audit.matchedParkingKeywords,
      status: audit.status,
      reason: audit.reason,
      confidence: audit.confidence,
      textLength: audit.textLength,
    }
  }, [healthSnippet])

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span>Shannon 文本信息熵与防虚假 200 巡检引擎</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    传统导航站仅探测 HTTP 状态码，易被“域名过期停放广告”与“SPA 单页软 404”欺骗。本算法实时计算文本信息熵并比对特征词频。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/5 text-xs">
                  熵值检测法 H(S)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">快速加载典型实测样本：</span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(SAMPLE_HTMLS).map(([k, s]) => (
                      <Button
                        key={k}
                        size="sm"
                        variant="secondary"
                        className="text-xs h-7.5 px-2.5 border border-border/60"
                        onClick={() => setHealthSnippet(s.html)}
                      >
                        {s.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <textarea aria-label="输入或粘贴待检测的 HTML 文本"
                  className="w-full h-32 p-3.5 rounded-xl border border-border/70 font-mono text-base sm:text-xs bg-muted/20 focus:outline-hidden focus:ring-1 focus:ring-emerald-500/50 shadow-inner resize-y"
                  value={healthSnippet}
                  onChange={(e) => setHealthSnippet(e.target.value)}
                  placeholder="在此输入或粘贴待检测的 HTML 文本..."
                />
              </div>

              {/* 实时分析判据结果 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-border/50">
                <div className="p-4 rounded-xl border border-border/60 bg-card flex flex-col justify-between shadow-2xs">
                  <div>
                    <span className="text-xs text-muted-foreground">Shannon 文本信息熵 H(S)</span>
                    <div className="text-3xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                      {healthAudit.entropy}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/40">
                    正常技术站 H &ge; 3.5；空白/停放页 H &lt; 2.0
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-card flex flex-col justify-between shadow-2xs">
                  <div>
                    <span className="text-xs text-muted-foreground">命中华文/英文停放特征词</span>
                    <div className="text-xl font-bold font-mono text-foreground mt-1">
                      {healthAudit.matched.length > 0 ? `${healthAudit.matched.length} 处匹配` : '0 处 (安全)'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {healthAudit.matched.length > 0 ? (
                      healthAudit.matched.map((m) => (
                        <Badge key={m} variant="destructive" className="text-xs px-2 py-0.5">{m}</Badge>
                      ))
                    ) : (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">未检出广告/抢注模式</span>
                    )}
                  </div>
                </div>

                <div className={`p-4 rounded-xl border flex flex-col justify-between shadow-2xs ${
                  healthAudit.status === 'HEALTHY'
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <div>
                    <div className="flex items-center gap-1.5">
                      {healthAudit.status === 'HEALTHY' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                      )}
                      <span className="text-xs font-bold uppercase tracking-wide">{healthAudit.status}</span>
                    </div>
                    <div className="text-sm font-semibold mt-1">
                      {healthAudit.status === 'HEALTHY' ? '健康可达站点' : '伪健康异常预警'}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/30">{healthAudit.reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
