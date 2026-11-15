export interface VoiceCommandIntent {
  action:
    | 'play'
    | 'pause'
    | 'seek_relative'
    | 'seek_absolute'
    | 'seek_chapter'
    | 'speed'
    | 'toggle_pip'
    | 'toggle_danmaku'
    | 'open_tab'
    | 'search_transcript'
    | 'next_video'
    | 'prev_video'
    | 'volume_change'
    | 'mute'
    | 'unmute'
    | 'unknown'
  value?: number
  deltaSec?: number
  targetChapter?: number
  speedMultiplier?: number
  /** volume_change 为相对调整（「大声点 / 小声点」）时的增量（0..1，如 ±0.1）。 */
  deltaVolume?: number
  targetTab?: string
  searchQuery?: string
  rawText: string
}

export interface VoiceCommanderListener {
  start: () => boolean
  stop: () => void
  isListening: () => boolean
  /** 当前浏览器是否提供真实的语音识别引擎（SpeechRecognition）。 */
  isSupported: () => boolean
  simulateVoiceInput: (text: string) => void
  onIntent: (callback: (intent: VoiceCommandIntent) => void) => () => void
}

export interface VoiceCommanderErrorInfo {
  /** fatal：已停听、需用户处理（权限/设备/服务）；transient：重试中或重试耗尽。 */
  kind: 'fatal' | 'transient'
  code: string
  /** 给用户的可操作提示，可直接进 toast。 */
  message: string
}

export interface VoiceCommanderOptions {
  onCommand?: (intent: VoiceCommandIntent) => void
  /** 识别器出错时回调（UI 由此恢复按钮状态并提示用户）。 */
  onError?: (info: VoiceCommanderErrorInfo) => void
}

/** 瞬时错误（network / no-speech）最多重试次数，指数退避 500ms 起。 */
const MAX_ERROR_RETRIES = 3
/** onend 异常结束时最多自动重启次数，耗尽后停听并提示用户手动重开。 */
const MAX_END_RESTARTS = 3
const RESTART_BACKOFF_BASE_MS = 500

const FATAL_RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许麦克风后重试',
  'service-not-allowed': '浏览器语音服务不可用，请检查网络后重试',
  'audio-capture': '未检测到麦克风，请检查设备后重试',
  'language-not-supported': '当前浏览器不支持中文语音识别',
}

/**
 * Initializes a Speech Recognition commander.
 * No fake fallback: if the browser provides no SpeechRecognition engine,
 * start() returns false and isSupported() is false — it never pretends to listen.
 *
 * 加固（Batch 3 第 10 项）：补 onerror——致命错误停听、按钮恢复可用态并给
 * 可操作提示；瞬时错误指数退避重试（上限 3 次）；onend 不再无条件死循环
 * 重启（上限 3 次 + 退避）；start() 有双重启动守卫（InvalidStateError）。
 */
