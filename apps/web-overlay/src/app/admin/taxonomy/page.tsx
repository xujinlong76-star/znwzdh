'use client'

/**
 * 管理端：分类与标签体系智能治理 (Taxonomy Governance & AI Auditing - Phase 4)
 *
 * 核心功能：
 * 1. 全站分类/标签健康度一键审计与定时治理提案发现
 * 2. 站点归类契合度、标签大小写/形近合并、零结果检索缺口提案审核
 * 3. 单条与批量人工审批闸门（采纳 / 驳回），AI 只提案不静默落库
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Sparkles,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  Tag,
  FolderTree,
  Search,
  CheckCircle2,
  Clock,
  ArrowRight,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface TaxonomyProposal {
  id: string
  kind: 'categorization_mismatch' | 'tag_consolidation' | 'zero_result_gap' | 'facet_gap'
  targetId: string
  targetTitle?: string
  currentValue?: string
  suggestedValue: string
  confidence: number
  reason: string
  status: 'pending' | 'applied' | 'dismissed'
  meta?: Record<string, unknown>
  createdAt: number
  appliedAt?: number | null
}

const KIND_META: Record<TaxonomyProposal['kind'], { label: string; icon: any; color: string; bg: string }> = {
  tag_consolidation: {
    label: '标签冗余收敛',
    icon: Tag,
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800',
  },
  categorization_mismatch: {
    label: '站点归类迁移',
    icon: FolderTree,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
  },
  zero_result_gap: {
    label: '零结果需求缺口',
    icon: Search,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
  },
  facet_gap: {
    label: '分面属性缺失',
    icon: SlidersHorizontal,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800',
  },
}

export default function AdminTaxonomyPage() {
  const [proposals, setProposals] = useState<TaxonomyProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [auditing, setAuditing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'applied' | 'dismissed' | 'all'>('pending')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 4000)
  }

  const loadProposals = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (statusFilter !== 'all') q.set('status', statusFilter)
      if (kindFilter !== 'all') q.set('kind', kindFilter)
      q.set('limit', '100')

      const res = await hubGet<{ items: TaxonomyProposal[]; total: number }>(`/api/taxonomy/proposals?${q.toString()}`)
      setProposals(res.items || [])
      setSelectedIds([])
    } catch (err) {
      showFeedback('error', '加载治理提案失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, kindFilter])

  useEffect(() => {
    void loadProposals()
  }, [loadProposals])

  const handleRunAudit = async () => {
    setAuditing(true)
    try {
      const res = await hubSend<{ ok: boolean; proposalsCount: number }>(
        '/api/taxonomy/audit',
        'POST',
        { dryRun: false, siteLimit: 500 },
      )
      showFeedback('success', `全站体检审计完成！共发现/更新 ${res.proposalsCount} 条治理提案`)
      await loadProposals()
    } catch (err) {
      showFeedback('error', '触发审计失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setAuditing(false)
    }
  }

  const handleApplySingle = async (id: string) => {
    try {
      const res = await hubSend<{ ok: boolean; message: string }>(
        `/api/taxonomy/proposals/${encodeURIComponent(id)}/apply`,
        'POST',
      )
      showFeedback('success', res.message || '提案采纳成功')
      await loadProposals()
    } catch (err) {
      showFeedback('error', '采纳失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleDismissSingle = async (id: string) => {
    try {
      await hubSend(`/api/taxonomy/proposals/${encodeURIComponent(id)}/dismiss`, 'POST')
      showFeedback('success', '提案已驳回')
      await loadProposals()
    } catch (err) {
      showFeedback('error', '驳回失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleBatchAction = async (action: 'apply' | 'dismiss') => {
    if (selectedIds.length === 0) return
    try {
      const res = await hubSend<{ successCount: number; failedCount: number }>(
        '/api/taxonomy/proposals/batch',
        'POST',
        { ids: selectedIds, action },
      )
      showFeedback('success', `批量操作完成：成功 ${res.successCount} 条，失败 ${res.failedCount} 条`)
      await loadProposals()
    } catch (err) {
      showFeedback('error', '批量操作失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const filteredProposals = proposals.filter((p) => {
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    return (
      p.targetTitle?.toLowerCase().includes(term) ||
      p.targetId.toLowerCase().includes(term) ||
      p.suggestedValue.toLowerCase().includes(term) ||
      p.reason.toLowerCase().includes(term)
    )
  })

  return (
    <div className="container max-w-7xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      {/* 头部标题与审计触发 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">分类与标签智能治理</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="w-3.5 h-3.5" />
              AI 闭环治理
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            基于启发式规则、词频统计与零结果检索信号的智能归类、标签归一与缺口发现闭环。AI 仅提案，采纳全由人工把关。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={loadProposals}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>

          <Button
            size="sm"
            onClick={handleRunAudit}
            disabled={auditing}
            className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm"
          >
            <Sparkles className={`w-4 h-4 ${auditing ? 'animate-spin' : ''}`} />
            {auditing ? '全站深度审计中...' : '一键全站体检'}
          </Button>
        </div>
      </div>

      {/* 提示反馈栏 */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-sm transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* 状态与类型过滤控制面板 */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-muted/40 p-4 rounded-xl border">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-background p-1 text-xs">
            {(['pending', 'applied', 'dismissed', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'pending' ? '待审核' : s === 'applied' ? '已采纳' : s === 'dismissed' ? '已驳回' : '全部'}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-lg border bg-background p-1 text-xs">
            {[
              { id: 'all', label: '全部类型' },
              { id: 'tag_consolidation', label: '标签收敛' },
              { id: 'categorization_mismatch', label: '跨类迁移' },
              { id: 'zero_result_gap', label: '零结果发现' },
            ].map((k) => (
              <button
                key={k.id}
                onClick={() => setKindFilter(k.id)}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  kindFilter === k.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-full md:w-64">
          <Input
            placeholder="搜索提案关键词 / 站点..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 text-xs"
          />
        </div>
      </div>

      {/* 批量操作工具坞 */}
      {selectedIds.length > 0 && (
        <div className="bg-primary/5 border border-primary/20 p-3 rounded-xl flex items-center justify-between text-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 font-medium">
            <span>已选择 {selectedIds.length} 项提案</span>
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs text-muted-foreground hover:underline ml-2"
            >
              取消选择
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => handleBatchAction('dismiss')}
            >
              <X className="w-3.5 h-3.5" />
              批量驳回
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => handleBatchAction('apply')}
            >
              <Check className="w-3.5 h-3.5" />
              批量采纳
            </Button>
          </div>
        </div>
      )}

      {/* 提案列表 */}
      {loading ? (
        <div className="p-16 text-center text-muted-foreground space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary" />
          <p className="text-sm">正在加载治理提案...</p>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="p-16 text-center border rounded-2xl bg-muted/10 space-y-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <h3 className="text-base font-semibold">暂无待处理提案</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            全站分类与标签健康状况良好。你可以点击右上角「一键全站体检」启动新一轮智能巡检。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Select all visible proposals"
                checked={selectedIds.length > 0 && selectedIds.length === filteredProposals.length}
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds(filteredProposals.map((p) => p.id))
                  else setSelectedIds([])
                }}
                className="rounded border-gray-300"
              />
              <span>全选可见提案（共 {filteredProposals.length} 条）</span>
            </div>
            <span>按置信度从高到低排序</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredProposals.map((proposal) => {
              const meta = KIND_META[proposal.kind] || {
                label: proposal.kind,
                icon: AlertCircle,
                color: 'text-gray-600',
                bg: 'bg-gray-50 border-gray-200',
              }
              const Icon = meta.icon
              const isSelected = selectedIds.includes(proposal.id)

              return (
                <div
                  key={proposal.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    isSelected ? 'ring-2 ring-primary border-primary bg-primary/5' : 'bg-card hover:border-foreground/20'
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    <input
                      type="checkbox"
                      aria-label={`Select proposal ${proposal.id}`}
                      checked={isSelected}
                      onChange={() => toggleSelect(proposal.id)}
                      className="mt-1 rounded border-gray-300"
                    />

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.bg} ${meta.color}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {meta.label}
                        </span>

                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-muted text-muted-foreground">
                          置信度: {(proposal.confidence * 100).toFixed(0)}%
                        </span>

                        {proposal.status !== 'pending' && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                              proposal.status === 'applied'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            }`}
                          >
                            {proposal.status === 'applied' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                            {proposal.status === 'applied' ? '已采纳' : '已驳回'}
                          </span>
                        )}
                      </div>

                      {/* 转换实体 */}
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {proposal.targetTitle && <span className="text-foreground">{proposal.targetTitle}</span>}
                        {proposal.currentValue && (
                          <span className="text-muted-foreground line-through text-xs font-normal">
                            {proposal.currentValue}
                          </span>
                        )}
                        {proposal.currentValue && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className="text-primary font-bold">{proposal.suggestedValue}</span>
                      </div>

                      {/* 理由说明 */}
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {proposal.reason}
                      </p>
                    </div>
                  </div>

                  {/* 右侧动作按钮 */}
                  {proposal.status === 'pending' ? (
                    <div className="flex items-center gap-2 self-end md:self-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDismissSingle(proposal.id)}
                        className="text-muted-foreground hover:text-red-600 hover:bg-red-50 text-xs h-8 px-2.5"
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        驳回
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleApplySingle(proposal.id)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 px-3"
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        采纳
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 self-end md:self-center">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{new Date(proposal.appliedAt || proposal.createdAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
