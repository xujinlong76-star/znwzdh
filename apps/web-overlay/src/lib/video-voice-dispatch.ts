/**
 * 视频页语音指令调度器（Batch 3 第 10 项，Stage 1）。
 *
 * 从 `video-player-page.tsx` 的 `handleVoiceCommand` 抽出的纯函数：原来
 * `play` / `pause` / `speed` / `mute` / `unmute` 是空 `break`（解析成功、
 * toast 却谎称「识别指令」），`seek_relative` 用不跟随进度的 `chapterSeekSec`
 * 当基数（播到 10:00 说「快退 10 秒」会跳回 0），`seek_chapter` / `toggle_pip`
 * 根本没有 case。现在每条意图都落到一个可断言的结果上，永不静默丢弃。
 *
 * 设计要点：
 * - 相对跳转只在可控路由上以注入的 `currentTimeSec`（真实进度）算出
 *   绝对目标再调 `seekTo`：基数可单测，执行器永远不用猜基数。iframe
 *   路由没有可读播放头（YouTube / 通用内嵌不回调进度，`currentTimeSec`
 *   会残留上一条视频的值），`seek_relative` 在 dispatch 层直接拒绝，
 *   绝不用过期基数算目标；绝对跳转（`seek_absolute`）不受影响。
 * - 倍速在 dispatch 层钳制到 0.5–2：解析器会产出 10 这种值，不能直通
 *   `playbackRate`。
 * - 播放类命令先看 `platformKind`：iframe 路由（B站官方内嵌 / YouTube /
 *   通用内嵌）页面 JS 控制不了对方播放器，直接返回 `unsupported` 并明说
 *   原因，不假装执行。绝对跳转在 iframe 路由上走执行器的 `seekTo` 重载
 *   路径（`chapterSeekSec` / `&start=`），由执行器在结果里标 `reloadsPlayer`。
 * - 弹幕开关没有可接的真实门禁（`isDanmakuOpen` 不控制任何渲染，B站官
 *   方内嵌的弹幕在对方 iframe 内），`toggle_danmaku` 直接返回
 *   `unsupported`，不假装已切换。
 * - 结果永远是 `{ status, message }`：`executed` / `unsupported`（含原因）
 *   / `not-understood`（含一句可用指令示例）。调用方按 status 渲染三态回执。
 */
import { chapterStartSec, type VideoChapter } from '@/types/navigation'
import type { VoiceCommandIntent } from './video-voice-commander'
import type { VideoPlayerTab } from '@/components/video-player-side-panel'

export type VoiceDispatchStatus = 'executed' | 'unsupported' | 'not-understood'

export interface VoiceCommandResult {
  status: VoiceDispatchStatus
  /** 给用户的回执文案（已是完整句子，可直接进 toast）。 */
  message: string
  /** iframe 路由上跳转会 remount 整个播放器，toast 需提示正在重载。 */
  reloadsPlayer?: boolean
}

export type PlayerCommandReason = 'iframe-no-control' | 'no-media' | 'play-blocked'

export interface PlayerCommandResult {
  ok: boolean
  reason?: PlayerCommandReason
  /** 跳转经 chapterSeekSec / &start= 重载了播放器（iframe 路由），调用方需在回执里注明。 */
  reloadsPlayer?: boolean
}

export type VoicePlatformKind = 'controllable' | 'iframe'

/**
 * 语音指令的执行器接口（可注入 fake 做单测）。
 *
 * `getVolume` 是相对调音量的读方法：「大声点 / 小声点」是 ±10% 的相对
 * 调整，执行器必须先读当前音量。`adjustVolume` 由执行器内部读 `getVolume`
 * 再写回，dispatch 只传增量；调完 dispatch 再读 `getVolume` 核对实际
 * 音量（钳制在 0/1 时不谎称「已调高/调低」）。
 *
 * 注意：接口里没有 `seekBy` / `toggleDanmaku`。相对跳转由 dispatch 层
 * 算好绝对目标调 `seekTo`（iframe 路由根本没有可读播放头，相对跳转
 * 在 dispatch 层直接拒绝）；弹幕开关没有可接的真实门禁，dispatch 直接
 * 返回 `unsupported`。执行器只暴露真实能做的事。
 */
export interface VideoVoiceExecutor {
  play: () => PlayerCommandResult | Promise<PlayerCommandResult>
  pause: () => PlayerCommandResult | Promise<PlayerCommandResult>
  seekTo: (sec: number) => PlayerCommandResult
  setRate: (rate: number) => PlayerCommandResult
  setVolume: (volume01: number) => PlayerCommandResult
  getVolume: () => number
  adjustVolume: (delta01: number) => PlayerCommandResult
  setMuted: (muted: boolean) => PlayerCommandResult
  openTab: (tab: VideoPlayerTab) => void
  searchTranscript: (query: string) => void
  nextVideo: () => void
  prevVideo: () => void
  requestPip: () => Promise<boolean>
}

