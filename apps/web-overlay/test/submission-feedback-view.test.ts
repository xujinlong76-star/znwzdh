/**
 * 收录反馈页守卫（提交后网址收录情况汇报）。
 *
 * 源码守卫体例（node vitest 无 jsdom，同 handoff-card.test.ts 说明）钉死：
 *  - 页面拉 /api/hub/submissions/feedback 且带刷新入口（状态/原因更新后同步最新）；
 *  - 列表渲染提交时间 / 网址 / 状态徽章（审核中 / 已通过 / 未通过）/ 原因说明；
 *  - 通过与未通过都显示原因，审核中给等待说明；
 *  - 导航入口挂进用户中心「内容与收藏」组。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const view = overlaySource('src/components/user-center/submission-feedback-view.tsx')
const page = overlaySource('src/app/me/feedback/page.tsx')
const nav = overlaySource('src/components/user-center/user-center-nav.tsx')

describe('收录反馈页守卫', () => {
  it('数据源与同步：拉 /api/hub/submissions/feedback + 刷新按钮 + 加载即拉取', () => {
    expect(view).toContain('/api/hub/submissions/feedback')
    expect(view).toContain('RefreshCw')
    expect(view).toMatch(/onClick=\{\(\) => void load\(\)\}/)
    // 状态或原因更新后刷新即见最新（拉取时刻为真相）
    expect(view).toContain('刷新即见最新')
  })

  it('身份头：hub 代理不读 anon cookie，必须显式带 getIdentity()+anonHeaders', () => {
    expect(view).toContain('getIdentity()')
    expect(view).toContain('anonHeaders(identity)')
    expect(view).toMatch(/fetch\('\/api\/hub\/submissions\/feedback', \{ headers: anonHeaders\(identity\) \}\)/)
  })

  it('并发与错误纪律：请求序号丢弃旧响应，失败清旧数据避免过期汇报', () => {
    expect(view).toContain('requestSeqRef')
    expect(view).toMatch(/seq !== requestSeqRef\.current\) return/)
    // 失败分支清空 items（两处：res 非 ok 与 catch）
    expect(view).toMatch(/setItems\(null\)[^]*setError\(data\?\.message/)
    expect(view).toMatch(/setItems\(null\)[^]*setError\('中枢暂不可用/)
  })

  it('焦点自动刷新：切回标签页自动拉最新，隐藏方向不空请求', () => {
    expect(view).toContain("'focus'")
    expect(view).toContain("'visibilitychange'")
    expect(view).toContain('visibilityState === \'hidden\'')
  })

  it('汇报字段齐备：提交时间 / 网址 / 状态徽章 / 原因说明', () => {
    expect(view).toContain('submittedAt')
    expect(view).toContain('formatAbsoluteTime(item.submittedAt)')
    expect(view).toContain('item.url')
    // 三态徽章
    expect(view).toContain('审核中')
    expect(view).toContain('已通过')
    expect(view).toContain('未通过')
  })

  it('通过与未通过都显示原因，审核中给等待说明', () => {
    // 三态分支都在（pending 等待文案 + reason 非空展示 + 兜底文案）
    expect(view).toContain('item.status === \'pending\'')
    expect(view).toContain('item.reason')
    expect(view).toContain('收录结果与原因说明会在审核完成后出现')
    expect(view).toContain('已通过收录并上架')
    expect(view).toContain('暂未通过收录')
  })

  it('页面壳与导航入口：/me/feedback 挂进内容与收藏组', () => {
    expect(page).toContain('SubmissionFeedbackView')
    expect(page).toContain('main-content')
    expect(nav).toContain("href: '/me/feedback'")
    expect(nav).toContain('收录反馈')
  })
})
