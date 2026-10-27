export interface VoiceCommandIntent {
  action:
    | 'play'
    | 'pause'
    | 'seek_relative'
    | 'seek_absolute'
    | 'seek_chapter'
    | 'speed'
    | 'speed_change'
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
  targetTab?: string
  searchQuery?: string
  rawText: string
  confidence: number
}

export interface VoiceCommanderListener {
  start: () => boolean
  stop: () => void
  isListening: () => boolean
  simulateVoiceInput: (text: string) => void
  onIntent: (callback: (intent: VoiceCommandIntent) => void) => () => void
}

export interface VoiceCommanderOptions {
  onCommand?: (intent: VoiceCommandIntent) => void
}

/**
 * Parses spoken Chinese/English voice transcripts into deterministic video action intents.
 */
export function parseVoiceCommandIntent(transcript: string): VoiceCommandIntent {
  const clean = transcript.trim().toLowerCase()

  // 1. Pause
  if (/暂停|停止|别播了|等一下|pause|stop|halt/i.test(clean)) {
    return { action: 'pause', rawText: transcript, confidence: 0.95 }
  }

  // 2. Play
  if (/继续|播放|开始|接着放|play|resume/i.test(clean)) {
    return { action: 'play', rawText: transcript, confidence: 0.95 }
  }

  // 3. Absolute seek (e.g., 跳转到 05:30, 跳转到第 5 分钟)
  const timeCodeMatch = clean.match(/(?:跳转到|跳到|定位到|定位)\s*(\d{1,2}):(\d{2})/i)
  if (timeCodeMatch) {
    const mins = parseInt(timeCodeMatch[1], 10)
    const secs = parseInt(timeCodeMatch[2], 10)
    const total = (mins * 60) + secs
    return { action: 'seek_absolute', value: total, rawText: transcript, confidence: 0.95 }
  }

  const minMatch = clean.match(/(?:跳转到|跳到)?第\s*(\d+)\s*分钟/i)
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10)
    return { action: 'seek_absolute', value: mins * 60, rawText: transcript, confidence: 0.92 }
  }

  // 4. Seek Backward (Relative)
  const backMatch = clean.match(/(?:快退|后退|倒退|回退|后撤|rewind|back)\s*(\d+)?\s*(?:秒|s)?/i)
  if (backMatch || /重看刚才|没看懂回一下/i.test(clean)) {
    const sec = backMatch && backMatch[1] ? parseInt(backMatch[1], 10) : 10
    const delta = -Math.abs(sec)
    return { action: 'seek_relative', deltaSec: delta, value: delta, rawText: transcript, confidence: 0.9 }
  }

  // 5. Seek Forward (Relative)
  const forwardMatch = clean.match(/(?:快进|前进|往前跳|跳过|forward)\s*(\d+)?\s*(?:秒|s)?/i)
  if (forwardMatch) {
    const sec = forwardMatch[1] ? parseInt(forwardMatch[1], 10) : 15
    const delta = Math.abs(sec)
    return { action: 'seek_relative', deltaSec: delta, value: delta, rawText: transcript, confidence: 0.9 }
  }

  // 6. Navigation: Next / Prev Video
  if (/下一集|下一个|下一首|下集|next/i.test(clean)) {
    return { action: 'next_video', rawText: transcript, confidence: 0.95 }
  }
  if (/上一集|上一个|上一首|上集|prev/i.test(clean)) {
    return { action: 'prev_video', rawText: transcript, confidence: 0.95 }
  }

  // 7. Tab Switching
  if (/打开.*脑图|查看.*脑图|切换.*脑图|脑图/i.test(clean)) {
    return { action: 'open_tab', targetTab: 'mindmap', rawText: transcript, confidence: 0.9 }
  }
  if (/打开.*终端|查看.*终端|切换.*终端|终端/i.test(clean)) {
    return { action: 'open_tab', targetTab: 'terminal', rawText: transcript, confidence: 0.9 }
  }
  if (/打开.*沙箱|运行.*沙箱|沙箱/i.test(clean)) {
    return { action: 'open_tab', targetTab: 'wasm', rawText: transcript, confidence: 0.9 }
  }
  if (/打开.*雷达|查看.*雷达|疑惑雷达/i.test(clean)) {
    return { action: 'open_tab', targetTab: 'radar', rawText: transcript, confidence: 0.9 }
  }

  // 8. Transcript Search
  const searchMatch = clean.match(/(?:搜字幕|查字幕|搜索字幕|搜索)\s*(.+)/i)
  if (searchMatch) {
    return { action: 'search_transcript', searchQuery: searchMatch[1].trim(), rawText: transcript, confidence: 0.9 }
  }

  // 9. Seek Chapter
  const chapterMatch = clean.match(/(?:跳到|看)?第\s*(\d+)\s*章/i)
  if (chapterMatch) {
    const chIdx = parseInt(chapterMatch[1], 10)
    return { action: 'seek_chapter', targetChapter: chIdx, rawText: transcript, confidence: 0.92 }
  }

  // 10. Picture in Picture
  if (/画中画|悬浮窗|小窗|浮窗|pip/i.test(clean)) {
    return { action: 'toggle_pip', rawText: transcript, confidence: 0.9 }
  }

  // 11. Danmaku Toggle
  if (/弹幕|关闭弹幕|开启弹幕|清爽模式/i.test(clean)) {
    return { action: 'toggle_danmaku', rawText: transcript, confidence: 0.88 }
  }

  // 12. Speed change
  const speedMatch = clean.match(/(\d+(?:\.\d+)?)\s*倍速/i)
  if (speedMatch) {
    const val = parseFloat(speedMatch[1])
    return { action: 'speed', speedMultiplier: val, value: val, rawText: transcript, confidence: 0.95 }
  }
  if (/两倍速|2x/i.test(clean)) {
    return { action: 'speed', speedMultiplier: 2.0, value: 2.0, rawText: transcript, confidence: 0.95 }
  }
  if (/原速|一倍速|正常速度|1x/i.test(clean)) {
    return { action: 'speed', speedMultiplier: 1.0, value: 1.0, rawText: transcript, confidence: 0.95 }
  }
  if (/一点五倍速/i.test(clean)) {
    return { action: 'speed', speedMultiplier: 1.5, value: 1.5, rawText: transcript, confidence: 0.95 }
  }

  return { action: 'unknown', rawText: transcript, confidence: 0.2 }
}

/**
 * Initializes a Speech Recognition commander with fallback simulation for non-webkit browsers.
 */
export function createVoiceCommander(options?: VoiceCommanderOptions): VoiceCommanderListener {
  let listening = false
  const callbacks = new Set<(intent: VoiceCommandIntent) => void>()
  if (options?.onCommand) {
    callbacks.add(options.onCommand)
  }

  let recognition: any = null

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
          const intent = parseVoiceCommandIntent(text)
          callbacks.forEach(cb => cb(intent))
        }

        recognition.onend = () => {
          if (listening) {
            try {
              recognition.start()
            } catch {
              // Ignore restart error
            }
          }
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
      listening = true
      if (recognition) {
        try {
          recognition.start()
          return true
        } catch {
          return false
        }
      }
      return true // Fallback simulation active
    },
    stop: () => {
      listening = false
      if (recognition) {
        try {
          recognition.stop()
        } catch {
          // Ignore stop error
        }
      }
    },
    isListening: () => listening,
    simulateVoiceInput,
    onIntent: (cb) => {
      callbacks.add(cb)
      return () => {
        callbacks.delete(cb)
      }
    },
  }
}
