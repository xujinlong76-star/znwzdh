import { test, expect } from '@playwright/test'
import { EXAMS, GUOKAO_PORTAL_URL } from '../apps/web-overlay/src/lib/exam-calendar'

/**
 * U-124 /exam 节点外链文案按节点类型映射：点按回归（E1–E3）。
 *
 * 只改文案映射，不改 URL：三处修正链接点按后仍到达原 URL，
 * 其余 13 处准考证类链接 href 不变。U-426：c7f84da9 门户备用链在国考
 * 准考证行多渲染一条「专题网站门户」外链，跟踪岛外链总数 18→19。
 * 不真的完成站外跳转后的表单操作，只验到达目标 URL。
 *
 * 注意：'准考证打印官方打印入口' 这一 aria-label 在四场卡片上完全相同
 *（国考/京考/教资面试/军队文职），E2 用 href 集合比对，不用卡片定位。
 * 备考站点区另有 target="_blank" 链接（数量随站内数据变），E3 只数
 * 带 aria-label「…（新窗口打开）」的跟踪岛链接，不数全页外链。
 *
 * U-154：E3 的期望不再写死数字，从 EXAMS 数据派生——总数 = 全部带 url
 * 的节点数 + 全部带 portalUrl 的节点数，「去官网打印准考证」数 = 带 url
 * 节点数 − 10 个例外 label（与 my-exam-tracker.tsx 的 nodeLinkCopy 映射
 * 一一对应；C4 广东自考 5 节点后由 5 个增至 10 个）。写死 16 曾在 U-144 G5（c06c567d，广东自考「成绩查询」挂直链
 * 成第 17 个带 url 节点）后滞后致 E3 红（实测 17，期望 16）；派生后数据
 * 增长不再打断断言。U-426：门户备用链（c7f84da9）只在国考准考证行多渲染
 * 一条「专题网站门户」链接，旧口径（只数带 url 节点）期望 18、实测 19
 * 致 E3 红；门户链文案非「去官网打印准考证」，打印数口径不变。
 * exam-calendar.ts 零 import，spec 可直接引用；/exam 页全量渲染 EXAMS，
 * 页内只有 tracker 渲染「（新窗口打开）」aria-label（提醒卡不渲染），
 * 派生口径与断言口径一致。
 */
// nodeLinkCopy 的 10 个例外 label（其余带 url 节点文案均为「去官网打印准考证」）。
// U-395：京考「缴费」是第 5 个例外（去官网缴费），军队文职缴费节点无 url 不渲染。
// C4（2026-11-23）：广东自考 5 节点同理映射为非打印文案（报名/报考/缴费/查看），
// 是第 6–10 个例外；此前只列 5 个致 E3 期望 18、实测 13（CI run 45570267982）——
// 5 条差值恰为这 5 个节点。
const NON_PRINT_LABELS = ['报名', '缴费', '公共科目笔试', '江西成绩复核', '成绩查询', '新生预报名', '正式报名', '考生报考', '网上缴费', '考试']
const JINGKAO_APPLY_URL = 'http://rsj.beijing.gov.cn/bm/ztzl/gwy/'
const JINGKAO_NOTICE_URL =
  'https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html'
const JIANGXI_CHENGKAO_REVIEW_URL = 'https://jdyw.jxeea.cn/'
const GUOKAO_ADMISSION_URL = 'http://gwy.cpta.com.cn'
const SHANDONG_SHENGKAO_ADMISSION_URL = 'https://gwy.sdrsks.org.cn/skbm2027.html'
const JIAOSHI_MIANSHI_URL = 'https://ntce.neea.edu.cn'
const JUNDUANWENZHI_ADMISSION_URL = 'https://wzryzk.81rc.mil.cn/qjwzwb'

// U-141：E1 每组 case 独立的导航请求等待预算。站外站点建连可能挂起
//（CI 上 jdyw.jxeea.cn 曾 77 秒零字节返回），三组 × 20 秒 = 60 秒，
// 仍在 90 秒测试预算内；一组挂起最多只吃掉自己的 20 秒，不拖垮全用例。
const CASE_NAVIGATION_TIMEOUT_MS = 20_000

