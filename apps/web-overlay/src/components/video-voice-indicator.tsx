'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  createVoiceCommander,
  type VoiceCommandIntent,
  type VoiceCommanderErrorInfo,
} from '@/lib/video-voice-commander'
import type { VoiceCommandResult } from '@/lib/video-voice-dispatch'
import { Mic, MicOff, AlertTriangle, HelpCircle, Check } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

interface VideoVoiceIndicatorProps {
  /** 返回 dispatch 的三态回执（executed / unsupported / not-understood），
   *  指示器据此渲染回执；返回 void 时不显示回执。 */
  onCommand: (intent: VoiceCommandIntent) => VoiceCommandResult | Promise<VoiceCommandResult> | void
  className?: string
}

type Receipt = {
  status: 'executed' | 'unsupported' | 'not-understood' | 'error'
  message: string
}

const RECEIPT_STYLE: Record<Receipt['status'], { icon: typeof Check; classes: string }> = {
  executed: { icon: Check, classes: 'border-emerald-500/50 text-emerald-200' },
  unsupported: { icon: AlertTriangle, classes: 'border-amber-500/50 text-amber-200' },
  'not-understood': { icon: HelpCircle, classes: 'border-sky-500/50 text-sky-200' },
  error: { icon: MicOff, classes: 'border-red-500/50 text-red-200' },
}

export function VideoVoiceIndicator({
  onCommand,
  className,
}: VideoVoiceIndicatorProps) {
  const [isListening, setIsListening] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const receiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCommandRef = useRef(onCommand)

  const showReceipt = useCallback((next: Receipt) => {
    setReceipt(next)
    if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current)
    receiptTimerRef.current = setTimeout(() => setReceipt(null), 4000)
  }, [])

  const [commander] = useState(() => createVoiceCommander({
    onError: (info: VoiceCommanderErrorInfo) => {
      // 致命错误（权限/设备/服务）已停听：按钮恢复可用态并给可操作提示，
      // 红灯不再假亮。
      setIsListening(false)
      showReceipt({ status: 'error', message: info.message })
    },
  }))
  const supported = commander.isSupported()

  // onCommand 每渲染都可能变（父组件的 useCallback 依赖真实进度等），
  // 用 ref 持有最新版，订阅只建立一次。
  useEffect(() => {
    onCommandRef.current = onCommand
  }, [onCommand])

  useEffect(() => {
    const unsubscribe = commander.onIntent((intent) => {
      void (async () => {
        const result = await onCommandRef.current(intent)
        if (!result) return
        showReceipt({ status: result.status, message: result.message })
      })()
    })
    return () => {
      unsubscribe()
      // 切页即停听（隐私：不录音、不上传、离开即停）。
      commander.stop()
      if (receiptTimerRef.current) {
        clearTimeout(receiptTimerRef.current)
        receiptTimerRef.current = null
      }
    }
  }, [commander, showReceipt])

  const toggleListening = () => {
    if (isListening) {
      commander.stop()
      setIsListening(false)
    } else {
      const ok = commander.start()
      setIsListening(ok)
      if (!ok) {
        showReceipt({ status: 'error', message: '无法启动语音识别，请确认浏览器支持语音识别并已允许麦克风' })
      }
    }
  }

  const receiptStyle = receipt ? RECEIPT_STYLE[receipt.status] : null
  const ReceiptIcon = receiptStyle?.icon

  return (
    <div className={cn("relative flex items-center", className)}>
      <Button
        size="icon"
        variant={isListening ? "default" : "ghost"}
        onClick={toggleListening}
        disabled={!supported}
        className={cn(
          "relative transition-all",
          isListening && "bg-red-500 hover:bg-red-600 text-white animate-pulse"
        )}
        title={
          !supported
            ? "当前浏览器不支持语音识别（需要 SpeechRecognition），语音入口不可用"
            : isListening
              ? "正在聆听语音指令 (点击关闭)"
              : "开启语音助手 (如'暂停'、'快退10秒')"
        }
      >
        {isListening ? (
          <Mic className="w-4 h-4 animate-bounce" />
        ) : (
          <MicOff className="w-4 h-4 text-muted-foreground" />
        )}
      </Button>

      {/* 三态执行回执：已执行 / 不支持（带原因）/ 没听懂 / 识别器错误。
          回执文案本身就是可操作信息（原因 + 替代做法），必须完整可读：
          不截断、不单行——宁可换行占两行，也不把「请用播放器自带按钮」
          这类关键尾巴裁掉。 */}
      {receipt && ReceiptIcon && receiptStyle && (
        <div className="absolute top-12 right-0 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className={cn(
            "px-2.5 py-1.5 rounded-lg bg-zinc-950/90 text-[11px] font-medium leading-snug border shadow-xl backdrop-blur flex items-start gap-1.5 max-w-[480px]",
            receiptStyle.classes,
          )}>
            <ReceiptIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{receipt.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}
