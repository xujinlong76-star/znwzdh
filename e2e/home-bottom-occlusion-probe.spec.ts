import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 第 1 件补充核查：页脚版权行与短剧小窗内「进入短剧专区」在被滚到视口右下角
// （小猫挂件固定区）时是否被盖。只验只报，不动 xiaomaomao.js。
//
// 2026-11-18 改写（44394500 首页极简首屏 + 五大功能小窗化）：影院区入口已不在
// 首屏流中，改为点微胶囊「今日短剧热榜」打开短剧小窗，在小窗内取链接量重叠；
// 页脚用例不动（复现 run4 已通过）。

test.use({ viewport: { width: 1920, height: 1080 } })

type Rect = { x: number; y: number; width: number; height: number }

function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return Math.round(x * y * 100) / 100
}

async function catRect(page: Page): Promise<Rect> {
  const box = await page.locator('#xiaomaomao').boundingBox()
  expect(box, '应找到 #xiaomaomao 挂件').toBeTruthy()
  return box!
}

async function scrollToRealBottom(page: Page) {
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior }))
    await page.waitForTimeout(800)
    const done = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4,
    )
    if (done) return true
  }
  return false
}

test('页脚版权行滚到底后是否被小猫盖住', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => { document.documentElement.style.scrollBehavior = 'auto' })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(5000)

  const reached = await scrollToRealBottom(page)
  const cat = await catRect(page)
  const footerBox = await page.locator('footer').first().boundingBox()
  const copyrights = await page.locator('footer').locator('text=/©|版权|Copyright|备案/').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { text: (el.textContent ?? '').trim().slice(0, 60), rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }
    }),
  )
  const widest = copyrights.sort((a, b) => b.rect.width - a.rect.width)[0] ?? null
  await page.screenshot({ path: 'test-results/home-footer-bottom.png' })
  const report = {
    reachedRealBottom: reached,
    scrollY: await page.evaluate(() => window.scrollY),
    docHeight: await page.evaluate(() => document.documentElement.scrollHeight),
    cat, footerBox, copyrights, widest,
    overlapFooter: footerBox ? overlap(cat, footerBox) : -1,
    overlapCopyright: widest ? overlap(cat, widest.rect) : -1,
  }
  writeFileSync('test-results/home-footer-occlusion.json', JSON.stringify(report, null, 2))
  console.log('FOOTER-REPORT ' + JSON.stringify(report))
})

test('短剧小窗内「进入短剧专区」与小猫的重叠测量', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => { document.documentElement.style.scrollBehavior = 'auto' })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(5000)

  const cat = await catRect(page)
  // 44394500 后影院区入口不在首屏流中：点微胶囊开短剧小窗，链接在小窗内
  // （E2E 空库无追剧记录时胶囊文案为「今日短剧热榜」；有记录时为「继续追《…》」）。
  // 链接在 fixed 小窗里，滚页面移不动它，故不再做 linkDocY + 页面滚动。
  await page.getByRole('button', { name: /今日短剧热榜|继续追/ }).click()
  const dialog = page.getByRole('dialog', { name: '短剧速览剧场' })
  await expect(dialog).toBeVisible()
  const linkBox = await dialog.getByRole('link', { name: /进入短剧专区/ }).boundingBox()
  await page.screenshot({ path: 'test-results/home-cinema-bottom-right.png' })
  const report = { via: 'drama-mini-dialog', cat, linkBox, overlapCinemaLink: linkBox ? overlap(cat, linkBox) : -1 }
  writeFileSync('test-results/home-cinema-occlusion.json', JSON.stringify(report, null, 2))
  console.log('CINEMA-REPORT ' + JSON.stringify(report))
})
