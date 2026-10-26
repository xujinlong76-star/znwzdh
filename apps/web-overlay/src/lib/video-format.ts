/**
 * 视频时长的纯格式化工具。
 *
 * 单独成模块的原因：消费方（video-card / video-player-page / 后台条目页）都是客户端组件，
 * 而 video-harvester.ts 会 import @/lib/github → @/lib/auth（next-auth 服务端运行时）。
 * 把纯函数留在采集器里会把整条服务端依赖图拖进首屏 chunk。
 */

/**
 * 清理并格式化时长（秒转 MM:SS 或 HH:MM:SS）
 */
export function formatDuration(durationSec?: number): string {
  if (!durationSec || durationSec <= 0) return ''
  const hours = Math.floor(durationSec / 3600)
  const minutes = Math.floor((durationSec % 3600) / 60)
  const seconds = durationSec % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