test.describe('U-124 /exam 节点外链点按回归', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/exam')
    await expect(
      page.getByRole('link', { name: '报名官方报名入口（新窗口打开）', exact: true }),
    ).toBeVisible()
  })

  test('E1：三处修正链接点按后到达原 URL', async ({ page }) => {
    // U-141：不再等 popup。站外站点是否建连成功与本站链接目标无关：
    // CI 上 jdyw.jxeea.cn 的导航请求发出后 77 秒零字节返回，popup 事件
    // 始终不到，旧写法把三组 case 塞进同一个 90 秒预算、用
    // waitForEvent('popup') 当断言前置条件，请求明明已发出却到不了断言。
    // 现在只断言点击实际发出的导航请求 URL 与修前原值一致（href 断言
    // 仍在；不做站外表单操作）。每组 case 有独立 20 秒预算；popup 若
    // 出现只顺手关闭，不等它、不依赖它。
    const context = page.context()
    const cases = [
      { name: '报名官方报名入口（新窗口打开）', url: JINGKAO_APPLY_URL, text: '去官网报名' },
      { name: '公共科目笔试官方公告入口（新窗口打开）', url: JINGKAO_NOTICE_URL, text: '查看官方公告' },
      { name: '江西成绩复核报名系统申请复核入口（新窗口打开）', url: JIANGXI_CHENGKAO_REVIEW_URL, text: '去报名系统申请复核' },
    ]
    for (const { name, url, text } of cases) {
      const link = page.getByRole('link', { name, exact: true })
      await expect(link).toHaveAttribute('href', url)
      await expect(link).toHaveText(text)
      const seen: string[] = []
      const onRequest = (req: { url: () => string }) => {
        seen.push(req.url())
      }
      context.on('request', onRequest)
      try {
        // 先注册请求等待再点击，避免请求在监听就位前发出而漏记；
        // predicate 精确匹配本组 URL，不受其它 case 残留请求干扰。
        const navigationRequest = context.waitForEvent('request', {
          predicate: (req) => req.url() === url,
          timeout: CASE_NAVIGATION_TIMEOUT_MS,
        })
        // 点击若抛错，等待 promise 超时后拒绝也不得变成未处理拒绝。
        navigationRequest.catch(() => {})
        await link.click()
        await navigationRequest
        expect(seen).toContain(url)
      } finally {
        context.off('request', onRequest)
        // popup 是否出现取决于站外站点可达性：可达时顺手关闭残留页面，
        // 不可达时不等待、不阻塞下一组 case。
        for (const other of context.pages()) {
          if (other !== page) await other.close().catch(() => {})
        }
      }
    }
  })

  test('E2：其余准考证类链接 href 不变（抽查山东单条 + 「准考证打印」四条集合）', async ({
    page,
  }) => {
    await expect(
      page.getByRole('link', { name: '山东准考证打印官方打印入口（新窗口打开）', exact: true }),
    ).toHaveAttribute('href', SHANDONG_SHENGKAO_ADMISSION_URL)
    // name 默认是子串匹配：不用 exact 会把「口试/笔试/天津…准考证打印」全算进来。
    const hrefs = await page
      .getByRole('link', { name: '准考证打印官方打印入口（新窗口打开）', exact: true })
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

  test('E3：跟踪岛外链总数不变（带「…（新窗口打开）」aria-label 的链接数 = EXAMS 带 url 节点数 + 带 portalUrl 节点数）', async ({
    page,
  }) => {
    const linkedNodes = EXAMS.flatMap((exam) => exam.nodes).filter((node) => node.url)
    // U-426：门户备用链只在带 portalUrl 的节点行多渲染一条链接（当前仅
    // 国考准考证节点），旧口径漏数这一条致期望 18、实测 19。
    const portalNodes = EXAMS.flatMap((exam) => exam.nodes).filter(
      (node) => node.portalUrl,
    )
    const expectedTotal = linkedNodes.length + portalNodes.length
    const expectedPrint = linkedNodes.filter(
      (node) => !NON_PRINT_LABELS.includes(node.label),
    ).length
    // 兜底：数据层若被清空，派生期望 0 会让断言空过，须先拦住。
    expect(expectedTotal).toBeGreaterThan(0)
    expect(expectedPrint).toBeGreaterThan(0)
    const links = page.locator('a[aria-label$="（新窗口打开）"]')
    await expect(links).toHaveCount(expectedTotal)
    const texts = await links.evaluateAll((els) =>
      els.map((el) => el.textContent?.trim() ?? ''),
    )
    expect(texts.filter((t) => t === '去官网打印准考证')).toHaveLength(expectedPrint)
    // U-426：多出的 1 条须确为国考准考证行的门户备用链（补丁 T9 的 E2E 版）。
    const portalLink = page.getByRole('link', {
      name: '准考证打印专题网站门户入口（新窗口打开）',
      exact: true,
    })
    await expect(portalLink).toHaveAttribute('href', GUOKAO_PORTAL_URL)
    await expect(portalLink).toHaveText('专题网站门户')
  })
})
