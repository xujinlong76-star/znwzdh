/**
 * B 站视频「问 AI」摘要守卫（T8）。
 *
 * 锁住诚实底线：
 *  1. 摘要区永远写明「非全文稿」——它是简介 + 章节 + 字幕的要点提炼；
 *  2. 章节/字幕是模板合成（synthetic=true）时绝不进摘要资料；
 *  3. 评论不进资料：B 站评论接口匿名调用实测 -352（需登录态），
 *     组件只吃目录资料 + bili-parse 刷新的简介，不直连 B 站评论；
 *  4. 模型未就绪时不假装有摘要，改展原文要点。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function apiSource(rel: string): string {
  const candidates = [resolve(HERE, '..', '..', 'api', rel)]
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error('无法定位 api 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('视频摘要组件 video-ai-summary', () => {
  const src = overlaySource('src/components/video-ai-summary.tsx')

  it('永远写明「非全文稿」', () => {
    expect(src).toContain('非全文稿')
  })

  it('走站内摘要接口，不直连 B 站评论接口', () => {
    expect(src).toContain("hubUrl('/api/videos/bili-summary')")
    expect(src).not.toContain('x/v2/reply')
    expect(src).not.toContain('web-interface/view')
  })

  it('简介缺失时先调站内 bili-parse 刷新（不自己拼 B 站直连）', () => {
    expect(src).toContain("fetch(`/api/videos/bili-parse?bvid=")
  })

  it('模型未就绪时展原文要点并照实标注，不是假摘要', () => {
    expect(src).toContain("state.data.mode === 'local'")
    expect(src).toContain('未经过 AI 整理')
  })
})

describe('视频详情页接线', () => {
  const page = overlaySource('src/app/videos/v/[id]/page.tsx')

  it('B 站视频才挂摘要区块', () => {
    expect(page).toContain("vc.type === 'bilibili'")
    expect(page).toContain('<VideoAiSummary')
  })

  it('模板合成的章节/字幕（synthetic=true）绝不进摘要资料', () => {
    expect(page).toContain('vc.synthetic')
    expect(page).toContain('? []')
  })
})

describe('摘要接口注册', () => {
  const server = apiSource('src/server.ts')
  const route = apiSource('src/routes/video-bili-summary.ts')

  it('路由已注册，提示词只许写资料里有的内容', () => {
    expect(server).toContain('videoBiliSummaryRoutes')
    expect(route).toContain("app.post(\n    \"/api/videos/bili-summary\"")
    expect(route).toContain('只写资料里有的内容')
    expect(route).toContain('非全文稿')
  })
})
