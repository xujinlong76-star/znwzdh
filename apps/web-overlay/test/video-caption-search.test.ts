import { describe, it, expect } from 'vitest'
import {
  detectCaptionFormat,
  parseCaptions,
} from '../src/lib/video-transcript-sync'
import {
  CAPTION_STORE_KEY,
  collectBuiltinCaptionEntries,
  deleteCaptionEntry,
  formatCaptionTimestamp,
  getCaptionEntry,
  getCaptionStatus,
  highlightCaptionSegments,
  importCaptionsForVideo,
  loadCaptionEntries,
  mergeCaptionEntries,
  resolveVideoCaptions,
  saveCaptionEntry,
  searchCaptionEntries,
  type CaptionEntry,
} from '../src/lib/video-caption-store'
import { buildVideoEmbedUrlForSeo } from '../src/lib/video-embed-url'
import type { NavigationSubItem, VideoTranscriptItem } from '../src/types/navigation'

/** 内存版 storage：localStorage 的测试替身，不碰真实浏览器存储。 */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}

const SRT_SAMPLE = `1
00:00:01,000 --> 00:00:04,000
你好，这里是第一句话

2
00:00:05,500 --> 00:00:08,000
机器学习入门
Machine learning basics
`

const VTT_SAMPLE = `WEBVTT

00:01.000 --> 00:04.000
你好，这里是第一句话

00:05.500 --> 00:08.000
机器学习入门
`

function videoItem(overrides: Partial<NavigationSubItem> = {}): NavigationSubItem {
  return {
    id: 'v1',
    title: '测试视频',
    href: 'https://example.com/v1',
    enabled: true,
    ...overrides,
  } as NavigationSubItem
}

function cue(startSec: number, text: string, translation?: string): VideoTranscriptItem {
  return { id: `cue-${startSec}`, startSec, endSec: startSec + 2, text, translation }
}

describe('视频字幕可搜：格式识别与带行号解析', () => {
  it('按内容识别 SRT / WebVTT，拿不准返回 unknown 而不是猜', () => {
    expect(detectCaptionFormat(SRT_SAMPLE)).toBe('srt')
    expect(detectCaptionFormat(VTT_SAMPLE)).toBe('vtt')
    expect(detectCaptionFormat('00:01.000 --> 00:04.000\n你好')).toBe('vtt')
    expect(detectCaptionFormat('just some words')).toBe('unknown')
    expect(detectCaptionFormat('')).toBe('unknown')
  })

  it('解析合法 SRT：时间戳、文本、第二行译文都保留', () => {
    const r = parseCaptions(SRT_SAMPLE)
    expect(r.format).toBe('srt')
    expect(r.errors).toEqual([])
    expect(r.cues).toHaveLength(2)
    expect(r.cues[0]).toMatchObject({ startSec: 1, endSec: 4, text: '你好，这里是第一句话' })
    expect(r.cues[1]).toMatchObject({
      startSec: 5.5,
      endSec: 8,
      text: '机器学习入门',
      translation: 'Machine learning basics',
    })
  })

  it('解析合法 WebVTT（含 WEBVTT 头与毫秒时间戳）', () => {
    const r = parseCaptions(VTT_SAMPLE)
    expect(r.format).toBe('vtt')
    expect(r.errors).toEqual([])
    expect(r.cues).toHaveLength(2)
    expect(r.cues[0]).toMatchObject({ startSec: 1, endSec: 4 })
  })

  it('坏时间戳行指出具体行号，有效条目仍保留、不静默丢弃', () => {
    const bad = `1
00:00:01,000 --> 00:00:04,000
第一句是对的

2
00:00:xx,000 --> 00:00:08,000
这一行时间戳是坏的

3
00:00:10,000 --> 00:00:12,000
第三句是对的
`
    const r = parseCaptions(bad)
    expect(r.cues).toHaveLength(2)
    expect(r.cues.map(c => c.text)).toEqual(['第一句是对的', '第三句是对的'])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].line).toBe(6)
    expect(r.errors[0].message).toContain('时间戳格式不对')
  })

  it('SRT 缺时间戳的段指出段首行号', () => {
    const bad = `1
00:00:01,000 --> 00:00:04,000
第一句

2
这段没有时间戳行
`
    const r = parseCaptions(bad)
    expect(r.cues).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].line).toBe(5)
    expect(r.errors[0].message).toContain('缺少时间戳')
  })

  it('结束时间不晚于开始时间时报错、不导入该条', () => {
    const bad = `WEBVTT

00:04.000 --> 00:01.000
时间倒置的字幕
`
    const r = parseCaptions(bad)
    expect(r.cues).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toContain('结束时间不晚于开始时间')
  })

  it('空内容与未知格式都报错、不返回假字幕', () => {
    expect(parseCaptions('').errors).toHaveLength(1)
    expect(parseCaptions('   ').errors).toHaveLength(1)
    const unknown = parseCaptions('hello world, no timestamps here')
    expect(unknown.format).toBe('unknown')
    expect(unknown.cues).toEqual([])
    expect(unknown.errors).toHaveLength(1)
  })
})

