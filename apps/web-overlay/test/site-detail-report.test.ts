import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  reportSiteIssue,
  SITE_REPORT_DETAIL_MAX,
  validateSiteReportInput,
} from '../src/lib/site-report'

/**
 * 站点详情页纠错上报（升级第 10 条）。
 *
 * 约束：仓库 vitest 是 node 环境、无 jsdom，组件渲染测不了——
 * 按仓库既有守卫风格做源码扫描断言（与 card-site-detail-link.test.ts 同款），
 * 交互逻辑（校验 / payload / 限流）测纯函数 reportSiteIssue（fetch 打桩）。
 */

const SRC = join(import.meta.dirname, '..', 'src')
const detailView = readFileSync(join(SRC, 'components', 'site-detail-view.tsx'), 'utf8')
const helper = readFileSync(join(SRC, 'lib', 'site-report.ts'), 'utf8')

describe('详情页纠错入口（源码守卫）', () => {
  it('操作栏有「信息有误」站内按钮，不是外链', () => {
    expect(detailView).toContain('信息有误')
    expect(detailView).toContain('aria-label="报告本站信息有误"')
    expect(detailView).toContain('onClick={openReportDialog}')
    // 按钮是 <Button type="button">，不是 <a>：上报入口本身不许做成外链
    const btnIdx = detailView.indexOf('aria-label="报告本站信息有误"')
    const btnSlice = detailView.slice(Math.max(0, btnIdx - 400), btnIdx)
    expect(btnSlice).toContain('variant="ghost"')
    expect(btnSlice).not.toContain('<a ')
  })

  it('弹窗存在：标题 + 5 种问题类型复选 + 详情框 + 提交', () => {
    expect(detailView).toContain('<Dialog open={reportOpen} onOpenChange={setReportOpen}>')
    expect(detailView).toContain('报告本站问题')
    expect(detailView).toContain('SITE_REPORT_KINDS.map((kind)')
    expect(detailView).toContain('id="site-report-detail"')
    expect(detailView).toContain('maxLength={2000}')
    expect(detailView).toContain('提交上报')
    expect(detailView).toContain("toast({ title: '已收到，谢谢'")
  })

  it('已确认死链的站打开弹窗默认勾选「链接打不开」', () => {
    expect(detailView).toContain("setReportKinds(isDeadLink ? ['dead-link'] : [])")
  })

  it('提交失败时弹窗不关、文字保留、原地给诚实报错', () => {
    const fnIdx = detailView.indexOf('const submitReport')
    const body = detailView.slice(fnIdx, fnIdx + 1200)
    // 成功分支才关弹窗；catch 只写错误，不关弹窗、不清空详情
    expect(body).toContain('setReportOpen(false)')
    expect(body.indexOf('setReportOpen(false)')).toBeLessThan(body.indexOf('} catch'))
    expect(body).toContain('setReportError(')
    // 错误行在 Dialog 内原地展示（role="alert"），弹窗不关、文字保留
    expect(detailView).toContain('role="alert"')
  })

  it('KNN 卡片的站内 Link + 独立外链图标链路未被动过', () => {
    // 本条不许破坏第 55 轮的 KNN 链路：站内 Link 与外链图标仍是两条独立元素
    expect(detailView).toContain('aria-label={`访问 ${s.title} 官网`}')
  })

  it('helper 走同源代理 /api/hub，不走裸 /api 直连', () => {
    expect(helper).toContain("`/api/hub/sites/${encodeURIComponent(input.siteId)}/reports`")
    expect(helper).not.toContain("'/api/sites/")
  })
})

describe('reportSiteIssue（fetch 打桩）', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ ok: true, id: 'rep-1' }),
      })),
    )
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  const valid = {
    siteId: 'site-1',
    kinds: ['dead-link' as const],
    detail: '点开是 404，换浏览器也一样。',
    source: 'site-detail' as const,
  }

  it('合法上报发对 payload：kinds / detail / source 走 /api/hub', async () => {
    const res = await reportSiteIssue(valid)
    expect(res).toEqual({ ok: true, id: 'rep-1' })
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchMock as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock
      .calls[0]
    expect(url).toBe('/api/hub/sites/site-1/reports')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({ kinds: ['dead-link'], detail: valid.detail, source: 'site-detail' })
    // contact 为空时不进 body
    expect('contact' in body).toBe(false)
  })

  it('contact 有值时原样带上，source=search 也能用（P0-4 共用）', async () => {
    await reportSiteIssue({ ...valid, contact: 'a@example.com', source: 'search' })
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.contact).toBe('a@example.com')
    expect(body.source).toBe('search')
  })

  it('校验失败（空 kinds / 详情太短 / 超长）不发请求', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    await expect(reportSiteIssue({ ...valid, kinds: [] })).rejects.toThrow('请至少选择一种问题类型')
    await expect(reportSiteIssue({ ...valid, detail: '坏了' })).rejects.toThrow('5–2000')
    await expect(
      reportSiteIssue({ ...valid, detail: '描'.repeat(SITE_REPORT_DETAIL_MAX + 1) }),
    ).rejects.toThrow('5–2000')
    expect(fetchMock).not.toHaveBeenCalled()
    // 同一校验口径也供弹窗原地提示
    expect(validateSiteReportInput({ ...valid, kinds: [] })).toContain('至少选择')
    expect(validateSiteReportInput({ ...valid, detail: '坏了' })).toContain('5–2000')
  })

  it('429 报「提交太频繁」，后端 message 原样透传', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ;(fetchMock as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async () => ({ ok: false, status: 429, json: async () => ({}) }),
    )
    await expect(reportSiteIssue(valid)).rejects.toThrow('提交太频繁')
    ;(fetchMock as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async () => ({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: '请填写完整的上报信息' }),
      }),
    )
    await expect(reportSiteIssue(valid)).rejects.toThrow('请填写完整的上报信息')
  })
})
