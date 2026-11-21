/**
 * 字幕解析的标签剥离回归（CodeQL #139）：字幕行里的格式标签经 stripHtmlTags
 * 状态机剥离后，嵌套/引号属性标签不得复活、不得吞掉正文。
 */
import { describe, expect, it } from 'vitest'

import { parseCaptions, parseSRT, parseWebVTT, stripCueTags } from '../src/lib/video-transcript-sync'

describe('stripCueTags（字幕行剥标签，CodeQL #139）', () => {
  it('引号属性里的 > 不截断：旧正则输出 y">kept', () => {
    expect(stripCueTags('<b title="x>y">kept</b>')).toBe('kept')
  })

  it('嵌套标签删一次后不留活标签', () => {
    const out = stripCueTags('<scr<script>ipt>alert(1)</scr</script>ipt>')
    expect(out).not.toContain('<script')
    expect(out).toContain('alert(1)')
  })

  it('纯文本小于号保留', () => {
    expect(stripCueTags('a < b')).toBe('a < b')
  })
})

describe('parseCaptions / parseSRT / parseWebVTT：带标签的字幕行', () => {
  it('SRT 行内标签剥干净，引号属性标签不吞正文', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
<b title="x>y">kept</b>

2
00:00:05,000 --> 00:00:08,000
<v Speaker>hello</v>
`
    const cues = parseSRT(srt)
    expect(cues).toHaveLength(2)
    expect(cues[0]!.text).toBe('kept')
    expect(cues[1]!.text).toBe('hello')
  })

  it('WebVTT 说话人/颜色标签剥干净', () => {
    const vtt = `WEBVTT

00:01.000 --> 00:04.000
<v Speaker><c.red>hello</c></v>
`
    const cues = parseWebVTT(vtt)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.text).toBe('hello')
  })

  it('parseCaptions 对嵌套标签字幕不输出活标签', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
<scr<script>ipt>alert(1)</scr</script>ipt>
`
    const r = parseCaptions(srt)
    expect(r.format).toBe('srt')
    expect(r.cues).toHaveLength(1)
    expect(r.cues[0]!.text).not.toContain('<script')
    expect(r.cues[0]!.text).toContain('alert(1)')
  })
})
