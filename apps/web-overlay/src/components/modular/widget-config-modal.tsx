'use client'

import React, { useState, useEffect } from 'react'
import type { WidgetInstance } from '@/types/modular'
import { WIDGET_REGISTRY } from '@/lib/modular/registry'
import { X, Sliders, Check, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface WidgetConfigModalProps {
  widget: WidgetInstance | null
  isOpen: boolean
  onClose: () => void
  onSaveConfig: (id: string, newConfig: Record<string, any>, newTitle?: string) => void
}

export function WidgetConfigModal({
  widget,
  isOpen,
  onClose,
  onSaveConfig,
}: WidgetConfigModalProps) {
  const [configValues, setConfigValues] = useState<Record<string, any>>({})
  const [customTitle, setCustomTitle] = useState('')

  useEffect(() => {
    if (widget) {
      setConfigValues(widget.config || {})
      setCustomTitle(widget.customTitle || '')
    }
  }, [widget])

  if (!isOpen || !widget) return null

  const def = WIDGET_REGISTRY[widget.type]
  if (!def) return null

  const schemas = def.configSchema || []

  const handleFieldChange = (key: string, value: any) => {
    setConfigValues((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    onSaveConfig(widget.id, configValues, customTitle.trim() || undefined)
    onClose()
  }

  const handleResetDefaults = () => {
    const defaults: Record<string, any> = {}
    schemas.forEach((s) => {
      defaults[s.key] = s.defaultValue
    })
    setConfigValues(defaults)
    setCustomTitle('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-background border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">配置模块参数</h2>
              <p className="text-xs text-muted-foreground">{def.title}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* 配置表单 */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* 自定义模块标题 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">模块显示标题</label>
            <input
              type="text"
              placeholder={def.title}
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background outline-none focus:border-primary/60"
            />
            <p className="text-xs text-muted-foreground">留空则默认使用模块官方标题</p>
          </div>

          {/* 专属配置项 */}
          {schemas.length > 0 ? (
            schemas.map((schema) => (
              <div key={schema.key} className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>{schema.label}</span>
                  {schema.description && (
                    <span className="text-xs text-muted-foreground font-normal">{schema.description}</span>
                  )}
                </label>

                {schema.type === 'select' && (
                  <select
                    value={configValues[schema.key] ?? schema.defaultValue}
                    onChange={(e) => handleFieldChange(schema.key, e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background outline-none focus:border-primary/60"
                  >
                    {schema.options?.map((opt) => (
                      <option key={String(opt.value)} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {schema.type === 'boolean' && (
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={Boolean(configValues[schema.key] ?? schema.defaultValue)}
                      onChange={(e) => handleFieldChange(schema.key, e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                    />
                    <span className="text-xs text-muted-foreground">启用此特性</span>
                  </label>
                )}

                {schema.type === 'number' && (
                  <input
                    type="number"
                    value={configValues[schema.key] ?? schema.defaultValue}
                    onChange={(e) => handleFieldChange(schema.key, Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background outline-none focus:border-primary/60"
                  />
                )}

                {schema.type === 'text' && (
                  <input
                    type="text"
                    value={configValues[schema.key] ?? schema.defaultValue}
                    onChange={(e) => handleFieldChange(schema.key, e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background outline-none focus:border-primary/60 font-mono"
                  />
                )}
              </div>
            ))
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl border border-border/50">
              该模块无需额外参数，可直接自定义标题与尺寸排版。
            </div>
          )}

          {/* 底部按钮栏 */}
          <div className="flex items-center justify-between pt-3 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetDefaults}
              className="text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复默认</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
                取消
              </Button>
              <Button type="submit" size="sm" className="text-xs gap-1 shadow-xs">
                <Check className="w-3.5 h-3.5" />
                <span>保存并应用</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