export function createVoiceCommander(options?: VoiceCommanderOptions): VoiceCommanderListener {
  let listening = false
  /** 识别引擎当前是否已 start（与「用户想听」分开：stop() 后 onend 不应重启）。 */
  let recognitionActive = false
  let errorRetryCount = 0
  let endRestartCount = 0
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  const callbacks = new Set<(intent: VoiceCommandIntent) => void>()
  if (options?.onCommand) {
    callbacks.add(options.onCommand)
  }

  let recognition: any = null

  const clearPendingTimers = () => {
    if (restartTimer !== null) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  const tryStartRecognition = (): boolean => {
    if (!recognition || recognitionActive) return recognitionActive
    try {
      recognition.start()
      recognitionActive = true
      return true
    } catch {
      recognitionActive = false
      return false
    }
  }

  const scheduleRestart = (delayMs: number) => {
    clearPendingTimers()
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!listening) return
      tryStartRecognition()
    }, delayMs)
  }

  if (typeof window !== 'undefined') {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SpeechRecognition) {
      try {
        recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = false
        recognition.lang = 'zh-CN'

        recognition.onresult = (event: any) => {
          const lastIdx = event.results.length - 1
          const text = event.results[lastIdx][0].transcript
          // 引擎给的真实 confidence 不进意图：解析器是确定性正则，本无置信度可言。
          errorRetryCount = 0
          endRestartCount = 0
          const intent = parseVoiceCommandIntent(text)
          callbacks.forEach(cb => cb(intent))
        }

        recognition.onerror = (event: { error?: unknown }) => {
          const code = typeof event?.error === 'string' ? event.error : 'unknown'
          // stop() 触发的 aborted 不在聆听态，不处理。
          if (!listening) return
          recognitionActive = false
          const fatalMessage = FATAL_RECOGNITION_ERRORS[code]
          if (fatalMessage) {
            listening = false
            clearPendingTimers()
            options?.onError?.({ kind: 'fatal', code, message: fatalMessage })
            return
          }
          // 瞬时错误（network / no-speech / aborted / unknown）：退避重试，上限 3 次。
          if (errorRetryCount < MAX_ERROR_RETRIES) {
            const delayMs = RESTART_BACKOFF_BASE_MS * 2 ** errorRetryCount
            errorRetryCount += 1
            scheduleRestart(delayMs)
            return
          }
          listening = false
          clearPendingTimers()
          options?.onError?.({
            kind: 'transient',
            code,
            message: '语音识别多次重试失败，已停止聆听，请重新点击麦克风',
          })
        }

        recognition.onend = () => {
          recognitionActive = false
          if (!listening) return
          if (endRestartCount < MAX_END_RESTARTS) {
            const delayMs = RESTART_BACKOFF_BASE_MS * 2 ** endRestartCount
            endRestartCount += 1
            scheduleRestart(delayMs)
            return
          }
          listening = false
          options?.onError?.({
            kind: 'transient',
            code: 'ended',
            message: '语音识别已停止，请重新点击麦克风继续',
          })
        }
      } catch {
        recognition = null
      }
    }
  }

  const simulateVoiceInput = (text: string) => {
    const intent = parseVoiceCommandIntent(text)
    callbacks.forEach(cb => cb(intent))
  }

  return {
    start: () => {
      if (!recognition) return false
      // 双重启动守卫：已在听时直接返回 true，不再调 recognition.start()
      //（重复 start 会抛 InvalidStateError）。
      if (recognitionActive) return true
      listening = true
      errorRetryCount = 0
      endRestartCount = 0
      clearPendingTimers()
      const started = tryStartRecognition()
      if (!started) listening = false
      return started
    },
    stop: () => {
      listening = false
      recognitionActive = false
      clearPendingTimers()
      if (recognition) {
        try {
          recognition.stop()
        } catch {
          // Ignore stop error
        }
      }
    },
    isListening: () => listening,
    isSupported: () => recognition !== null,
    simulateVoiceInput,
    onIntent: (cb) => {
      callbacks.add(cb)
      return () => {
        callbacks.delete(cb)
      }
    },
  }
}
/**
 * Parses spoken Chinese/English voice transcripts into deterministic video action intents.
 */
