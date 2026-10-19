'use client'

/**
 * 管理端：AI 模型配置（系统默认模型）。
 *
 * 系统默认模型决定「所有未配置个人模型的调用」走哪个端点；
 * 密钥加密落库、只回显掩码，保存后立即刷新能力位（无需重启）。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, Cpu, Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { LlmConfigFields, type LlmFormValue } from '@/components/ai/llm-config-form'
import { AiObservabilityPanel } from '@/components/ai/ai-observability-panel'
import {
  fetchAdminLlmConfig,
  resetAdminLlmConfig,
  saveAdminLlmConfig,
  testAdminLlmConfig,
  type HubAdminLlmConfigResponse,
  type HubLlmTestResult,
} from '@/lib/navhub-api'


const SOURCE_LABEL: Record<string, string> = {
  db: '管理端配置',
  env: '环境变量',
  default: '内置默认',
  user: '个人配置',
  // effective.source 用 system 表示「系统层（即管理端配置）」
  system: '管理端配置',
}

/** 备用模型表单行（apiKey 留空=沿用同 id 的已存密钥） */
interface FallbackForm extends LlmFormValue {
  id?: string
  apiKeyMasked?: string
}

function emptyFallback(): FallbackForm {
  return {
    enabled: true,
    name: '备用模型',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    model: 'agnes-3.0-flash',
    apiKey: '',
    timeoutMs: 20000,
    temperature: 0.2,
    maxTokens: 1024,
    jsonMode: 'auto',
    allowPrivateNetwork: false,
  }
}

function emptyForm(): LlmFormValue {
  return {
    enabled: true,
    name: 'Agnes 3.0 Flash',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    model: 'agnes-3.0-flash',
    apiKey: '',
    timeoutMs: 20000,
    temperature: 0.2,
    maxTokens: 1024,
    jsonMode: 'auto',
    allowPrivateNetwork: false,
  }
}

