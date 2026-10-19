'use client'

/**
 * LLM 模型配置表单字段（管理端 / 个人设置中心共用）。
 *
 * 只负责「字段渲染 + 受控更新」，保存/测试等动作由调用方持有，
 * 这样两端的权限差异（是否允许私网、是否有启用开关）只体现在 props 上。
 */
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HubJsonMode } from '@/lib/navhub-api'

export interface LlmFormValue {
  enabled: boolean
  name: string
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  jsonMode: HubJsonMode
  allowPrivateNetwork: boolean
}

export const JSON_MODE_OPTIONS: Array<{ value: HubJsonMode; label: string }> = [
  { value: 'auto', label: '自动（推荐）' },
  { value: 'response_format', label: '强制 response_format' },
  { value: 'prompt', label: '仅提示词约束（兼容性最稳）' },
]

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export function LlmConfigFields({
  value,
  onChange,
  apiKeyMasked,
  showAllowPrivateNetwork = false,
  showEnabled = true,
  disabled = false,
}: {
  value: LlmFormValue
  onChange: (next: LlmFormValue) => void
  /** 已存密钥的掩码，用于 placeholder 与状态提示 */
  apiKeyMasked?: string
  /** 管理端可放开内网端点（本地 Ollama）；用户端强制关闭 */
  showAllowPrivateNetwork?: boolean
  showEnabled?: boolean
  disabled?: boolean
}) {
  const set = <K extends keyof LlmFormValue>(key: K, next: LlmFormValue[K]) =>
    onChange({ ...value, [key]: next })

  const num = (raw: string, fallback: number): number => {
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }

  return (
    <div className="space-y-5">
      {showEnabled && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-[var(--primary)]"
            checked={value.enabled}
            disabled={disabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          启用该模型配置（关闭后本层不参与解析）
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="llm-name">显示名称</Label>
          <Input
            id="llm-name"
            value={value.name}
            disabled={disabled}
            placeholder="Agnes 3.0 Flash"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="llm-model">模型 ID</Label>
          <Input
            id="llm-model"
            value={value.model}
            disabled={disabled}
            placeholder="agnes-3.0-flash"
            onChange={(e) => set('model', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="llm-base">接口地址（Base URL）</Label>
        <Input
          id="llm-base"
          value={value.baseUrl}
          disabled={disabled}
          placeholder="https://api.agnes-ai.cn/v1"
          onChange={(e) => set('baseUrl', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          网关会自动拼接 <code>/chat/completions</code>；填写完整终点亦可。
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="llm-key">API 密钥</Label>
        <Input
          id="llm-key"
          type="password"
          autoComplete="new-password"
          value={value.apiKey}
          disabled={disabled}
          placeholder={apiKeyMasked ? `已配置：${apiKeyMasked}（留空不修改）` : '尚未配置'}
          onChange={(e) => set('apiKey', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          密钥加密存储，任何接口都不会回显明文；留空表示保持原值。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="llm-timeout">超时（毫秒）</Label>
          <Input
            id="llm-timeout"
            type="number"
            min={1000}
            max={120000}
            step={1000}
            value={value.timeoutMs}
            disabled={disabled}
            onChange={(e) => set('timeoutMs', num(e.target.value, value.timeoutMs))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="llm-temp">温度</Label>
          <Input
            id="llm-temp"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={value.temperature}
            disabled={disabled}
            onChange={(e) => set('temperature', num(e.target.value, value.temperature))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="llm-max">最大输出 Tokens</Label>
          <Input
            id="llm-max"
            type="number"
            min={1}
            max={65536}
            step={64}
            value={value.maxTokens}
            disabled={disabled}
            onChange={(e) => set('maxTokens', num(e.target.value, value.maxTokens))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="llm-json">JSON 输出策略</Label>
        <select
          id="llm-json"
          className={SELECT_CLASS}
          value={value.jsonMode}
          disabled={disabled}
          onChange={(e) => set('jsonMode', e.target.value as HubJsonMode)}
        >
          {JSON_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          auto：先带 <code>response_format</code>，端点不支持时自动去参重试并记住能力。
        </p>
      </div>

      {showAllowPrivateNetwork && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input accent-[var(--primary)]"
            checked={value.allowPrivateNetwork}
            disabled={disabled}
            onChange={(e) => set('allowPrivateNetwork', e.target.checked)}
          />
          <span>
            允许内网接口地址（本地 Ollama 等）
            <span className="block text-xs text-muted-foreground mt-0.5">
              仅在确认服务端所在网络可信时开启；默认拒绝环回与私网地址。
            </span>
          </span>
        </label>
      )}
    </div>
  )
}
