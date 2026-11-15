/**
 * 视频语音指令调度器测试（Batch 3 第 10 项）。
 *
 * 测抽出的纯 dispatch + 注入的假执行器：空 break 已死——play/pause/speed/
 * mute/unmute 必须真实调到执行器；可控路由上 seek_relative 以注入的
 * currentTimeSec 为基数（播到 600 秒说「快退 10 秒」得 590，不是 0）；
 * iframe 路由没有可读播放头，相对跳转直接拒绝（不拿过期基数算目标），
 * 绝对跳转仍走重载路径；弹幕开关没有真实门禁，诚实拒绝；数据/平台门禁
 * 在 dispatch 层拒绝并给原因。
 */
import { describe, it, expect } from 'vitest'
import {
  dispatchVoiceCommand,
  type VideoVoiceDispatchContext,
  type VideoVoiceExecutor,
} from '@/lib/video-voice-dispatch'
import { parseVoiceCommandIntent } from '@/lib/video-voice-commander'
import type { VideoChapter } from '@/types/navigation'

interface Call {
  method: string
  arg?: unknown
}

function createFakeExecutor(options: { reloadSeeks?: boolean; volume?: number } = {}) {
  const calls: Call[] = []
  const ok = { ok: true as const }
  // 假执行器也像真执行器一样钳制音量：dispatch 靠调后 getVolume 判断
  // 是否真的调动了（已是最大/最小时不谎称「已调高/调低」）。
  let volume = options.volume ?? 0.5
  const executor: VideoVoiceExecutor = {
    play: () => {
      calls.push({ method: 'play' })
      return ok
    },
    pause: () => {
      calls.push({ method: 'pause' })
      return ok
    },
    seekTo: (sec: number) => {
      calls.push({ method: 'seekTo', arg: sec })
      // 真实执行器在 iframe 路由上经 chapterSeekSec / &start= 重载播放器，
      // 以 reloadsPlayer 标出，供 toast 注明「正在重新加载播放器」。
      return options.reloadSeeks ? { ok: true as const, reloadsPlayer: true as const } : ok
    },
    setRate: (rate: number) => {
      calls.push({ method: 'setRate', arg: rate })
      return ok
    },
    setVolume: (v: number) => {
      calls.push({ method: 'setVolume', arg: v })
      volume = Math.min(1, Math.max(0, v))
      return ok
    },
    getVolume: () => volume,
    adjustVolume: (d: number) => {
      calls.push({ method: 'adjustVolume', arg: d })
      volume = Math.min(1, Math.max(0, volume + d))
      return ok
    },
    setMuted: (m: boolean) => {
      calls.push({ method: 'setMuted', arg: m })
      return ok
    },
    openTab: (tab) => {
      calls.push({ method: 'openTab', arg: tab })
    },
    searchTranscript: (q: string) => {
      calls.push({ method: 'searchTranscript', arg: q })
    },
    nextVideo: () => {
      calls.push({ method: 'nextVideo' })
    },
    prevVideo: () => {
      calls.push({ method: 'prevVideo' })
    },
    requestPip: async () => {
      calls.push({ method: 'requestPip' })
      return true
    },
  }
  return { executor, calls }
}

function baseCtx(overrides: Partial<VideoVoiceDispatchContext> = {}): VideoVoiceDispatchContext {
  return {
    currentTimeSec: 600,
    hasRealChapters: true,
    chapters: [
      { title: '第一章', startTime: 0 },
      { title: '第二章', startTime: 300 },
      { title: '第三章', startTime: 600 },
    ] as VideoChapter[],
    mindmapAvailable: true,
    transcriptAvailable: true,
    isDocumentPipSupported: true,
    platformKind: 'controllable',
    platformLabel: 'B站高清直连',
    ...overrides,
  }
}