describe('视频字幕可搜：本地字幕库存取', () => {
  it('导入合法 SRT 后可读出；同视频再次导入覆盖旧字幕', () => {
    const storage = memoryStorage()
    const video = videoItem()
    const first = importCaptionsForVideo(video, SRT_SAMPLE, storage)
    expect(first.ok).toBe(true)
    expect(first.cueCount).toBe(2)
    expect(getCaptionEntry('v1', storage)?.cues).toHaveLength(2)

    const second = importCaptionsForVideo(video, VTT_SAMPLE, storage)
    expect(second.ok).toBe(true)
    expect(loadCaptionEntries(storage)).toHaveLength(1)
    expect(loadCaptionEntries(storage)[0].format).toBe('vtt')
  })

  it('格式错误的导入不写入、不覆盖已有的好字幕', () => {
    const storage = memoryStorage()
    const video = videoItem()
    expect(importCaptionsForVideo(video, SRT_SAMPLE, storage).ok).toBe(true)
    const bad = importCaptionsForVideo(video, '2\n这段没有时间戳行\n', storage)
    expect(bad.ok).toBe(false)
    expect(bad.errors.length).toBeGreaterThan(0)
    expect(getCaptionEntry('v1', storage)?.cues).toHaveLength(2)
  })

  it('删除已导入字幕后该视频恢复无字幕', () => {
    const storage = memoryStorage()
    importCaptionsForVideo(videoItem(), SRT_SAMPLE, storage)
    deleteCaptionEntry('v1', storage)
    expect(getCaptionEntry('v1', storage)).toBeNull()
    expect(loadCaptionEntries(storage)).toEqual([])
  })

  it('损坏的存储返回空列表、不抛错', () => {
    const storage = memoryStorage({ [CAPTION_STORE_KEY]: 'not-json{{{' })
    expect(loadCaptionEntries(storage)).toEqual([])
  })

  it('saveCaptionEntry 直接保存已解析条目', () => {
    const storage = memoryStorage()
    const saved = saveCaptionEntry(videoItem({ id: 'v9', title: '九号视频' }), [cue(3, '你好')], 'srt', storage)
    expect(saved.ok).toBe(true)
    expect(saved.entry?.videoId).toBe('v9')
    expect(getCaptionEntry('v9', storage)?.title).toBe('九号视频')
  })
})

describe('视频字幕可搜：字幕来源解析优先级', () => {
  it('导入字幕优先于自带字幕，自带优先于描述 VTT，都没有就是无字幕', () => {
    const builtin = [cue(10, '自带字幕')]
    const imported: CaptionEntry = {
      videoId: 'v1',
      title: '测试视频',
      format: 'srt',
      cues: [cue(1, '导入的字幕')],
      importedAt: 1,
    }
    const withBuiltin = videoItem({ videoConfig: { transcript: builtin } as never })
    expect(resolveVideoCaptions(withBuiltin, imported)).toMatchObject({
      source: 'imported',
      cues: [expect.objectContaining({ text: '导入的字幕' })],
    })
    expect(resolveVideoCaptions(withBuiltin, null).source).toBe('builtin')
    expect(resolveVideoCaptions(videoItem({ description: VTT_SAMPLE }), null).source).toBe('description')
    expect(resolveVideoCaptions(videoItem(), null)).toEqual({ cues: [], source: 'none' })
    expect(resolveVideoCaptions(null, null)).toEqual({ cues: [], source: 'none' })
  })

  it('字幕状态：有字幕可搜 / 无字幕不可搜', () => {
    expect(getCaptionStatus({ cues: [cue(1, 'a')], source: 'imported' })).toMatchObject({
      state: 'has-captions',
      cueCount: 1,
      source: 'imported',
    })
    expect(getCaptionStatus({ cues: [], source: 'none' })).toMatchObject({
      state: 'no-captions',
      cueCount: 0,
    })
  })
})

