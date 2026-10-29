'use client'

import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Webhook, Radio, Send, Copy, Check, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'

interface VideoMultisourceWebhookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoMultisourceWebhookDialog({
  open,
  onOpenChange,
}: VideoMultisourceWebhookDialogProps) {
  const [copied, setCopied] = useState<boolean>(false)
  const [isDispatching, setIsDispatching] = useState<boolean>(false)
  const [responseLog, setResponseLog] = useState<string | null>(null)
  const [endpointStatus, setEndpointStatus] = useState<{ configured: boolean; text: string }>({
    configured: false,
    text: '正在检查端点状态...',
  })

  const webhookEndpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/videos/webhook-harvest` : '/api/videos/webhook-harvest'

  useEffect(() => {
    if (!open) return
    let active = true
    fetch('/api/videos/webhook-harvest')
      .then(res => res.json())
      .then(res => {
        if (!active) return
        if (res?.data?.status === 'active') {
          setEndpointStatus({ configured: true, text: 'Active / 200 OK' })
        } else {
          setEndpointStatus({ configured: false, text: '仅管理员测试 (未配置外部密钥)' })
        }
      })
      .catch(() => {
        if (!active) return
        setEndpointStatus({ configured: false, text: '离线' })
      })
    return () => {
      active = false
    }
  }, [open])

  const samplePayload = {
    event: 'video_published',
    timestamp: Date.now(),
    source: 'bilibili',
    data: {
      id: 'BV1vS4y1w7Xy',
      title: 'DeepSeek-R1 全尺寸本地大模型 Ollama + vLLM 推理加速与私有微调指南',
      description: '探讨 LLM、Agent 原理、RAG 向量检索以及分布式架构调优。',
      author: 'AI 架构先锋',
      durationSec: 1980,
      url: 'https://www.bilibili.com/video/BV1vS4y1w7Xy',
      domain: 'cat_ai_engineering',
    },
  }

  const handleCopyEndpoint = () => {
    void copyText(webhookEndpoint).then((result) => {
      if (!result.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleSendTestWebhook = async () => {
    setIsDispatching(true)
    setResponseLog('📡 正在向服务端 Webhook 路由发送测试负载（带管理员安全调试上下文）...')

    try {
      const res = await fetch('/api/videos/webhook-harvest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-test': '1',
        },
        body: JSON.stringify(samplePayload),
      })

      const data = await res.json()
      setResponseLog(JSON.stringify(data, null, 2))
    } catch (err: any) {
      setResponseLog(`❌ 发送失败: ${err?.message || err}`)
    } finally {
      setIsDispatching(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Webhook className="w-5 h-5" />
            </div>
            <div>
              <span>多源数据采集与 Webhook 自动化分发控制台</span>
              <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                支持 Bilibili API / YouTube RSS / GitHub Trending / 自动化流水线回调
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-3 pr-1 text-xs">
          {/* Endpoint Info */}
          <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                <span>对外监听接收端点 (Webhook Listener)</span>
              </span>
              <span className={cn(
                "px-2 py-0.5 rounded text-[10px] font-mono border",
                endpointStatus.configured
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              )}>
                {endpointStatus.text}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input aria-label="Webhook 接收地址"
                type="text"
                readOnly
                value={webhookEndpoint}
                className="flex-1 h-8 px-2.5 rounded-md bg-background border border-border font-mono text-[11px] text-muted-foreground select-all focus:outline-none"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyEndpoint}
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '已复制' : '复制'}</span>
              </Button>
            </div>
          </div>

          {/* Sources Status */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/60">
              <div className="font-medium text-foreground">Bilibili API 适配器</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">解析 vlist & stat 投币比</div>
              <div className="text-[10px] text-emerald-500 font-mono mt-1">● 直连正常</div>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/60">
              <div className="font-medium text-foreground">YouTube RSS 订阅源</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Atom/XML 格式自动解析</div>
              <div className="text-[10px] text-emerald-500 font-mono mt-1">● 就绪待触发</div>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/60">
              <div className="font-medium text-foreground">GitHub Trending</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">高星项目架构课自动转译</div>
              <div className="text-[10px] text-emerald-500 font-mono mt-1">● 每日同步</div>
            </div>
          </div>

          {/* Test Dispatch Console */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5 font-mono">
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span>分发测试与返回报文</span>
              </span>
              <Button
                size="sm"
                onClick={handleSendTestWebhook}
                disabled={isDispatching}
                className="h-7 px-2.5 text-[11px] gap-1.5 font-medium"
              >
                <Send className="w-3 h-3" />
                <span>{isDispatching ? '发送中...' : '发送测试 Webhook'}</span>
              </Button>
            </div>

            <pre className="h-36 p-3 rounded-lg border border-border/70 bg-zinc-950 font-mono text-[11px] text-zinc-300 overflow-y-auto leading-relaxed shadow-inner">
              {responseLog || '// 就绪。点击上方“发送测试 Webhook”模拟外部发布源推送入库。'}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