async function dispatch(
  text: string,
  executor: VideoVoiceExecutor,
  ctx: VideoVoiceDispatchContext,
) {
  return dispatchVoiceCommand(parseVoiceCommandIntent(text), executor, ctx)
}

describe('video voice dispatch: playback commands actually execute', () => {
  it('play / pause call the executor (no more empty breaks)', async () => {
    const { executor, calls } = createFakeExecutor()
    const played = await dispatch('继续播放', executor, baseCtx())
    expect(played.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'play' })

    const paused = await dispatch('暂停', executor, baseCtx())
    expect(paused.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'pause' })
  })

  it('speed calls setRate with the parsed multiplier', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('两倍速', executor, baseCtx())
    expect(res.status).toBe('executed')
    expect(res.message).toContain('2 倍速')
    expect(calls).toContainEqual({ method: 'setRate', arg: 2 })
  })

  it('clamps speed to 0.5–2 in the dispatch layer', async () => {
    const { executor, calls } = createFakeExecutor()
    await dispatch('10倍速', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'setRate', arg: 2 })

    await dispatch('0.1倍速', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'setRate', arg: 0.5 })
  })

  it('mute / unmute call setMuted', async () => {
    const { executor, calls } = createFakeExecutor()
    await dispatch('静音', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'setMuted', arg: true })

    await dispatch('取消静音', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'setMuted', arg: false })
  })

  it('volume absolute sets volume, relative adjusts by ±10%', async () => {
    const { executor, calls } = createFakeExecutor()
    const abs = await dispatch('音量 50%', executor, baseCtx())
    expect(abs.status).toBe('executed')
    expect(abs.message).toContain('50%')
    expect(calls).toContainEqual({ method: 'setVolume', arg: 0.5 })

    const louder = await dispatch('大声点', executor, baseCtx())
    expect(louder.status).toBe('executed')
    expect(louder.message).toContain('已调高 10%')
    expect(calls).toContainEqual({ method: 'adjustVolume', arg: 0.1 })

    await dispatch('小声点', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'adjustVolume', arg: -0.1 })
  })

  it('volume at max/min says so instead of lying about a change', async () => {
    const { executor, calls } = createFakeExecutor({ volume: 1 })
    const maxed = await dispatch('大声点', executor, baseCtx())
    expect(maxed.status).toBe('executed')
    expect(maxed.message).toContain('音量已是最大')
    expect(calls).toContainEqual({ method: 'adjustVolume', arg: 0.1 })

    const { executor: quietExecutor } = createFakeExecutor({ volume: 0 })
    const mined = await dispatch('小声点', quietExecutor, baseCtx())
    expect(mined.status).toBe('executed')
    expect(mined.message).toContain('音量已是最小')
  })
})

describe('video voice dispatch: seeks use the real current time', () => {
  it('seek_relative from injected currentTimeSec (600s, 快退 10 秒 → 590, not 0)', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('快退 10 秒', executor, baseCtx({ currentTimeSec: 600 }))
    expect(res.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'seekTo', arg: 590 })
  })

  it('seek_absolute jumps to the parsed timecode', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('跳转到 05:30', executor, baseCtx())
    expect(res.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'seekTo', arg: 330 })
  })

  it('seek_chapter jumps to the chapter start second', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('跳到第 3 章', executor, baseCtx())
    expect(res.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'seekTo', arg: 600 })
  })

  it('seek_chapter rejects without real chapters', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch(
      '跳到第 3 章',
      executor,
      baseCtx({ hasRealChapters: false, chapters: [] }),
    )
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('无真实章节')
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'seekTo' }))
  })

  it('seek_chapter rejects out-of-range targets', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('跳到第 99 章', executor, baseCtx())
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('只有 3 章')
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'seekTo' }))
  })
})

