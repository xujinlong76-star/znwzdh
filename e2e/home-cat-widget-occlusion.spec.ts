import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 第 1 件（只验只报，不动 xiaomaomao.js）：
// 桌面 1920x1080 实查右下角小猫挂件是否盖住底部栏 DIY 入口、回到顶部、
// 页脚版权行与短剧小窗内「进入短剧专区」，以及闲置 60 秒后是否贴边半藏。
// 挂件瘦身与遮挡修复由 Lighthouse 优化 Wave 1 统一做，本规格只做现状测量。
//
// 2026-11-18 改写（44394500 首页极简首屏 + 五大功能小窗化）：
//   - DIY 静态 pill 已撤（hideStaticButton），首页底部不再有 DIY 入口可量，记 null；
//     新入口在顶部工具栏的外观向导小窗内，不在底部固定区，无遮挡面。
//   - 影院链接不在首屏流中：改为点微胶囊开短剧小窗，在小窗内取链接量重叠。
//   - 回到顶部改为先滚到底（按钮真实出现条件）再量几何。

test.use({ viewport: { width: 1920, height: 1080 } })

type Rect = { x: number; y: number; width: number; height: number }
type FixedInfo = { tag: string; id: string; cls: string; text: string; rect: Rect; opacity: string; visible: boolean }

function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return Math.round(x * y * 100) / 100
}

async function fixedElements(page: Page): Promise<FixedInfo[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed') return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      .map((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return {
          tag: el.tagName.toLowerCase(),
          id: (el as HTMLElement).id || '',
          cls: ((el as HTMLElement).className || '').toString().slice(0, 100),
          text: (el.textContent ?? '').trim().slice(0, 30),
          rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          opacity: cs.opacity,
          visible: cs.visibility !== 'hidden' && cs.display !== 'none',
        }
      }),
  )
}

async function findCat(page: Page): Promise<FixedInfo | null> {
  const fixed = await fixedElements(page)
  const candidates = fixed.filter(
    (el) => el.tag !== 'ol' && el.rect.x + el.rect.width > 1500 && el.rect.y > 600,
  )
  candidates.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
  return candidates[0] ?? null
}

test('小猫挂件遮挡与闲置贴边现状测量（桌面 1920x1080）', async ({ page }) => {
  test.setTimeout(240_000)
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => {
    pageErrors.push(String(e).slice(0, 300))
    // U-162 取证：只记 message 无法定位 `TypeError: Cannot read properties of null
    // (reading 'style')` 的文件:行号，另记 e.stack 前 500 字供下一 head CI 读栈定位。
    if (e.stack) pageErrors.push(`stack: ${e.stack.slice(0, 500)}`)
  })
  page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText ?? ''}`.slice(0, 300)))
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`.slice(0, 300)) })

  await page.addInitScript(() => { document.documentElement.style.scrollBehavior = 'auto' })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(5000)

  const fixed = await fixedElements(page)
  const cat = await findCat(page)
  expect(cat, '右下角应存在小猫挂件 fixed 元素（排除 toast 容器后）').toBeTruthy()
  const catRect = cat!.rect

  // DIY 静态 pill 已随 44394500 撤掉，首页底部不再有 DIY 入口可量，记 null。
  // 不要为凑数去量小窗内的「开启 DIY」按钮（小窗打开时猫在遮罩之下，量了也没意义）。
  const diyBox: Rect | null = null

  // 先滚到底：回到顶部按钮只在滚动后才进入真实出现条件，几何与未滚动时一致，
  // 但更符合按钮真实出现条件。首页只有一个「回到顶部」按钮（FloatingQuickNav，
  // ScrollToTop 只挂在 /videos），全页取不会撞 strict-mode。
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior }))
  await page.waitForTimeout(1200)
  const topBox = await page.getByRole('button', { name: '回到顶部' }).boundingBox().catch(() => null)
  const footerBox = await page.locator('footer').first().boundingBox()
  const copyrightBox = await page.getByText('©').first().boundingBox().catch(() => null)
  await page.screenshot({ path: 'test-results/home-bottom-initial.png' })

  // 影院链接已不在首屏流中：点微胶囊开短剧小窗，在小窗内取链接（E2E 空库无追剧
  // 记录时胶囊文案为「今日短剧热榜」；有记录时为「继续追《…》」）。
  const dramaCapsule = page.getByRole('button', { name: /今日短剧热榜|继续追/ })
  if ((await dramaCapsule.count()) === 0) {
    test.skip(true, '当前首屏未开启短剧模块（dramaCinema section 关闭），无可测胶囊')
  }
  await dramaCapsule.click()
  const cinemaDialog = page.getByRole('dialog', { name: '短剧速览剧场' })
  await expect(cinemaDialog).toBeVisible()
  const cinemaBox = await cinemaDialog.getByRole('link', { name: /进入短剧专区/ }).boundingBox()
  await page.screenshot({ path: 'test-results/home-cinema.png' })
  // Escape 没关上时改点右上角 ×（小窗开着时背后内容 aria-hidden，须确保关窗后再量闲置）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  if (await cinemaDialog.count()) {
    await cinemaDialog.getByRole('button', { name: 'Close' }).click()
  }
  await expect(cinemaDialog).toHaveCount(0, { timeout: 10_000 })

  const overlapPx2: Record<string, number> = {
    diyTrigger: diyBox ? overlap(catRect, diyBox) : -1,
    backToTop: topBox ? overlap(catRect, topBox) : -1,
    footer: footerBox ? overlap(catRect, footerBox) : -1,
    copyright: copyrightBox ? overlap(catRect, copyrightBox) : -1,
    cinemaLink: cinemaBox ? overlap(catRect, cinemaBox) : -1,
  }

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior }))
  await page.waitForTimeout(65_000)
  const catAfter = await findCat(page)
  const fixedAfter = await fixedElements(page)
  await page.screenshot({ path: 'test-results/home-bottom-after-idle.png' })

  const report = {
    viewport: { width: 1920, height: 1080 },
    notes: [
      'DIY 静态 pill 已随 44394500 撤掉（hideStaticButton），DIY 入口现为外观向导小窗内按钮，不在底部固定区，无遮挡面',
      '影院链接取自短剧小窗（微胶囊「今日短剧热榜」→ 短剧速览剧场 → 进入短剧专区），不在首屏流中',
    ],
    fixedElements: fixed,
    catInitial: cat,
    catAfterIdle: catAfter,
    fixedCountAfterIdle: fixedAfter.length,
    targetBoxes: { diyTrigger: diyBox, backToTop: topBox, footer: footerBox, copyright: copyrightBox, cinemaLink: cinemaBox },
    overlapPx2,
    consoleErrors,
    pageErrors,
    failedRequests,
  }
  writeFileSync('test-results/home-widget-occlusion.json', JSON.stringify(report, null, 2))
  console.log('OCCLUSION-REPORT ' + JSON.stringify(report))
})
