'use client'

/**
 * 管理端：AI 模型配置（系统默认模型）。
 *
 * 系统默认模型决定「所有未配置个人模型的调用」走哪个端点；
 * 密钥加密落库、只回显掩码，保存后立即刷新能力位（无需重启）。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, Loader2, RefreshCw, RotateCcw, Save, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { LlmConfigFields, type LlmFormValue } from '@/components/ai/llm-config-form'
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
    }
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          AI 模型配置
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          系统默认模型：所有未配置个人模型的 AI 调用都走这里。密钥加密存储，仅回显掩码。
        </p>
      </div>

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
    </div>
  )
}