describe('video voice dispatch: platform and data gates', () => {
  it('iframe platform rejects playback commands with the platform reason and the right verb', async () => {
    const { executor, calls } = createFakeExecutor()
    const ctx = baseCtx({ platformKind: 'iframe', platformLabel: '官方内嵌播放器' })
    const res = await dispatch('暂停', executor, ctx)
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('官方内嵌播放器')
    expect(res.message).toContain('无法控制暂停')
    expect(calls).not.toContainEqual({ method: 'pause' })
  })

  it('iframe absolute seek still goes through, flagged as player reload', async () => {
    const { executor, calls } = createFakeExecutor({ reloadSeeks: true })
    const ctx = baseCtx({ platformKind: 'iframe', platformLabel: 'YouTube' })
    const res = await dispatch('跳转到 05:30', executor, ctx)
    expect(res.status).toBe('executed')
    expect(res.reloadsPlayer).toBe(true)
    expect(res.message).toContain('正在重新加载播放器')
    expect(calls).toContainEqual({ method: 'seekTo', arg: 330 })
  })

  it('iframe relative seek is rejected — no readable playhead, never a stale base', async () => {
    const { executor, calls } = createFakeExecutor({ reloadSeeks: true })
    const ctx = baseCtx({ platformKind: 'iframe', platformLabel: 'YouTube', currentTimeSec: 600 })
    const res = await dispatch('快进 30 秒', executor, ctx)
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('相对跳转不可用')
    expect(res.message).toContain('跳转到 05:30')
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'seekTo' }))
    expect(calls).toHaveLength(0)
  })

  it('open_tab mindmap rejects without real chapters', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch(
      '打开脑图',
      executor,
      baseCtx({ hasRealChapters: false, mindmapAvailable: false }),
    )
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('无真实章节')
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'openTab' }))
  })

  it('open_tab opens mindmap / radar when data exists', async () => {
    const { executor, calls } = createFakeExecutor()
    const mindmap = await dispatch('打开脑图', executor, baseCtx())
    expect(mindmap.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'openTab', arg: 'mindmap' })

    const radar = await dispatch('打开疑惑雷达', executor, baseCtx())
    expect(radar.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'openTab', arg: 'radar' })
  })

  it('toggle_pip rejects when PiP is unsupported', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch(
      '画中画',
      executor,
      baseCtx({ isDocumentPipSupported: false }),
    )
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('不支持画中画')
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'requestPip' }))
  })

  it('toggle_pip opens PiP when supported', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('画中画', executor, baseCtx())
    expect(res.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'requestPip' })
  })

  it('search_transcript is gated on transcript availability', async () => {
    const { executor, calls } = createFakeExecutor()
    const blocked = await dispatch(
      '搜字幕 架构',
      executor,
      baseCtx({ transcriptAvailable: false }),
    )
    expect(blocked.status).toBe('unsupported')
    expect(blocked.message).toContain('暂无字幕可搜')
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'searchTranscript' }))

    const ok = await dispatch('搜字幕 架构', executor, baseCtx())
    expect(ok.status).toBe('executed')
    expect(calls).toContainEqual({ method: 'searchTranscript', arg: '架构' })
  })

  it('next / prev video execute', async () => {
    const { executor, calls } = createFakeExecutor()
    await dispatch('下一集', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'nextVideo' })

    await dispatch('上一集', executor, baseCtx())
    expect(calls).toContainEqual({ method: 'prevVideo' })
  })

  it('toggle_danmaku is honestly unsupported — no danmaku gate exists to toggle', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('关闭弹幕', executor, baseCtx())
    expect(res.status).toBe('unsupported')
    expect(res.message).toContain('播放器自带弹幕开关')
    expect(calls).toHaveLength(0)
  })

  it('unknown returns not-understood with an example command', async () => {
    const { executor, calls } = createFakeExecutor()
    const res = await dispatch('今天天气怎么样', executor, baseCtx())
    expect(res.status).toBe('not-understood')
    expect(res.message).toContain('没听懂')
    expect(res.message).toContain('暂停')
    expect(calls).toHaveLength(0)
  })
})
