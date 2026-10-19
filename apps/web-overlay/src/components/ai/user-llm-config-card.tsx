'use client'

/**
 * 个人设置中心：AI 模型配置卡片。
 *
 * 个人配置只影响「以当前身份发起」的 AI 请求；不配置时自动跟随系统默认。
 * 密钥加密存储、只回显掩码；用户级端点强制禁私网（防内网探测）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CheckCircle2, Loader2, RefreshCw, Save, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { LlmConfigFields, type LlmFormValue } from './llm-config-form'
import { getIdentity } from '@/lib/identity'
import {
  deleteUserLlmConfig,
  fetchUserLlmConfig,
  saveUserLlmConfig,
  testUserLlmConfig,
  type HubLlmTestResult,
  type HubUserLlmConfigView,
} from '@/lib/navhub-api'

const SOURCE_LABEL: Record<string, string> = {
  db: '管理端配置',
  env: '环境变量',
  default: '内置默认',
  system: '系统配置',
  user: '个人配置',
}

function defaultForm(system?: HubUserLlmConfigView['system']): LlmFormValue {
  return {
    enabled: true,
    name: system?.name ?? 'Agnes 3.0 Flash',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    model: system?.model ?? 'agnes-3.0-flash',
    apiKey: '',
    timeoutMs: 20000,
    temperature: 0.2,
    maxTokens: 1024,
    jsonMode: 'auto',
    allowPrivateNetwork: false,
  }
}

export function UserLlmConfigCard() {
  const { toast } = useToast()
  /** 身份只在请求时使用（不参与渲染），放 ref 避免 effect 里 setState */
  const identityRef = useRef('')
  const [view, setView] = useState<HubUserLlmConfigView | null>(null)
  const [form, setForm] = useState<LlmFormValue>(defaultForm())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<HubLlmTestResult | null>(null)

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetchUserLlmConfig(id)
      setView(res.config)
      if (res.config.configured) {
        setForm({
          enabled: res.config.enabled,
          name: res.config.name,
          baseUrl: res.config.baseUrl,
          model: res.config.model,
          apiKey: '',
          timeoutMs: res.config.timeoutMs,
          temperature: res.config.temperature,
          maxTokens: res.config.maxTokens,
          jsonMode: res.config.jsonMode,
          allowPrivateNetwork: false,
        })
        setEditing(true)
      } else {
        setForm(defaultForm(res.config.system))
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = getIdentity()
    identityRef.current = id
    // 延后一拍再拉取：避免 effect 同步触发 setState（React 编译器卫生规则）
    const timer = setTimeout(() => void load(id), 0)
    return () => clearTimeout(timer)
  }, [load])

  function payload() {
    return {
      enabled: true,
      name: form.name.trim() || '我的模型',
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      timeoutMs: form.timeoutMs,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      jsonMode: form.jsonMode,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    }
  }

  async function handleSave() {
    setSaving(true)
    setTestResult(null)
    try {
      await saveUserLlmConfig(identityRef.current, payload())
      toast({ title: '已保存', description: '个人模型配置已生效（仅影响你自己的 AI 请求）。' })
      setForm((f) => ({ ...f, apiKey: '' }))
      await load(identityRef.current)
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

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testUserLlmConfig(identityRef.current, payload())
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
    try {
      const res = await deleteUserLlmConfig(identityRef.current)
      setView(res.config)
      setEditing(false)
      setTestResult(null)
      setForm(defaultForm(res.config.system))
      toast({ title: '已恢复跟随系统', description: '个人配置已删除。' })
    } catch (err) {
      toast({
        title: '恢复失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          AI 模型（个人）
        </h2>
        <div className="flex items-center gap-2">
          {/* 未加载完成前不显示来源，避免闪现「内置默认」这种误导性文案 */}
          {view && (
            <Badge variant="outline">
              当前：{view.configured ? '个人配置' : `跟随系统（${SOURCE_LABEL[view.system.source] ?? ''}）`}
            </Badge>
          )}
          {!editing && view?.system && (
            <span className="text-xs text-muted-foreground">
              系统默认：{view.system.name} · {view.system.model}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载个人模型配置…
        </div>
      ) : loadError ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load(identityRef.current)}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      ) : !editing ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            你可以为当前身份单独配置模型（接口地址、模型 ID、密钥）。不配置或清除后，自动跟随系统默认。
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Bot className="mr-2 h-3.5 w-3.5" />
            使用我的模型
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <LlmConfigFields
            value={form}
            onChange={setForm}
            apiKeyMasked={view?.configured && view.hasApiKey ? view.apiKeyMasked : ''}
            showEnabled={false}
            showAllowPrivateNetwork={false}
          />
          <p className="text-xs text-muted-foreground">
            个人配置仅影响以你的身份发起的 AI 请求；密钥加密存储，仅显示掩码。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              保存
            </Button>
            <Button size="sm" variant="outline" onClick={() => void handleTest()} disabled={testing}>
              {testing ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              测试连接
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleReset()}
              disabled={!view?.configured}
            >
              恢复跟随系统
            </Button>
          </div>

          {testResult && (
            <div
              className={
                'rounded-md border p-2.5 text-xs ' +
                (testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                  : 'border-destructive/30 bg-destructive/5 text-destructive')
              }
            >
              <div className="flex items-center gap-1.5 font-medium">
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.ok ? `连通成功 · ${testResult.latencyMs}ms` : '连通失败'}
              </div>
              <p className="mt-1 text-muted-foreground">
                {testResult.ok
                  ? `模型 ${testResult.model} · 回复：${testResult.replyPreview || '(空)'}`
                  : testResult.error}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
