'use client'

/**
 * 分模型单价簿（管理端）：¥/1K tokens，输入/输出分开定价。
 *
 * 为什么需要它：旧版只有「一个全局单价」，同价套输入输出，备用池里换一家模型
 * 就按主模型的价折算——面板上的 ¥ 数只能当量级参考。这里给每个模型单独定价，
 * 调用时把命中单价快照到 llm_usage 行上：之后调价只影响新调用，历史成本不变。
 *
 * 保存是全量替换（PUT 语义）：删掉一行再保存，这个模型就真的退出了定价。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Coins, Info, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { fetchAdminAiPrices, saveAdminAiPrices, type HubLlmModelPrice } from '@/lib/navhub-api'

interface PriceRow {
  model: string
  promptPer1kRmb: string
  completionPer1kRmb: string
}

function toRow(p: HubLlmModelPrice): PriceRow {
  return { model: p.model, promptPer1kRmb: String(p.promptPer1kRmb), completionPer1kRmb: String(p.completionPer1kRmb) }
}

function parsePrice(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : null
}

export function AiPriceBookPanel() {
  const [rows, setRows] = useState<PriceRow[]>([])
  const [legacy, setLegacy] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAdminAiPrices()
      setRows(res.prices.map(toRow))
      setLegacy(res.legacyUnitPriceRmb)
      setDirty(false)
      setSavedAt(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 延后一拍：避免 effect 同步触发 setState
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [load])

  function patchRow(index: number, next: PriceRow) {
    setRows((list) => list.map((row, i) => (i === index ? next : row)))
    setDirty(true)
  }

  async function handleSave() {
    const items: Array<{ model: string; promptPer1kRmb: number; completionPer1kRmb: number }> = []
    const seen = new Set<string>()
    for (const [index, row] of rows.entries()) {
      const model = row.model.trim()
      if (!model) {
        setError(`第 ${index + 1} 行的模型名为空`)
        return
      }
      if (seen.has(model)) {
        setError(`模型「${model}」重复出现：同一次保存里同名只能有一条`)
        return
      }
      seen.add(model)
      const prompt = parsePrice(row.promptPer1kRmb)
      const completion = parsePrice(row.completionPer1kRmb)
      if (prompt === null || completion === null) {
        setError(`模型「${model}」的单价必须是 0~10000 之间的数字（元 / 1K tokens）`)
        return
      }
      items.push({ model, promptPer1kRmb: prompt, completionPer1kRmb: completion })
    }

    setSaving(true)
    setError(null)
    try {
      const res = await saveAdminAiPrices(items)
      setRows(res.prices.map(toRow))
      setLegacy(res.legacyUnitPriceRmb)
      setDirty(false)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Coins className="h-4 w-4 text-emerald-500" />
            模型单价簿（元 / 1K tokens）
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            输入与输出分开定价；调用时命中的单价会快照到用量行上——之后调价只影响新调用，历史成本不会被重写。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {legacy !== null ? (
            <Badge variant="outline" className="text-[11px]">
              旧版单一价 ¥{legacy}/1K（未命中模型回落）
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              旧版单一价未配置
            </Badge>
          )}
          {dirty && (
            <Badge variant="outline" className="text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
              有未保存改动
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载单价簿…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          还没有任何分模型单价。未收录的模型会回落到旧版单一价；两者都没有时，观测大盘把成本显示为「未采集」，不会按 0 记账。
        </p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2 px-1 text-[11px] text-muted-foreground">
            <span>模型 ID（与接口返回的 model 一致）</span>
            <span>输入 ¥/1K tokens</span>
            <span>输出 ¥/1K tokens</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2 items-center"
            >
              <Input
                aria-label={`第 ${index + 1} 行模型 ID`}
                value={row.model}
                placeholder="例如 agnes-3.0-flash"
                onChange={(e) => patchRow(index, { ...row, model: e.target.value })}
              />
              <Input
                aria-label={`第 ${index + 1} 行输入单价`}
                type="number"
                min={0}
                max={10000}
                step="0.0001"
                value={row.promptPer1kRmb}
                placeholder="0.002"
                onChange={(e) => patchRow(index, { ...row, promptPer1kRmb: e.target.value })}
              />
              <Input
                aria-label={`第 ${index + 1} 行输出单价`}
                type="number"
                min={0}
                max={10000}
                step="0.0001"
                value={row.completionPer1kRmb}
                placeholder="0.006"
                onChange={(e) => patchRow(index, { ...row, completionPer1kRmb: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`删除模型 ${row.model || index + 1}`}
                onClick={() => {
                  setRows((list) => list.filter((_, i) => i !== index))
                  setDirty(true)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || rows.length >= 200}
          onClick={() => {
            setRows((list) => [...list, { model: '', promptPer1kRmb: '', completionPer1kRmb: '' }])
            setDirty(true)
          }}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          添加模型
        </Button>
        <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存单价簿
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={saving || loading}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          重新加载
        </Button>
        {savedAt !== null && !dirty && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已保存 {new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-muted bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          保存是全量替换：从清单里删掉某个模型并保存，它就退出定价（之后的调用成本显示「未采集」，而不是沿用旧价）。
          单价单位是人民币元 / 1K tokens，例如某模型输入 ¥0.002、输出 ¥0.006，则 1000 输入 + 500 输出的一次调用折算 ¥0.005。
        </span>
      </div>
    </div>
  )
}
