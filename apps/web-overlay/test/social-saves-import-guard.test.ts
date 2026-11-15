import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 社交收藏归集（Batch 3 第 1 项）的接线锁。
 *
 * 解析器本身由 social-saves-import.test.ts 覆盖；这里只钉「导入器真的接了
 * 社交来源」：来源切换、平台选择、失败行面板、社交解析分支缺一不可，
 * 否则解析器写得再好也进不了 /import。
 */

const SRC = readFileSync(
  fileURLToPath(new URL('../src/components/bookmark-importer.tsx', import.meta.url)),
  'utf8',
)

describe('社交收藏导入接线', () => {
  it('Step 1 有「浏览器书签 / 社交平台收藏」来源切换', () => {
    expect(SRC).toContain('选择收藏来源')
    expect(SRC).toContain("key: 'browser', label: '浏览器书签'")
    expect(SRC).toContain("key: 'social', label: '社交平台收藏'")
    expect(SRC).toContain('setSourceKind(key)')
  })

  it('社交平台可手动选择，自动识别失败时不猜平台', () => {
    expect(SRC).toContain('id="social-platform"')
    expect(SRC).toContain('自动识别（按文件名与内容判断）')
    expect(SRC).toContain('SOCIAL_PLATFORMS.map')
  })

  it('空状态说明六个平台的导出取法与支持格式，不编造登录同步', () => {
    expect(SRC).toContain('还没有导入过社交收藏')
    expect(SRC).toContain('不登录任何平台')
    // 来源提示里点名六个平台（label 是 lib 里动态渲染的，不钉字面量）
    expect(SRC).toContain('X、Reddit、GitHub Stars、Hacker News、Instagram、TikTok')
    expect(SRC).not.toContain('OAuth')
    expect(SRC).not.toContain('实时同步')
  })

  it('ingest 在社交来源走 parseSocialSaves，失败时逐行报错并保留失败行', () => {
    expect(SRC).toContain("parseSocialSaves(text, { platform: socialPlatform, filename")
    expect(SRC).toContain('setSocialFailures(social.failures)')
    expect(SRC).toContain('socialFailures.length > 0')
  })

  it('失败行可下载、可重试：下载按钮与失败文件名都在', () => {
    expect(SRC).toContain('下载失败行')
    expect(SRC).toContain('SOCIAL_FAILURES_FILENAME')
    expect(SRC).toContain('triggerFileDownload(')
    expect(SRC).toContain('改好后重新选择文件或粘贴导入即可重试')
  })

  it('社交来源放行 .csv / .js 导出文件，浏览器来源仍只认四种', () => {
    expect(SRC).toContain("accept={sourceKind === 'social' ? '.html,.htm,.md,.json,.txt,.csv,.js'")
    expect(SRC).toContain('/\\.(html?|md|json|txt|csv|js)$/i')
  })

  it('平台选择与失败行下载按钮触控高度不小于 44px', () => {
    expect(SRC).toContain('min-h-[44px]')
  })
})