export interface VideoVoiceDispatchContext {
  /** 真实播放进度（秒），相对跳转的唯一基数。 */
  currentTimeSec: number
  /** 是否有真实章节（`videoConfig.chapters` 非空）。 */
  hasRealChapters: boolean
  /** 真实章节（与 hasRealChapters 同源），供 seek_chapter 查 startSec。 */
  chapters: VideoChapter[]
  /** 脑图 tab 在 UI 上是否真的可开（`mindmapRoot.children.length > 0`）。 */
  mindmapAvailable: boolean
  transcriptAvailable: boolean
  isDocumentPipSupported: boolean
  platformKind: VoicePlatformKind
  /** 用于不支持提示的平台文案，如「官方内嵌播放器」「YouTube」。 */
  platformLabel: string
}

export const MIN_PLAYBACK_RATE = 0.5
export const MAX_PLAYBACK_RATE = 2
export const VOICE_COMMAND_EXAMPLE = '可以说：暂停、快进 30 秒、两倍速、下一集、静音'

/** 解析器只产出 mindmap / radar；白名单映射去掉 `as any`，未知值不进 tab。 */
const TAB_WHITELIST: Record<string, VideoPlayerTab> = {
  mindmap: 'mindmap',
  radar: 'radar',
}

function formatSeekTarget(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function notUnderstood(rawText: string): VoiceCommandResult {
  return {
    status: 'not-understood',
    message: `没听懂「${rawText}」，未执行。${VOICE_COMMAND_EXAMPLE}`,
  }
}

export async function dispatchVoiceCommand(
  intent: VoiceCommandIntent,
  executor: VideoVoiceExecutor,
  ctx: VideoVoiceDispatchContext,
): Promise<VoiceCommandResult> {
  const unsupportedPlayback = (what: string): VoiceCommandResult => ({
    status: 'unsupported',
    message: `当前为${ctx.platformLabel}，语音无法控制${what}，请用播放器自带按钮`,
  })

  /** 执行器返回失败时按原因翻译成用户能看懂的拒绝（不谎称已执行）。 */
  const fromExecutorFailure = (reason: PlayerCommandReason | undefined, what: string): VoiceCommandResult => {
    if (reason === 'iframe-no-control') return unsupportedPlayback(what)
    if (reason === 'play-blocked') {
      return { status: 'unsupported', message: '浏览器阻止了自动播放，请点一下播放器再试' }
    }
    if (reason === 'no-media') {
      return { status: 'unsupported', message: `播放器尚未就绪，${what}失败，请稍后再试` }
    }
    return { status: 'unsupported', message: `语音${what}失败，请重试` }
  }

  /** 跳转类：执行器 ok 即已执行；iframe 路由重载时在文案里注明。 */
  const seekResult = (res: PlayerCommandResult, message: string): VoiceCommandResult => {
    if (!res.ok) return fromExecutorFailure(res.reason, '跳转')
    return {
      status: 'executed',
      message: res.reloadsPlayer ? `${message}（正在重新加载播放器）` : message,
      reloadsPlayer: res.reloadsPlayer,
    }
  }

  switch (intent.action) {
    case 'play': {
      if (ctx.platformKind === 'iframe') return unsupportedPlayback('播放')
      const res = await executor.play()
      if (!res.ok) return fromExecutorFailure(res.reason, '播放')
      return { status: 'executed', message: '已开始播放' }
    }
    case 'pause': {
      if (ctx.platformKind === 'iframe') return unsupportedPlayback('暂停')
      const res = await executor.pause()
      if (!res.ok) return fromExecutorFailure(res.reason, '暂停')
      return { status: 'executed', message: '已暂停' }
    }
    case 'speed': {
      const raw = intent.speedMultiplier ?? intent.value
      if (raw === undefined || !Number.isFinite(raw)) return notUnderstood(intent.rawText)
      const rate = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, raw))
      if (ctx.platformKind === 'iframe') return unsupportedPlayback('倍速')
      const res = executor.setRate(rate)
      if (!res.ok) return fromExecutorFailure(res.reason, '倍速')
      return { status: 'executed', message: `已切换到 ${rate} 倍速` }
    }
    case 'volume_change': {
      if (ctx.platformKind === 'iframe') return unsupportedPlayback('音量')
      if (intent.deltaVolume !== undefined) {
        const res = executor.adjustVolume(intent.deltaVolume)
        if (!res.ok) return fromExecutorFailure(res.reason, '音量')
        // 以执行器钳制后的实际音量回执：在 1.0 / 0 处再调什么都没变，
        // 不能谎称「已调高/调低 10%」。
        const actual = executor.getVolume()
        if (intent.deltaVolume > 0 && actual >= 1) {
          return { status: 'executed', message: '音量已是最大' }
        }
        if (intent.deltaVolume < 0 && actual <= 0) {
          return { status: 'executed', message: '音量已是最小' }
        }
        return {
          status: 'executed',
          message: intent.deltaVolume > 0 ? '音量已调高 10%' : '音量已调低 10%',
        }
      }
      if (intent.value !== undefined && Number.isFinite(intent.value)) {
        const pct = Math.min(100, Math.max(0, Math.round(intent.value)))
        const res = executor.setVolume(pct / 100)
        if (!res.ok) return fromExecutorFailure(res.reason, '音量')
        return { status: 'executed', message: `音量已设为 ${pct}%` }
      }
      return notUnderstood(intent.rawText)
    }
    case 'mute': {
      if (ctx.platformKind === 'iframe') return unsupportedPlayback('静音')
      const res = executor.setMuted(true)
      if (!res.ok) return fromExecutorFailure(res.reason, '静音')
      return { status: 'executed', message: '已静音' }
    }
    case 'unmute': {
      if (ctx.platformKind === 'iframe') return unsupportedPlayback('静音')
      const res = executor.setMuted(false)
      if (!res.ok) return fromExecutorFailure(res.reason, '静音')
      return { status: 'executed', message: '已取消静音' }
    }
    case 'seek_relative': {
      const delta = intent.deltaSec ?? intent.value
      if (delta === undefined || !Number.isFinite(delta)) return notUnderstood(intent.rawText)
      // iframe 路由没有可读播放头：currentTimeSec 只在 B站直连 / mp4
      // 回调里更新，切到 YouTube / 通用内嵌后会残留上一条视频的值。
      // 用过期基数算目标会跳错位置，故直接拒绝，引导用户说绝对时间。
      if (ctx.platformKind === 'iframe') {
        return {
          status: 'unsupported',
          message: '当前播放器无法读取进度，相对跳转不可用，请说「跳转到 05:30」',
        }
      }
      // 基数必须是真实进度 currentTimeSec，绝不能用只在章节点击时才置位的 chapterSeekSec。
      const target = Math.max(0, ctx.currentTimeSec + delta)
      const res = executor.seekTo(target)
      const verb = delta >= 0 ? '快进' : '快退'
      return seekResult(res, `已${verb} ${Math.abs(delta)} 秒`)
    }
    case 'seek_absolute': {
      if (intent.value === undefined || !Number.isFinite(intent.value)) return notUnderstood(intent.rawText)
      const target = Math.max(0, intent.value)
      const res = executor.seekTo(target)
      return seekResult(res, `已跳转到 ${formatSeekTarget(target)}`)
    }
    case 'seek_chapter': {
      if (!ctx.hasRealChapters) {
        return { status: 'unsupported', message: '本视频无真实章节，无法按章节跳转' }
      }
      const n = intent.targetChapter
      if (n === undefined || !Number.isFinite(n)) return notUnderstood(intent.rawText)
      if (n < 1 || n > ctx.chapters.length) {
        return { status: 'unsupported', message: `本视频只有 ${ctx.chapters.length} 章` }
      }
      const res = executor.seekTo(chapterStartSec(ctx.chapters[n - 1]))
      return seekResult(res, `已跳转到第 ${n} 章`)
    }
    case 'toggle_pip': {
      if (!ctx.isDocumentPipSupported) {
        return { status: 'unsupported', message: '当前浏览器不支持画中画' }
      }
      const opened = await executor.requestPip()
      if (!opened) {
        return { status: 'unsupported', message: '画中画打开失败，请重试' }
      }
      return { status: 'executed', message: '已打开画中画' }
    }
    case 'toggle_danmaku': {
      // 诚实拒绝：页面里没有弹幕可见性门禁可接（isDanmakuOpen 不控制任何
      // 渲染；B站官方内嵌的弹幕在对方 iframe 内，不受页面控制）。不调
      // 执行器、不谎称「已切换」。
      return {
        status: 'unsupported',
        message: '语音暂不能切换弹幕，请用播放器自带弹幕开关',
      }
    }
    case 'open_tab': {
      const tab = intent.targetTab ? TAB_WHITELIST[intent.targetTab] : undefined
      if (!tab) return notUnderstood(intent.rawText)
      if (tab === 'mindmap' && !ctx.mindmapAvailable) {
        return { status: 'unsupported', message: '本视频无真实章节，无法打开脑图' }
      }
      executor.openTab(tab)
      return { status: 'executed', message: tab === 'mindmap' ? '已打开脑图' : '已打开疑惑雷达' }
    }
    case 'search_transcript': {
      if (!ctx.transcriptAvailable) {
        return { status: 'unsupported', message: '暂无字幕可搜，可先导入字幕' }
      }
      if (!intent.searchQuery) return notUnderstood(intent.rawText)
      executor.searchTranscript(intent.searchQuery)
      return { status: 'executed', message: `正在搜索字幕「${intent.searchQuery}」` }
    }
    case 'next_video': {
      executor.nextVideo()
      return { status: 'executed', message: '已切换到下一集' }
    }
    case 'prev_video': {
      executor.prevVideo()
      return { status: 'executed', message: '已切换到上一集' }
    }
    case 'unknown':
    default:
      return notUnderstood(intent.rawText)
  }
}
