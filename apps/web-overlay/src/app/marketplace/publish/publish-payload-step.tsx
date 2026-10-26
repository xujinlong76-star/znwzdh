/**
 * 投稿发布页的步骤 3 面板（声明式 JSON Payload 编辑器 + 预检校验 + 死链嗅探 +
 * 提交按钮行）。从 page.tsx 拆出（第五批 A3.3 收尾——第六批实证其与提交按钮
 * 纠缠，故连同提交行一起抽出，边界落在提交行自身的 </div> 上，壳保留卡片
 * 包裹层与 <form> 闭合）。JSX 原样搬运，状态与处理器仍归壳，props 透传且
 * 标识符同名，保证行为零漂移。行为由 e2e/plugin-market.spec.ts（全链路 UI
 * 驱动 + NextGen 链路）与 e2e/plugin-studio.spec.ts（发布表单 → 工坊）锁定。
 */
'use client'

import { Activity, AlertCircle, CheckCircle2, Eye, FileCode2, Loader2, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PublishPayloadStepProps {
  kind: string
  name: string
  description: string
  editingSlug: string | null
  payloadJson: string
  setPayloadJson: (v: string) => void
  changelog: string
  setChangelog: (v: string) => void
  handleValidate: () => void
  validating: boolean
  validationResult: { ok: boolean; errors?: string[]; summary?: any } | null
  setValidationResult: (v: { ok: boolean; errors?: string[]; summary?: any } | null) => void
  handleCheckUrls: () => void
  checkingUrls: boolean
  urlCheckResults: {
    total: number
    okCount: number
    failedCount: number
    results: Array<{ url: string; ok: boolean; status: number; error?: string }>
  } | null
  submitting: boolean
}

export function PublishPayloadStep(props: PublishPayloadStepProps) {
  const {
    kind, name, description, editingSlug,
    payloadJson, setPayloadJson, changelog, setChangelog,
    handleValidate, validating, validationResult, setValidationResult,
    handleCheckUrls, checkingUrls, urlCheckResults, submitting,
  } = props
  return (
    <>
            {/* 步骤 3: 声明式 JSON Payload */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <label htmlFor="publish-plugin-payload" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileCode2 className="w-4 h-4 text-primary" />
                  <span>第 3 步：定义内容载荷 (payload JSON)</span>
                </label>
                <span className="text-[11px] text-muted-foreground">纯声明式 JSON</span>
              </div>
              <textarea
                id="publish-plugin-payload"
                aria-label="内容载荷 JSON"
                value={payloadJson}
                onChange={(e) => {
                  setPayloadJson(e.target.value)
                  setValidationResult(null)
                }}
                rows={10}
                className="w-full text-base sm:text-xs font-mono rounded-2xl border border-border/80 bg-background/90 p-4 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 leading-relaxed"
                required
              />
            </div>

            {/* 预检校验结果反馈 */}
            {validationResult && (
              <div
                className={cn(
                  'rounded-2xl border p-4 space-y-2 text-xs transition-all',
                  validationResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                    : 'border-destructive/30 bg-destructive/5 text-destructive'
                )}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {validationResult.ok ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>预检校验通过！该清单完全符合山羊胡规范</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-destructive" />
                      <span>发现以下校验错误：</span>
                    </>
                  )}
                </div>

                {!validationResult.ok && validationResult.errors && (
                  <ul className="list-disc list-inside space-y-1 text-xs opacity-90 pl-1">
                    {validationResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}

                {validationResult.ok && validationResult.summary && (
                  <div className="text-[11px] text-muted-foreground flex flex-wrap gap-4 pt-1">
                    {kind === 'site-pack' && (
                      <span>
                        站点总计: {validationResult.summary.siteCount}，分类: {validationResult.summary.categoryCount}
                      </span>
                    )}
                    {kind === 'workspace-preset' && (
                      <span>
                        看板: {validationResult.summary.boardCount}，组件: {validationResult.summary.widgetCount}
                      </span>
                    )}
                    {kind === 'theme' && (
                      <span>变量数: {validationResult.summary.themeTokenCount}</span>
                    )}
                    {kind === 'search-pack' && (
                      <span>
                        引擎数: {validationResult.summary.engineCount}，前缀: {validationResult.summary.enginePrefixes?.join(', ')}
                      </span>
                    )}
                    {kind === 'bundle' && (
                      <span>
                        成员数: {validationResult.summary.bundleItemCount}，类型:{' '}
                        {(validationResult.summary.bundleKinds ?? []).join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 链接健康体检结果展示 */}
            {urlCheckResults && (
              <div
                className={cn(
                  'p-4 rounded-2xl border text-xs space-y-2 animate-in fade-in',
                  urlCheckResults.failedCount === 0
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                )}
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    <span>
                      URL 可达性体检：共检测 {urlCheckResults.total} 个，
                      {urlCheckResults.failedCount === 0 ? '全部健康' : `${urlCheckResults.failedCount} 个异常`}
                    </span>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pt-1">
                  {urlCheckResults.results.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] font-mono gap-2">
                      <span className="truncate max-w-[320px]">{r.url}</span>
                      {r.ok ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                          ✓ {r.status}
                        </span>
                      ) : (
                        <span className="text-destructive font-bold shrink-0">
                          ✕ {r.error || '失败'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editingSlug && (
              <div className="space-y-1.5">
                <label htmlFor="plugin-changelog" className="text-xs font-medium text-foreground">
                  变更说明（审核通过后写入版本历史）
                </label>
                <textarea
                  id="plugin-changelog"
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="例如：新增 12 个设计工具站点；修复失效链接；调整主题强调色"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base sm:text-xs leading-relaxed resize-y"
                />
              </div>
            )}

            {/* 底部操作条 */}
            <div className="pt-4 border-t border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={validating || !name.trim() || !description.trim()}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-medium rounded-xl border border-border/80 bg-background hover:bg-muted/60 text-foreground transition-all"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{validating ? '预检中…' : '预检校验'}</span>
                </button>

                {(kind === 'site-pack' || kind === 'search-pack') && (
                  <button
                    type="button"
                    onClick={handleCheckUrls}
                    disabled={checkingUrls}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 text-xs font-medium rounded-xl border border-border/80 bg-background hover:bg-muted/60 text-foreground transition-all"
                    title="检测清单中站点的可达性与是否存在死链"
                  >
                    {checkingUrls ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-primary" />
                    )}
                    <span>{checkingUrls ? '嗅探检测中…' : '体检链接可达性'}</span>
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !name.trim() || !description.trim()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submitting ? '提交中…' : editingSlug ? '提交新版本审核' : '立即提交审核'}</span>
              </button>
            </div>
    </>
  )
}
