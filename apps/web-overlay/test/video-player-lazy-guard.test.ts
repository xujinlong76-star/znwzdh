// Step 3b（Bundle 瘦身第三刀 b）：视频播放器重库必须按需加载。
//
// 背景：VideoPlayerContext 静态 import 的 4 个 lib（failover、经 failover
// 间接的 registry、playback-storage、ai-summary，合计约 19KB 代码）只在
// 开播/切镜像/写播放头时才需要，以前随 provider 壳静态进 `/` 初始 chunk。
// 改法：context 内 3 处静态 import 改 await import()（registry 随 failover
// 走，不单独改）；openVideo 异步分段（先同步 setActiveVideo、后补镜像/
// 断点/摘要）；switchMirror 与 setPlayheadSec 的记录/保存改 fire-and-forget。
//
// 锁死点：
//  - context 不得静态 import 4 个 lib（值 import）；`import type` 与
//    `typeof import()` 是类型擦除，允许。
//  - 3 个加载器必须做单例 promise 缓存（`??=`），保证只加载一次。
//  - openVideo 对外签名仍是同步 void；setActiveVideo 必须在任何 await
//    之前（播放器 UI 立即出现）；已配好的章节同步进 state，不等重库。
//  - 镜像/断点解析失败要 toast 告知；AI 摘要失败必须静默（只是章节提取）。
//  - provider 壳仍静态挂载于 providers（本刀只拆重库，不拆壳）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const CTX = 'src/contexts/VideoPlayerContext.tsx'
const LIBS = [
  '@/lib/video-failover',
  '@/lib/video-platform-registry',
  '@/lib/video-playback-storage',
  '@/lib/video-ai-summary',
] as const

describe('视频播放器重库按需加载（Bundle 第三刀 b）', () => {
  it('context 不静态引入 4 个重库，只走 await import()', () => {
    const src = read(CTX)
    for (const lib of LIBS) {
      const escaped = lib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // 值 import 禁止；`typeof import('...')` 是类型位置，允许。
      expect(src).not.toMatch(
        new RegExp(`^import\\b[^'";]*from\\s+['"]${escaped}['"]`, 'm'),
      )
      expect(src).not.toMatch(
        new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s+['"]${escaped}['"]`),
      )
    }
    expect(src).toContain("import('@/lib/video-failover')")
    expect(src).toContain("import('@/lib/video-playback-storage')")
    expect(src).toContain("import('@/lib/video-ai-summary')")
    // registry 不在 context 里单独 import，随 failover 一起走。
    expect(src).not.toContain("import('@/lib/video-platform-registry')")
  })

  it('3 个加载器做单例 promise 缓存，只加载一次', () => {
    const src = read(CTX)
    expect(src).toContain('const loadVideoFailover = () => (failoverPromise ??=')
    expect(src).toContain('const loadPlaybackStorage = ()')
    expect(src).toContain('playbackStoragePromise ??=')
    expect(src).toContain('const loadVideoAiSummary = () => (aiSummaryPromise ??=')
  })

  it('openVideo 对外仍是同步 void，先同步出 UI 再补数据', () => {
    const src = read(CTX)
    expect(src).toContain('openVideo: (item: NavigationSubItem, startSec?: number) => void')
    const openVideo = src.slice(src.indexOf('const openVideo = useCallback'))
    // setActiveVideo 在任何 await 之前出现。
    expect(openVideo.indexOf('setActiveVideo(item)')).toBeLessThan(
      openVideo.indexOf('await Promise.all'),
    )
    // 已配好的章节同步进 state，不等重库加载。
    expect(openVideo).toMatch(
      /if \(config\.chapters && config\.chapters\.length > 0\) \{\s*setChapters\(config\.chapters\)/,
    )
    // 镜像/断点解析失败 toast 告知。
    expect(openVideo).toContain("toast.error('视频资源加载失败，请重试')")
    // AI 摘要失败静默（只是章节提取）。
    expect(openVideo).toContain('.catch(() => {')
    expect(openVideo).toContain('// ignore')
  })

  it('切镜像记录与断点保存是 fire-and-forget，失败静默', () => {
    const src = read(CTX)
    expect(src).toContain('void loadVideoFailover()')
    expect(src).toContain('void loadPlaybackStorage()')
    expect(src).toContain('recordMirrorFailover')
    expect(src).toContain('savePlaybackPosition')
    // setActiveMirror 不等记录完成。
    const switchMirror = src.slice(src.indexOf('const switchMirror = useCallback'))
    expect(switchMirror.indexOf('setActiveMirror(target)')).toBeGreaterThan(0)
  })

  it('provider 壳仍静态挂载于 providers，本刀不拆壳', () => {
    const providers = read('src/components/providers.tsx')
    expect(providers).toContain(
      "import { VideoPlayerProvider } from '@/contexts/VideoPlayerContext'",
    )
    expect(providers).toContain('<VideoPlayerProvider>')
  })
})