export function parseVoiceCommandIntent(transcript: string): VoiceCommandIntent {
  const clean = transcript.trim().toLowerCase()

  // 1. Pause
  if (/暂停|停止|别播了|等一下|pause|stop|halt/i.test(clean)) {
    return { action: 'pause', rawText: transcript }
  }

  // 2. Play
  if (/继续|播放|开始|接着放|play|resume/i.test(clean)) {
    return { action: 'play', rawText: transcript }
  }

  // 3. Absolute seek (e.g., 跳转到 05:30, 跳转到第 5 分钟)
  const timeCodeMatch = clean.match(/(?:跳转到|跳到|定位到|定位)\s*(\d{1,2}):(\d{2})/i)
  if (timeCodeMatch) {
    const mins = parseInt(timeCodeMatch[1], 10)
    const secs = parseInt(timeCodeMatch[2], 10)
    const total = (mins * 60) + secs
    return { action: 'seek_absolute', value: total, rawText: transcript }
  }

  const minMatch = clean.match(/(?:跳转到|跳到)?第\s*(\d+)\s*分钟/i)
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10)
    return { action: 'seek_absolute', value: mins * 60, rawText: transcript }
  }

  // 4. Seek Backward (Relative)
  const backMatch = clean.match(/(?:快退|后退|倒退|回退|后撤|rewind|back)\s*(\d+)?\s*(?:秒|s)?/i)
  if (backMatch || /重看刚才|没看懂回一下/i.test(clean)) {
    const sec = backMatch && backMatch[1] ? parseInt(backMatch[1], 10) : 10
    const delta = -Math.abs(sec)
    return { action: 'seek_relative', deltaSec: delta, value: delta, rawText: transcript }
  }

  // 5. Seek Forward (Relative)
  const forwardMatch = clean.match(/(?:快进|前进|往前跳|跳过|forward)\s*(\d+)?\s*(?:秒|s)?/i)
  if (forwardMatch) {
    const sec = forwardMatch[1] ? parseInt(forwardMatch[1], 10) : 15
    const delta = Math.abs(sec)
    return { action: 'seek_relative', deltaSec: delta, value: delta, rawText: transcript }
  }

  // 6. Navigation: Next / Prev Video
  if (/下一集|下一个|下一首|下集|next/i.test(clean)) {
    return { action: 'next_video', rawText: transcript }
  }
  if (/上一集|上一个|上一首|上集|prev/i.test(clean)) {
    return { action: 'prev_video', rawText: transcript }
  }

  // 7. Tab Switching
  if (/打开.*脑图|查看.*脑图|切换.*脑图|脑图/i.test(clean)) {
    return { action: 'open_tab', targetTab: 'mindmap', rawText: transcript }
  }
  if (/打开.*雷达|查看.*雷达|疑惑雷达/i.test(clean)) {
    return { action: 'open_tab', targetTab: 'radar', rawText: transcript }
  }

  // 8. Transcript Search
  const searchMatch = clean.match(/(?:搜字幕|查字幕|搜索字幕|搜索)\s*(.+)/i)
  if (searchMatch) {
    return { action: 'search_transcript', searchQuery: searchMatch[1].trim(), rawText: transcript }
  }

  // 9. Seek Chapter
  const chapterMatch = clean.match(/(?:跳到|看)?第\s*(\d+)\s*章/i)
  if (chapterMatch) {
    const chIdx = parseInt(chapterMatch[1], 10)
    return { action: 'seek_chapter', targetChapter: chIdx, rawText: transcript }
  }

  // 10. Picture in Picture
  if (/画中画|悬浮窗|小窗|浮窗|pip/i.test(clean)) {
    return { action: 'toggle_pip', rawText: transcript }
  }

  // 11. Danmaku Toggle
  if (/弹幕|关闭弹幕|开启弹幕|清爽模式/i.test(clean)) {
    return { action: 'toggle_danmaku', rawText: transcript }
  }

  // 11b. Volume / mute — 「取消静音」含「静音」，unmute 必须先判。
  // 之前这里没有任何音量正则，volume_change / mute / unmute 是死类型成员。
  if (/取消静音|解除静音|恢复声音|打开声音|有声|unmute/i.test(clean)) {
    return { action: 'unmute', rawText: transcript }
  }
  if (/静音|关闭声音|关掉声音|声音关掉|mute/i.test(clean)) {
    return { action: 'mute', rawText: transcript }
  }
  const volumeMatch = clean.match(/(?:音量|声音|声量)\s*(?:调到|调至|设为|设置到)?\s*(\d{1,3})\s*(?:%|％|百分比)?/i)
  if (volumeMatch) {
    const pct = Math.min(100, Math.max(0, parseInt(volumeMatch[1], 10)))
    return { action: 'volume_change', value: pct, rawText: transcript }
  }
  if (/大声点|声音大(一点|些)|音量大(一点|些)|调大(音量|声音)|louder|volume up/i.test(clean)) {
    return { action: 'volume_change', deltaVolume: 0.1, rawText: transcript }
  }
  if (/小声点|声音小(一点|些)|音量小(一点|些)|调小(音量|声音)|quieter|volume down/i.test(clean)) {
    return { action: 'volume_change', deltaVolume: -0.1, rawText: transcript }
  }

  // 12. Speed change
  const speedMatch = clean.match(/(\d+(?:\.\d+)?)\s*倍速/i)
  if (speedMatch) {
    const val = parseFloat(speedMatch[1])
    return { action: 'speed', speedMultiplier: val, value: val, rawText: transcript }
  }
  if (/两倍速|2x/i.test(clean)) {
    return { action: 'speed', speedMultiplier: 2.0, value: 2.0, rawText: transcript }
  }
  if (/原速|一倍速|正常速度|1x/i.test(clean)) {
    return { action: 'speed', speedMultiplier: 1.0, value: 1.0, rawText: transcript }
  }
  if (/一点五倍速/i.test(clean)) {
    return { action: 'speed', speedMultiplier: 1.5, value: 1.5, rawText: transcript }
  }

  return { action: 'unknown', rawText: transcript }
}
