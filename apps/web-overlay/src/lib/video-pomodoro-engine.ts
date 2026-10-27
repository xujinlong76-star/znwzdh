export type PomodoroPhase = 'work' | 'short_break' | 'long_break'

export interface PomodoroConfig {
  workDurationSec: number // e.g. 25 * 60 = 1500s
  shortBreakDurationSec: number // e.g. 5 * 60 = 300s
  longBreakDurationSec: number // e.g. 15 * 60 = 900s
  autoPauseVideoOnBreak: boolean
  enableAmbientSound: boolean
  longBreakInterval: number // cycles before long break (default 4)
}

export interface PomodoroState {
  phase: PomodoroPhase
  remainingSec: number
  isRunning: boolean
  completedCycles: number
  totalFocusedMinutes: number
}

export interface ErgonomicTip {
  title: string
  instruction: string
  durationSec: number
}

export const ERGONOMIC_BREAK_TIPS: ErgonomicTip[] = [
  {
    title: '20-20-20 护眼守则',
    instruction: '将目光转向 6 米（20英尺）外的远方物体，持续眨眼并眺望至少 20 秒，缓解睫状肌痉挛。',
    durationSec: 20,
  },
  {
    title: '颈椎与斜方肌伸展',
    instruction: '双手自然下垂，头部缓慢向左、右倾斜各拉伸 10 秒，缓解长期敲代码前倾颈部僵硬。',
    durationSec: 30,
  },
  {
    title: '补水与深呼吸',
    instruction: '饮用温水一杯，进行 3 次腹式深呼吸，保持大脑供氧充沛。',
    durationSec: 45,
  },
]

/**
 * Creates a soothing ambient noise buffer (Pink Noise / Binaural tone) via WebAudio.
 */
export function generatePinkNoiseBuffer(
  audioCtx: AudioContext,
  durationSec: number = 2
): AudioBuffer {
  const bufferSize = audioCtx.sampleRate * durationSec
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate)
  const data = buffer.getChannelData(0)

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < bufferSize; i++) {
    const white = (Math.random() * 2) - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.96900 * b2 + white * 0.1538520
    b3 = 0.86650 * b3 + white * 0.3104856
    b4 = 0.55000 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.0168980
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04
    b6 = white * 0.115926
  }

  return buffer
}

/**
 * State machine managing study/break cycles and ergonomic prompts.
 */
export class PomodoroSessionManager {
  private config: PomodoroConfig
  private state: PomodoroState
  private listeners = new Set<(state: PomodoroState) => void>()

  constructor(initialConfig?: Partial<PomodoroConfig>) {
    this.config = {
      workDurationSec: 25 * 60,
      shortBreakDurationSec: 5 * 60,
      longBreakDurationSec: 15 * 60,
      autoPauseVideoOnBreak: true,
      enableAmbientSound: false,
      longBreakInterval: 4,
      ...initialConfig,
    }

    this.state = {
      phase: 'work',
      remainingSec: this.config.workDurationSec,
      isRunning: false,
      completedCycles: 0,
      totalFocusedMinutes: 0,
    }
  }

  getState(): PomodoroState {
    return { ...this.state }
  }

  getConfig(): PomodoroConfig {
    return { ...this.config }
  }

  start(): void {
    this.state.isRunning = true
    this.emit()
  }

  pause(): void {
    this.state.isRunning = false
    this.emit()
  }

  reset(): void {
    this.state.isRunning = false
    this.state.phase = 'work'
    this.state.remainingSec = this.config.workDurationSec
    this.emit()
  }

  tickSecond(): void {
    if (!this.state.isRunning) return

    if (this.state.remainingSec > 1) {
      this.state.remainingSec--
      if (this.state.phase === 'work' && this.state.remainingSec % 60 === 0) {
        this.state.totalFocusedMinutes++
      }
    } else {
      // Phase transition
      if (this.state.phase === 'work') {
        this.state.completedCycles++
        const isLong = this.state.completedCycles % this.config.longBreakInterval === 0
        this.state.phase = isLong ? 'long_break' : 'short_break'
        this.state.remainingSec = isLong ? this.config.longBreakDurationSec : this.config.shortBreakDurationSec
      } else {
        this.state.phase = 'work'
        this.state.remainingSec = this.config.workDurationSec
      }
    }

    this.emit()
  }

  subscribe(cb: (state: PomodoroState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    const copy = this.getState()
    this.listeners.forEach(cb => cb(copy))
  }
}
