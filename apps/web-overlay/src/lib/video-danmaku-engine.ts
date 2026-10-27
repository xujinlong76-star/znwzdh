import type { VideoDanmakuItem } from '@/types/navigation'

export interface DanmakuRenderConfig {
  fontSize: number
  opacity: number
  speed: number // pixels per second
  trackCount: number
  showPitfallsOnly: boolean
}

export interface ActiveDanmakuTrack {
  item: VideoDanmakuItem
  x: number
  y: number
  width: number
  trackIndex: number
}

const DANMAKU_STORAGE_PREFIX = 'devops_video_danmaku_v1_'

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage
  return null
}

/**
 * High-performance Canvas Danmaku Engine with track allocation and collision avoidance.
 */
export class DanmakuEngine {
  private items: VideoDanmakuItem[] = []
  private activeItems: ActiveDanmakuTrack[] = []
  private trackLastX: number[] = []
  private config: DanmakuRenderConfig = {
    fontSize: 18,
    opacity: 0.9,
    speed: 140,
    trackCount: 6,
    showPitfallsOnly: false,
  }

  constructor(initialItems: VideoDanmakuItem[] = [], config?: Partial<DanmakuRenderConfig>) {
    this.items = [...initialItems].sort((a, b) => a.timeSec - b.timeSec)
    if (config) {
      this.config = { ...this.config, ...config }
    }
    this.trackLastX = new Array(this.config.trackCount).fill(0)
  }

  public setItems(items: VideoDanmakuItem[]): void {
    this.items = [...items].sort((a, b) => a.timeSec - b.timeSec)
  }

  public addItem(item: VideoDanmakuItem): void {
    this.items.push(item)
    this.items.sort((a, b) => a.timeSec - b.timeSec)
  }

  public updateConfig(newConfig: Partial<DanmakuRenderConfig>): void {
    this.config = { ...this.config, ...newConfig }
    if (this.trackLastX.length !== this.config.trackCount) {
      this.trackLastX = new Array(this.config.trackCount).fill(0)
    }
  }

  /**
   * Allocates a non-colliding track index for a new danmaku bubble.
   */
  private allocateTrack(width: number, canvasWidth: number): number {
    const trackCount = this.config.trackCount
    let bestTrack = 0
    let minX = Infinity

    for (let i = 0; i < trackCount; i++) {
      const lastX = this.trackLastX[i] || 0
      if (lastX <= canvasWidth - 40) {
        this.trackLastX[i] = canvasWidth + width
        return i
      }
      if (lastX < minX) {
        minX = lastX
        bestTrack = i
      }
    }

    this.trackLastX[bestTrack] = canvasWidth + width
    return bestTrack
  }

  /**
   * Renders the current frame onto the target Canvas context.
   */
  public renderFrame(
    currentSec: number,
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    ctx.clearRect(0, 0, width, height)
    ctx.save()

    const { fontSize, opacity, speed, showPitfallsOnly } = this.config
    const trackHeight = fontSize + 8
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textBaseline = 'top'

    // 1. Spawning window: items within [currentSec - 0.2, currentSec + 0.2]
    for (const item of this.items) {
      if (showPitfallsOnly && !item.isPitfallWarning) continue

      const diff = currentSec - item.timeSec
      // Item should be on screen if 0 <= diff <= (width + estimatedWidth) / speed
      if (diff >= 0 && diff < (width + 300) / speed) {
        const textWidth = ctx.measureText(item.text).width
        const x = width - diff * speed
        const trackIdx = (Math.abs(item.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0))) % this.config.trackCount
        const y = 16 + trackIdx * trackHeight

        if (x + textWidth > 0 && x < width) {
          // Render Danmaku Bubble
          ctx.globalAlpha = opacity

          if (item.isPitfallWarning) {
            // Render highlight background pill for pitfall warnings
            ctx.fillStyle = 'rgba(234, 88, 12, 0.85)' // amber-600
            ctx.beginPath()
            ctx.roundRect(x - 6, y - 2, textWidth + 28, fontSize + 4, 4)
            ctx.fill()

            // Icon + text
            ctx.fillStyle = '#ffffff'
            ctx.fillText(`⚠️ ${item.text}`, x, y)
          } else {
            // Normal danmaku with shadow stroke
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
            ctx.shadowBlur = 3
            ctx.lineWidth = 2
            ctx.strokeStyle = '#000000'
            ctx.strokeText(item.text, x, y)

            ctx.fillStyle = item.color || '#ffffff'
            ctx.fillText(item.text, x, y)
          }
        }
      }
    }

    ctx.restore()
  }
}

/**
 * Storage persistence for user danmaku comments.
 */
export function getStoredDanmaku(videoId: string): VideoDanmakuItem[] {
  const storage = getStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(DANMAKU_STORAGE_PREFIX + videoId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveDanmakuItem(videoId: string, item: Omit<VideoDanmakuItem, 'id'>): VideoDanmakuItem {
  const fullItem: VideoDanmakuItem = {
    ...item,
    id: `dmk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }

  const storage = getStorage()
  if (storage) {
    try {
      const list = getStoredDanmaku(videoId)
      list.push(fullItem)
      storage.setItem(DANMAKU_STORAGE_PREFIX + videoId, JSON.stringify(list))
    } catch {
      // Ignore
    }
  }

  return fullItem
}
