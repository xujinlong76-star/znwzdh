import { test, expect } from '@playwright/test'

/**
 * U-124 /exam 节点外链文案按节点类型映射：点按回归（E1–E3）。
 *
 * 只改文案映射，不改 URL、不新增外链：三处修正链接点按后仍到达原 URL，
 * 其余 13 处准考证类链接 href 不变，跟踪岛外链总数不变。
 * 不真的完成站外跳转后的表单操作，只验到达目标 URL。
 *
 * 注意：'准考证打印官方打印入口' 这一 aria-label 在四场卡片上完全相同
 *（国考/京考/教资面试/军队文职），E2 用 href 集合比对，不用卡片定位。
 * 备考站点区另有 target="_blank" 链接（数量随站内数据变），E3 只数
 * 带 aria-label「…（新窗口打开）」的跟踪岛链接，不数全页外链。
 */
const JINGKAO_APPLY_URL = 'http://rsj.beijing.gov.cn/bm/ztzl/gwy/'
const JINGKAO_NOTICE_URL =
  'https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html'
const JIANGXI_CHENGKAO_REVIEW_URL = 'https://jdyw.jxeea.cn/'
const GUOKAO_ADMISSION_URL = 'http://gwy.cpta.com.cn'
const SHANDONG_SHENGKAO_ADMISSION_URL = 'https://gwy.sdrsks.org.cn/skbm2027.html'
const JIAOSHI_MIANSHI_URL = 'https://ntce.neea.edu.cn'
const JUNDUANWENZHI_ADMISSION_URL = 'https://wzryzk.81rc.mil.cn/qjwzwb'

test.describe('U-124 /exam 节点外链点按回归', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/exam')
    await expect(
      page.getByRole('link', { name: '报名官方报名入口（新窗口打开）' }),
    ).toBeVisible()
  })

  test('E1：三处修正链接点按后到达原 URL', async ({ page }) => {
    const cases = [
      { name: '报名官方报名入口（新窗口打开）', url: JINGKAO_APPLY_URL, text: '去官网报名' },
      { name: '公共科目笔试官方公告入口（新窗口打开）', url: JINGKAO_NOTICE_URL, text: '查看官方公告' },
      { name: '江西成绩复核报名系统申请复核入口（新窗口打开）', url: JIANGXI_CHENGKAO_REVIEW_URL, text: '去报名系统申请复核' },
    ]
    for (const { name, url, text } of cases) {
      const link = page.getByRole('link', { name })
      await expect(link).toHaveAttribute('href', url)
      await expect(link).toHaveText(text)
      const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
      await expect(popup).toHaveURL(url)
      await popup.close()
    }
  })

  test('E2：其余准考证类链接 href 不变（抽查山东单条 + 「准考证打印」四条集合）', async ({
    page,
  }) => {
    await expect(
      page.getByRole('link', { name: '山东准考证打印官方打印入口（新窗口打开）' }),
    ).toHaveAttribute('href', SHANDONG_SHENGKAO_ADMISSION_URL)
    const hrefs = await page
      .getByRole('link', { name: '准考证打印官方打印入口（新窗口打开）' })
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')))
    expect([...hrefs].sort()).toEqual(
      [
        GUOKAO_ADMISSION_URL,
        JIAOSHI_MIANSHI_URL,
        JUNDUANWENZHI_ADMISSION_URL,
        JINGKAO_APPLY_URL,
      ].sort(),
    )
  })

  test('E3：跟踪岛外链总数不变（16 个带「…（新窗口打开）」aria-label 的链接）', async ({
    page,
  }) => {
    const links = page.locator('a[aria-label$="（新窗口打开）"]')
    await expect(links).toHaveCount(16)
    const texts = await links.evaluateAll((els) =>
      els.map((el) => el.textContent?.trim() ?? ''),
    )
    expect(texts.filter((t) => t === '去官网打印准考证')).toHaveLength(13)
  })
})