export default function AdminAiPage() {
  const { toast } = useToast()
  const [data, setData] = useState<HubAdminLlmConfigResponse | null>(null)
  const [form, setForm] = useState<LlmFormValue>(emptyForm())
  const [apiKeyMasked, setApiKeyMasked] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearingKey, setClearingKey] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [testResult, setTestResult] = useState<HubLlmTestResult | null>(null)
  const [fallbacks, setFallbacks] = useState<FallbackForm[]>([])
  const [activeTab, setActiveTab] = useState<'config' | 'observability'>('config')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetchAdminLlmConfig()
      setData(res)
      const c = res.config
      setForm({
        enabled: c.enabled,
        name: c.name,
        baseUrl: c.baseUrl,
        model: c.model,
        apiKey: '',
        timeoutMs: c.timeoutMs,
        temperature: c.temperature,
        maxTokens: c.maxTokens,
        jsonMode: c.jsonMode,
        allowPrivateNetwork: c.allowPrivateNetwork,
      })
      setApiKeyMasked(c.hasApiKey ? c.apiKeyMasked : '')
      setFallbacks(
        (c.fallbacks ?? []).map((fb) => ({
          id: fb.id,
          enabled: fb.enabled,
          name: fb.name,
          baseUrl: fb.baseUrl,
          model: fb.model,
          apiKey: '',
          apiKeyMasked: fb.hasApiKey ? fb.apiKeyMasked : '',
          timeoutMs: fb.timeoutMs,
          temperature: fb.temperature,
          maxTokens: fb.maxTokens,
          jsonMode: fb.jsonMode,
          allowPrivateNetwork: fb.allowPrivateNetwork,
        })),
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 延后一拍再拉取：避免 effect 同步触发 setState（React 编译器卫生规则）
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [load])

  function payload(extraApiKey = true) {
    return {
      enabled: form.enabled,
      name: form.name.trim() || '自定义模型',
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      timeoutMs: form.timeoutMs,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      jsonMode: form.jsonMode,
      allowPrivateNetwork: form.allowPrivateNetwork,
      ...(extraApiKey && form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      fallbacks: fallbacks.map((fb) => ({
        ...(fb.id ? { id: fb.id } : {}),
        enabled: fb.enabled,
        name: fb.name.trim() || '备用模型',
        baseUrl: fb.baseUrl.trim(),
        model: fb.model.trim(),
        timeoutMs: fb.timeoutMs,
        temperature: fb.temperature,
        maxTokens: fb.maxTokens,
        jsonMode: fb.jsonMode,
        allowPrivateNetwork: fb.allowPrivateNetwork,
        ...(fb.apiKey.trim() ? { apiKey: fb.apiKey.trim() } : {}),
      })),
    }
  }

  function patchFallback(index: number, next: FallbackForm) {
    setFallbacks((list) => list.map((item, i) => (i === index ? next : item)))
  }

  async function handleSave() {
    setSaving(true)
    setTestResult(null)
    try {
      await saveAdminLlmConfig(payload())
      toast({ title: '已保存', description: '系统默认模型已更新，能力位即时生效。' })
      setForm((f) => ({ ...f, apiKey: '' }))
      await load()
    } catch (err) {
      toast({
        title: '保存失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleClearKey() {
    if (clearingKey) return
    setClearingKey(true)
    try {
      await saveAdminLlmConfig({ ...payload(false), apiKey: '' })
      toast({ title: '密钥已清除', description: '将回退到环境变量中的密钥（若存在）。' })
      await load()
    } catch (err) {
      toast({
        title: '清除失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setClearingKey(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testAdminLlmConfig(payload())
      setTestResult(res.result)
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        model: form.model,
        replyPreview: '',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setTesting(false)
    }
  }

  async function handleReset() {
    setConfirmReset(false)
    try {
      await resetAdminLlmConfig()
      toast({ title: '已恢复', description: '系统配置已清除，回退到环境变量 / 内置默认。' })
      await load()
    } catch (err) {
      toast({
        title: '恢复失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在加载模型配置…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  const config = data?.config
  const effective = data?.effective

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            AI 模型中枢与效能管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            统一调度 Agnes 3.0 Flash 默认模型及备用池，提供全站模型配置与实时 Token 效能遥测大盘。
          </p>
        </div>
      </div>

      {/* 顶部 Tab 导航 */}
      <div className="flex border-b space-x-2">
        <button
          type="button"
          aria-label="切换到模型配置"
          onClick={() => setActiveTab('config')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'config'
              ? 'border-primary text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bot className="h-4 w-4" />
          模型参数与备用池配置
        </button>
        <button
          type="button"
          aria-label="切换到效能与 Token 遥测大盘"
          onClick={() => setActiveTab('observability')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'observability'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Cpu className="h-4 w-4 text-indigo-500" />
          效能与 Token 遥测大盘
          <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20">
            Agnes 3.0 Flash
          </Badge>
        </button>
      </div>

      {activeTab === 'observability' ? (
        <AiObservabilityPanel />
      ) : (
        <>

      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="outline" className="gap-1">
          生效来源：{SOURCE_LABEL[effective?.source ?? 'default'] ?? effective?.source}
        </Badge>
        <Badge variant={effective?.hasApiKey ? 'secondary' : 'destructive'} className="gap-1">
          {effective?.hasApiKey ? '密钥已配置' : '缺少密钥（AI 富化将降级为启发式）'}
        </Badge>
        <span className="text-muted-foreground">
          当前模型：<code className="text-xs">{effective?.model ?? config?.model}</code>
        </span>
        {config?.updatedAt && (
          <span className="text-xs text-muted-foreground">
            最后更新：{new Date(config.updatedAt).toLocaleString('zh-CN')}
            {config.updatedBy ? ` · ${config.updatedBy}` : ''}
          </span>
        )}
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-5">
        <LlmConfigFields
          value={form}
          onChange={setForm}
          apiKeyMasked={apiKeyMasked}
          showAllowPrivateNetwork
        />

        <div className="border-t pt-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">备用模型（可选）</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                主模型超时或报错时按顺序尝试；密钥同样加密存储，最多 3 个。
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fallbacks.length >= 3}
              onClick={() => setFallbacks((list) => [...list, emptyFallback()])}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              添加备用模型
            </Button>
          </div>

          {fallbacks.length === 0 ? (
            <p className="text-xs text-muted-foreground">未配置备用模型。</p>
          ) : (
            fallbacks.map((fb, index) => (
              <div key={fb.id ?? `new-${index}`} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">备用 #{index + 1}</Badge>
                    <span className="text-muted-foreground">
                      {fb.apiKeyMasked ? `密钥：${fb.apiKeyMasked}` : '尚未配置密钥'}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFallbacks((list) => list.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    移除
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`fb-name-${index}`}>显示名称</Label>
                    <Input
                      id={`fb-name-${index}`}
                      value={fb.name}
                      onChange={(e) => patchFallback(index, { ...fb, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`fb-model-${index}`}>模型 ID</Label>
                    <Input
                      id={`fb-model-${index}`}
                      value={fb.model}
                      onChange={(e) => patchFallback(index, { ...fb, model: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`fb-base-${index}`}>接口地址（Base URL）</Label>
                  <Input
                    id={`fb-base-${index}`}
                    value={fb.baseUrl}
                    onChange={(e) => patchFallback(index, { ...fb, baseUrl: e.target.value })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`fb-key-${index}`}>API 密钥</Label>
                    <Input
                      id={`fb-key-${index}`}
                      type="password"
                      autoComplete="new-password"
                      value={fb.apiKey}
                      placeholder={fb.apiKeyMasked ? `已配置：${fb.apiKeyMasked}（留空不修改）` : '尚未配置'}
                      onChange={(e) => patchFallback(index, { ...fb, apiKey: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`fb-timeout-${index}`}>超时（毫秒）</Label>
                    <Input
                      id={`fb-timeout-${index}`}
                      type="number"
                      min={1000}
                      max={120000}
                      step={1000}
                      value={fb.timeoutMs}
                      onChange={(e) =>
                        patchFallback(index, {
                          ...fb,
                          timeoutMs: Number(e.target.value) || fb.timeoutMs,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
          <Button variant="outline" onClick={() => void handleTest()} disabled={testing}>
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            测试连接
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleClearKey()}
            disabled={clearingKey || !apiKeyMasked}
          >
            清除已存密钥
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {confirmReset ? (
              <>
                <span className="text-xs text-muted-foreground">确认清除管理端配置？</span>
                <Button variant="destructive" size="sm" onClick={() => void handleReset()}>
                  确认恢复
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                恢复环境变量默认
              </Button>
            )}
          </div>
        </div>

        {testResult && (
          <div
            className={
              'rounded-lg border p-3 text-sm ' +
              (testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                : 'border-destructive/30 bg-destructive/5 text-destructive')
            }
          >
            <div className="flex items-center gap-2 font-medium">
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {testResult.ok ? `连通成功 · ${testResult.latencyMs}ms` : '连通失败'}
            </div>
            {testResult.ok ? (
              <p className="mt-1 text-xs text-muted-foreground">
                模型：{testResult.model} · 回复预览：{testResult.replyPreview || '(空)'}
              </p>
            ) : (
              <p className="mt-1 text-xs">
                {testResult.error}
                {testResult.code ? `（${testResult.code}${testResult.status ? ` / HTTP ${testResult.status}` : ''}）` : ''}
              </p>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            解析优先级：个人配置 → 系统配置 → 环境变量 → 内置默认（Agnes 3.0 Flash）。
            关闭「启用」会让系统层显式停用（不会被环境变量复活）。
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">当前生效配置摘要</h2>
        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          <div className="flex justify-between gap-4 border-b pb-2">
            <span className="text-muted-foreground">来源</span>
            <span>{SOURCE_LABEL[config?.source ?? 'default'] ?? config?.source}</span>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <span className="text-muted-foreground">启用</span>
            <span>{config?.enabled ? '是' : '否'}</span>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <span className="text-muted-foreground">接口地址</span>
            <code className="truncate max-w-[60%]">{config?.baseUrl}</code>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <span className="text-muted-foreground">模型 ID</span>
            <code>{config?.model}</code>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <span className="text-muted-foreground">密钥</span>
            <span>{config?.hasApiKey ? config.apiKeyMasked : '未配置'}</span>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <span className="text-muted-foreground">允许私网</span>
            <span>{config?.allowPrivateNetwork ? '是' : '否'}</span>
          </div>
        </div>
        {config?.source === 'env' && (
          <p className="text-xs text-muted-foreground">
            当前由环境变量提供（<code>NAVHUB_LLM_*</code>）；保存后将由管理端配置覆盖。
          </p>
        )}
      </div>
        </>
      )}
    </div>
  )
}