describe('视频字幕可搜：跨视频搜索与高亮', () => {
  const entries: CaptionEntry[] = [
    {
      videoId: 'v1',
      title: '机器学习入门',
      platform: 'youtube',
      format: 'srt',
      cues: [cue(61, '今天讲机器学习'), cue(300, '无关内容'), cue(600, '再谈机器学习的应用')],
      importedAt: 1,
    },
    {
      videoId: 'v2',
      title: '深度学习实战',
      platform: 'bilibili',
      format: 'vtt',
      cues: [cue(30, '机器学习是基础', 'Machine learning basics')],
      importedAt: 2,
    },
    { videoId: 'v3', title: '空视频', format: 'vtt', cues: [], importedAt: 3 },
  ]

  it('关键词命中分组显示、命中按时间点排序、分组按最早命中排序', () => {
    const groups = searchCaptionEntries(entries, '机器学习')
    expect(groups.map(g => g.videoId)).toEqual(['v2', 'v1'])
    expect(groups[0].hits).toHaveLength(1)
    expect(groups[0].firstHitSec).toBe(30)
    expect(groups[1].hits.map(h => h.cue.startSec)).toEqual([61, 600])
  })

  it('译文也可命中，标注 field 为 translation', () => {
    const groups = searchCaptionEntries(entries, 'Machine learning')
    expect(groups).toHaveLength(1)
    expect(groups[0].hits[0].field).toBe('translation')
  })

  it('空查询返回空；无字幕视频永不出现', () => {
    expect(searchCaptionEntries(entries, '  ')).toEqual([])
    expect(searchCaptionEntries(entries, '机器学习').some(g => g.videoId === 'v3')).toBe(false)
    expect(searchCaptionEntries(entries, '不存在的词')).toEqual([])
  })

  it('每视频命中数可上限', () => {
    const groups = searchCaptionEntries(entries, '机器学习', { maxHitsPerVideo: 1 })
    expect(groups.find(g => g.videoId === 'v1')?.hits).toHaveLength(1)
  })

  it('高亮切分：中文子串与英文大小写不敏感都命中', () => {
    const segs = highlightCaptionSegments('今天讲机器学习，机器学习很有用', '机器学习')
    expect(segs.filter(s => s.hit)).toHaveLength(2)
    expect(segs.filter(s => s.hit).every(s => s.text === '机器学习')).toBe(true)
    const en = highlightCaptionSegments('Machine Learning basics', 'machine learning')
    expect(en.filter(s => s.hit).map(s => s.text)).toEqual(['Machine Learning'])
    expect(highlightCaptionSegments('没有命中', '不存在')).toEqual([{ text: '没有命中', hit: false }])
  })

  it('时间戳格式：65 秒 → 01:05，3661 秒 → 1:01:01', () => {
    expect(formatCaptionTimestamp(65)).toBe('01:05')
    expect(formatCaptionTimestamp(3661)).toBe('1:01:01')
    expect(formatCaptionTimestamp(0)).toBe('00:00')
    expect(formatCaptionTimestamp(-5)).toBe('00:00')
  })

  it('自带字幕收集只收 transcript 非空的视频；合并时导入覆盖自带', () => {
    const builtin = collectBuiltinCaptionEntries([
      {
        items: [videoItem({ id: 'b1', videoConfig: { transcript: [cue(1, '自带')] } as never })],
        subCategories: [
          { items: [videoItem({ id: 'b2', videoConfig: { transcript: [] } as never })] },
        ],
      },
    ])
    expect(builtin.map(e => e.videoId)).toEqual(['b1'])
    const imported: CaptionEntry = {
      videoId: 'b1',
      title: 'b1',
      format: 'srt',
      cues: [cue(2, '导入')],
      importedAt: 9,
    }
    expect(mergeCaptionEntries(builtin, [imported]).find(e => e.videoId === 'b1')?.cues[0].text).toBe('导入')
  })
})

describe('视频字幕可搜：命中跳转的 embed 起始时间', () => {
  it('YouTube 加 ?start=，Bilibili 加 &t=，Vimeo 加 #t=Ns', () => {
    expect(buildVideoEmbedUrlForSeo({ type: 'youtube', videoId: 'abc123' } as never, 125)).toBe(
      'https://www.youtube.com/embed/abc123?start=125',
    )
    expect(buildVideoEmbedUrlForSeo({ type: 'bilibili', bvid: 'BV1xx411c7mD' } as never, 61)).toContain('&t=61')
    expect(buildVideoEmbedUrlForSeo({ type: 'vimeo', videoId: '76979871' } as never, 30)).toBe(
      'https://player.vimeo.com/video/76979871#t=30s',
    )
  })

  it('不传 startSec 时 URL 与原来完全一致；0 或负数不加参数', () => {
    expect(buildVideoEmbedUrlForSeo({ type: 'youtube', videoId: 'abc123' } as never)).toBe(
      'https://www.youtube.com/embed/abc123',
    )
    expect(buildVideoEmbedUrlForSeo({ type: 'youtube', videoId: 'abc123' } as never, 0)).toBe(
      'https://www.youtube.com/embed/abc123',
    )
    expect(buildVideoEmbedUrlForSeo({ type: 'bilibili', bvid: 'BV1xx411c7mD' } as never)).toBe(
      'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&high_quality=1&autoplay=0',
    )
  })
})
