import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { syntheticMetadataEnabled } from '../src/lib/video-metadata-policy'

/**
 * 合成元数据的开关与接线守卫。
 *
 * 背景：`generateAISanitizedMetadata()` 是模板生成（固定 4 章节 / 4 字幕 / 3 测验），
 * 不是模型输出，却被当作 `chapters` / `transcript` 入库并呈现为「AI 提炼」。
 * 本轮把它改成默认关闭 + 打标 `synthetic`。
 *
 * 这里守两件事：开关解析正确；两个采集入口真的按开关接线（不是只定义了开关）。
 */

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('syntheticMetadataEnabled', () => {
  it('默认关闭', () => {
    expect(syntheticMetadataEnabled({})).toBe(false)
    expect(syntheticMetadataEnabled(undefined)).toBe(false)
  })

  it('1 / true / yes 视为开启（大小写与空白不敏感）', () => {
    for (const v of ['1', 'true', 'TRUE', ' yes ']) {
      expect(syntheticMetadataEnabled({ NAVHUB_VIDEO_SYNTHETIC_METADATA: v })).toBe(true)
    }
  })

  it('其它取值一律视为关闭', () => {
    for (const v of ['0', 'false', 'off', '', 'maybe']) {
      expect(syntheticMetadataEnabled({ NAVHUB_VIDEO_SYNTHETIC_METADATA: v })).toBe(false)
    }
  })
})

describe('采集入口按开关接线', () => {
  const files = [
    'lib/video-autonomous-ai-harvester.ts',
    'lib/video-multi-source-connector.ts',
  ]

  for (const file of files) {
    it(`${file} 调用 syntheticMetadataEnabled 后再决定是否写入章节/字幕`, () => {
      const code = stripComments(src(file))
      expect(code).toMatch(/syntheticMetadataEnabled\(\)/)
      // 旧写法：无条件 chapters: meta.chapters / transcript: meta.transcripts
      expect(code).not.toMatch(/^\s*chapters: meta\.chapters,\s*$/m)
      expect(code).not.toMatch(/^\s*transcript: meta\.transcripts,\s*$/m)
      // 合成内容必须带标记，UI 才能区分
      expect(code).toMatch(/synthetic: true/)
    })
  }
})
