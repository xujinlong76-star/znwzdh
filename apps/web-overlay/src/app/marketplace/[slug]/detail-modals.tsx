/**
 * 插件详情页的五个弹窗（安装/卸载确认、违规举报、SVG 徽章、AI 审计报告、AI 工作室）。
 * 从 plugin-detail-view.tsx 拆出（第五批 A3.1）：弹窗内容走 Radix portal，在页面
 * 树中的位置不影响渲染；状态与处理器仍归壳，props 透传且标识符同名。
 */
'use client'

import { AlertTriangle, Award, Check, Copy, Minus, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { cn } from '@/lib/utils'
import { copyFailureToast, copyText } from '@/lib/clipboard'
import { toast } from 'sonner'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { PluginInstallModal } from '@/components/plugins/plugin-install-modal'
import { PluginReportModal } from '@/components/plugins/plugin-report-modal'
import { AuditDimensionTile } from '@/components/plugins/audit-dimension-tile'
import type { HubPluginItem, HubPluginAuditReport } from '@/lib/navhub-api'
import { formatLayoutReport } from '@/lib/modular/layout-report'
import { AiPluginStudioModal } from '@/components/plugins/ai-plugin-studio-modal'

export interface DetailModalsProps {
  plugin: HubPluginItem
  identity: string
  loading: boolean
  modalMode: 'install' | 'uninstall' | 'upgrade'
  manifest: any
  installModalOpen: boolean
  setInstallModalOpen: (v: boolean) => void
  reportModalOpen: boolean
  setReportModalOpen: (v: boolean) => void
  badgeModalOpen: boolean
  setBadgeModalOpen: (v: boolean) => void
  badgeMetric: 'version' | 'installs' | 'stars' | 'rating'
  setBadgeMetric: (v: 'version' | 'installs' | 'stars' | 'rating') => void
  auditModalOpen: boolean
  setAuditModalOpen: (v: boolean) => void
  auditReport: HubPluginAuditReport | null
  studioModalOpen: boolean
  setStudioModalOpen: (v: boolean) => void
  studioInitialManifest?: any
  loadDetail: () => void
}

export function DetailModals(props: DetailModalsProps) {
  const {
    plugin,
    identity,
    modalMode,
    installModalOpen,
    setInstallModalOpen,
    reportModalOpen,
    setReportModalOpen,
    badgeModalOpen,
    setBadgeModalOpen,
    badgeMetric,
    setBadgeMetric,
    auditModalOpen,
    setAuditModalOpen,
    auditReport,
    studioModalOpen,
    setStudioModalOpen,
    studioInitialManifest,
    loadDetail,
  } = props
  // 徽章弹窗的两枚复制反馈（与壳里 shareCopy/rawCopy 同一模式）
  const mdCopy = useCopyFeedback()
  const svgCopy = useCopyFeedback()
  return (
    <>
        {/* 安装 / 卸载确认弹窗 */}
        <PluginInstallModal
          plugin={plugin}
          identity={identity}
          mode={modalMode}
          open={installModalOpen}
          onOpenChange={setInstallModalOpen}
          onSuccess={() => {
            void loadDetail()
          }}
          onApplyPreset={(preset, mode) => {
            // 详情页这里必须自己报台账：安装发生在这一页，/custom 画布的浮层用户看不到。
            // 以前忽略返回值，等于无论模块有没有下线都当「装好了」。
            void (async () => {
              const { installWidgetPresetDirect } = await import('@/lib/modular/install-preset-direct')
              const { report, persisted } = await installWidgetPresetDirect(preset, mode)
              const notice = formatLayoutReport(report, `工作台预设「${plugin.name}」`)
              if (report.ok && !persisted) {
                toast.warning(`${notice.text}，但看板没能保存到本地`, {
                  description: '浏览器存储不可用，请在允许本地存储的环境重试',
                })
              } else if (notice.tone === 'warn') {
                toast.warning(notice.text)
              } else {
                toast.success(notice.text, { description: '到模块化工作台即可看到新看板' })
              }
            })()
          }}
        />

        {/* 违规举报弹窗 */}
        <PluginReportModal
          slug={plugin.slug}
          pluginName={plugin.name}
          open={reportModalOpen}
          onOpenChange={setReportModalOpen}
        />

        {/* 动态 SVG 徽章获取弹窗 */}
        <Dialog open={badgeModalOpen} onOpenChange={setBadgeModalOpen}>
          <DialogContent className="w-full max-w-lg p-6 space-y-5">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Award className="w-5 h-5 text-primary" />
                  获取开源动态徽章 (Badge)
                </DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  实时展示插件版本、累计安装量或评分。可直接嵌入 GitHub README、个人博客或文档中，支持矢量高清自适应。
                </DialogDescription>
              </DialogHeader>

              {/* 指标切换 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">指标维度：</span>
                {(
                  [
                    { key: 'version', label: '当前版本' },
                    { key: 'installs', label: '累计安装量' },
                    { key: 'stars', label: '星标计数' },
                    { key: 'rating', label: '综合评分' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setBadgeMetric(tab.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      badgeMetric === tab.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 实时预览 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2">
                <span className="text-xs text-muted-foreground">实时矢量预览：</span>
                <img
                  src={`/api/plugins/${encodeURIComponent(plugin.slug)}/badge.svg?metric=${badgeMetric}`}
                  alt={`${plugin.name} badge`}
                  width={160}
                  height={20}
                  loading="lazy"
                  decoding="async"
                  className="h-5 w-40 max-w-full object-contain"
                />
              </div>

              {/* 代码片段复制 */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Markdown 代码</span>
                    <button
                      type="button"
                      aria-label="复制 Markdown 徽章代码"
                      onClick={async () => {
                        const origin = typeof window !== 'undefined' ? window.location.origin : ''
                        const md = `[![山羊胡 Plugin](${origin}/api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric})](${origin}/marketplace/${plugin.slug})`
                        const result = await copyText(md)
                        mdCopy.reportCopy(result)
                        if (result.ok) toast.success('已复制 Markdown 徽章代码')
                        else {
                          const failure = copyFailureToast(result)
                          toast.error(failure.title, { description: failure.description })
                        }
                      }}
                      className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      {mdCopy.copyFeedback.state === 'copied'
                        ? '已复制'
                        : mdCopy.copyFeedback.state === 'failed'
                          ? '复制失败'
                          : '复制'}
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-muted text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {`[![山羊胡 Plugin](https://.../api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric})](...)`}
                  </pre>
                  {mdCopy.copyFeedback.state === 'failed' && mdCopy.copyFeedback.reason ? (
                    <p role="status" className="text-[11px] text-destructive">
                      {mdCopy.copyFeedback.reason}，请手动选中代码复制
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">直接 SVG 地址</span>
                    <button
                      type="button"
                      aria-label="复制 SVG 徽章地址"
                      onClick={async () => {
                        const origin = typeof window !== 'undefined' ? window.location.origin : ''
                        const result = await copyText(
                          `${origin}/api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric}`,
                        )
                        svgCopy.reportCopy(result)
                        if (result.ok) toast.success('已复制 SVG 链接')
                        else {
                          const failure = copyFailureToast(result)
                          toast.error(failure.title, { description: failure.description })
                        }
                      }}
                      className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      {svgCopy.copyFeedback.state === 'copied'
                        ? '已复制'
                        : svgCopy.copyFeedback.state === 'failed'
                          ? '复制失败'
                          : '复制'}
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-muted text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {`/api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric}`}
                  </pre>
                  {svgCopy.copyFeedback.state === 'failed' && svgCopy.copyFeedback.reason ? (
                    <p role="status" className="text-[11px] text-destructive">
                      {svgCopy.copyFeedback.reason}，请手动选中地址复制
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button size="sm" onClick={() => setBadgeModalOpen(false)}>
                  完成
                </Button>
              </div>
          </DialogContent>
        </Dialog>

        {/* 全自动代码沙盒安全审计弹窗 */}
        <Dialog open={auditModalOpen} onOpenChange={setAuditModalOpen}>
          <DialogContent className="max-w-md p-5 glass-surface border-border/80 shadow-2xl rounded-2xl">
            <DialogHeader className="space-y-1 pb-2 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold">全自动代码沙盒安全体检报告</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    由山羊胡全自动静态代码与外链沙盒审计引擎实时生成
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {auditReport ? (
              <div className="py-2 space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span>综合质量与安全评分</span>
                      {auditReport.decision === 'approve' && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                          AI 严审通过
                        </Badge>
                      )}
                      {auditReport.decision === 'pending_review' && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30">
                          待人工复核
                        </Badge>
                      )}
                      {auditReport.decision === 'reject' && (
                        <Badge variant="outline" className="text-[10px] bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30">
                          审理未通过
                        </Badge>
                      )}
                    </div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                      {auditReport.score} <span className="text-xs font-normal text-muted-foreground">/ 100 分</span>
                    </div>
                    {/* 分数口径必须说：没跑模型审理时这个分数只覆盖静态清单（+探活），不是「全维度体检」 */}
                    {auditReport.scoreBasis && auditReport.scoreBasis !== 'full' && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {auditReport.scoreBasis === 'static_plus_probe'
                          ? '口径：静态沙箱 + 外链探活（AI 合规维度本次未审）'
                          : '口径：仅静态清单（未做 AI 审理与外链探活）'}
                      </div>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-semibold px-2.5 py-1',
                      auditReport.level === 'safe'
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                    )}
                  >
                    {auditReport.level === 'safe' ? '安全等级：优良 (Safe)' : '安全等级：关注 (Notice)'}
                  </Badge>
                </div>

                {auditReport.reviewSkipped && (
                  <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      {auditReport.reviewSkipped === 'quota'
                        ? `AI 审理本次因额度用尽跳过${auditReport.quota ? `（${auditReport.quota.metric} ${auditReport.quota.used}/${auditReport.quota.limit}，约 ${Math.max(1, Math.ceil(auditReport.quota.retryAfterSeconds / 3600))} 小时后恢复）` : ''}，未产生模型结论。`
                        : auditReport.reviewSkipped === 'unconfigured'
                          ? '管理端尚未配置可用模型密钥，本条报告没有 AI 合规与相关性结论。'
                          : auditReport.reviewSkipped === 'not_audited'
                            ? '这份报告只包含安装时的静态清单检查，尚无 AI 审理记录。'
                            : 'AI 审理本次调用失败，未产生模型结论；下方合规与相关性两项是空值，不是低分。'}
                    </span>
                  </div>
                )}

                {auditReport.aiRationale && (
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs space-y-1">
                    <div className="text-[11px] font-semibold text-primary flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{auditReport.llmReviewed ? 'AI 审查委员会审理意见：' : '本次审理说明（无模型结论）：'}</span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed text-[11px]">
                      {auditReport.aiRationale}
                    </p>
                  </div>
                )}

                {auditReport.dimensionScores && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <AuditDimensionTile label="静态安全沙箱" value={auditReport.dimensionScores.security} />
                    <AuditDimensionTile label="外链探活可用率" value={auditReport.dimensionScores.availability} />
                    <AuditDimensionTile label="AI 合规反欺诈" value={auditReport.dimensionScores.compliance} />
                    <AuditDimensionTile label="语义相关性" value={auditReport.dimensionScores.relevance} />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">全链路扫描体检项：</div>
                  {auditReport.checks.map((c, i) => (
                    <div key={i} className="p-2.5 rounded-lg border border-border/40 bg-card/60 text-xs flex items-start gap-2.5">
                      {c.skipped ? (
                        <Minus className="w-4 h-4 text-muted-foreground/60 shrink-0 mt-0.5" />
                      ) : c.passed ? (
                        <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-[10px] text-muted-foreground/70 text-center pt-1">
                  体检时间：{new Date(auditReport.auditedAt).toLocaleString()} · SHA-256 签名无害化校验
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">加载安全报告中...</div>
            )}
          </DialogContent>
        </Dialog>

        {studioModalOpen && plugin && (
          <AiPluginStudioModal
            open={studioModalOpen}
            onOpenChange={setStudioModalOpen}
            initialManifest={studioInitialManifest || plugin.manifest}
            initialSlug={studioInitialManifest ? `${plugin.slug}-remix` : plugin.slug}
            onPublished={() => {
              setStudioModalOpen(false)
              void loadDetail()
            }}
          />
        )}
    </>
  )
}
