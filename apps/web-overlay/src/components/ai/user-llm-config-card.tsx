'use client'

/**
 * 个人设置中心：AI 模型配置卡片。
 *
 * 个人配置只影响「以当前身份发起」的 AI 请求；不配置时自动跟随系统默认。
 * 密钥加密存储、只回显掩码；用户级端点强制禁私网（防内网探测）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CheckCircle2, Loader2, RefreshCw, Save, Send, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { LlmConfigFields, type LlmFormValue } from './llm-config-form'
import { getIdentity } from '@/lib/identity'
import {
  chatWithUserLlm,
  deleteUserLlmConfig,
  fetchUserLlmConfig,
  saveUserLlmConfig,
  testUserLlmConfig,
  type HubAiChatResult,
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
    thinking: true,
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
  const [chatInput, setChatInput] = useState('')
  const [chatThinking, setChatThinking] = useState(true)
  const [chatting, setChatting] = useState(false)
  const [chatReply, setChatReply] = useState<HubAiChatResult | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)

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
          thinking: res.config.thinking ?? true,
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

  async function handleChat() {
    const content = chatInput.trim()
    if (!content || chatting || !identityRef.current) return
    setChatting(true)
    setChatError(null)
    setChatReply(null)
    try {
      const res = await chatWithUserLlm(
        identityRef.current,
        [{ role: 'user', content }],
        512,
        undefined,
        chatThinking,
      )
      setChatReply(res)
      setChatInput('')
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err))
    } finally {
      setChatting(false)
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
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-primary" />
          AI 模型（个人）
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* 未加载完成前不显示来源，避免闪现「内置默认」这种误导性文案 */}
          {view && (
            // 窄屏下徽标必须是可换行的：模型名 + 模型 id + 来源三截排在一行时，
            // 375px 上会被挤成竖排并顶出卡片（实测）。这里允许换行并让 id 可断词。
            <Badge variant="outline" className="max-w-full flex-wrap gap-x-1.5 gap-y-1 whitespace-normal py-1 text-xs">
              <span>当前生效：</span>
              <strong className="min-w-0 break-words text-foreground">
                {view.effective?.name ?? (view.configured ? view.name : view.system.name)}
              </strong>
              <span className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
                ({view.effective?.model ?? (view.configured ? view.model : view.system.model)})
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                {SOURCE_LABEL[view.effective?.source ?? (view.configured ? 'user' : view.system.source)] ?? '系统'}
              </span>
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

      {/* 试聊：验证解析链当前生效的模型（个人或系统默认） */}
      <div className="border-t pt-3 mt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs">试聊验证</Label>
            <span className="text-xs text-muted-foreground">
              当前生效：{view?.effective?.name || (view?.configured ? '个人配置' : '系统默认')}
            </span>
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={chatThinking}
              onChange={(e) => setChatThinking(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-[var(--primary)]"
            />
            <span>深度思考 (Thinking)</span>
          </label>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="试聊输入"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleChat()
            }}
            placeholder="输入一句话，例如：用一句话介绍你自己"
            disabled={chatting}
          />
          <Button size="sm" onClick={() => void handleChat()} disabled={chatting || !chatInput.trim()}>
            {chatting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
            发送
          </Button>
        </div>
        {chatError && <p className="text-xs text-destructive">{chatError}</p>}
        {chatReply && (
          <div className="rounded-md border bg-muted/30 p-2.5 space-y-2">
            {chatReply.reasoningContent && (
              <details className="rounded border border-primary/20 bg-primary/5 p-2 text-xs">
                <summary className="cursor-pointer font-medium text-primary select-none flex items-center gap-1 hover:text-primary/80">
                  <span>🧠 深度思考过程</span>
                  <span className="text-[10px] text-muted-foreground font-normal">(点击折叠/展开)</span>
                </summary>
                <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground pl-2 border-l-2 border-primary/30">
                  {chatReply.reasoningContent}
                </div>
              </details>
            )}
            <p className="text-xs whitespace-pre-wrap">{chatReply.reply}</p>
            <p className="text-[11px] text-muted-foreground">
              {chatReply.model} · {chatReply.latencyMs}ms · {chatReply.usage.totalTokens} tokens
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
