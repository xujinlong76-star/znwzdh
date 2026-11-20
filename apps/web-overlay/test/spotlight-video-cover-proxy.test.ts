/**
 * 源码守卫：全局搜索 spotlight 的视频结果缩略图须优先用预签代理地址。
 *
 * 根因（2026-11-20 真机实测，电脑 :3002）：spotlight 搜 "Python" 时视频结果
 * 用 `video.icon` 直链渲染 `<img>`；B 站 hdslb 封面 2× ERR_BLOCKED_BY_ORB
 * + 2× HTTP 403，同 4 个 URL 两轮复现，缩略图破损。`/api/videos?q=` 已下发
 * mediaProxyIconUrl（见 video-api-search-cover-sign.test.ts），渲染侧必须认它。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
}

describe('spotlight 视频缩略图走代理', () => {
  const code = src('components/search/spotlight-modal.tsx')

  it('视频结果 img 的 src 优先用 mediaProxyIconUrl', () => {
    expect(code).toMatch(/video\.mediaProxyIconUrl\s*\|\|/)
  })

  it('不再有只用 video.icon 直链渲染视频缩略图的写法', () => {
    // 旧写法：src={video.icon.startsWith('//') ? ... : video.icon}
    expect(code).not.toMatch(/src=\{video\.icon\.startsWith/)
  })
})
