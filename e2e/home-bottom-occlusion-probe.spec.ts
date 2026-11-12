import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 第 1 件补充核查：页脚版权行与影院区「进入短剧专区」在被滚到视口右下角
// （小猫挂件固定区）时是否被盖。只验只报，不动 xiaomaomao.js。

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

test('影院区入口滚到右下角时是否被小猫盖住', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => { document.documentElement.style.scrollBehavior = 'auto' })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(5000)

  const cat = await catRect(page)
  const linkDocY = await page.getByRole('link', { name: /进入短剧专区/ }).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top + window.scrollY
  })
  // 把入口滚到视口底部（挂件纵向带 y≈950..1062）
  await page.evaluate((y) => window.scrollTo({ top: y - 990, behavior: 'instant' as ScrollBehavior }), linkDocY)
  await page.waitForTimeout(1200)
  const linkBox = await page.getByRole('link', { name: /进入短剧专区/ }).boundingBox()
  await page.screenshot({ path: 'test-results/home-cinema-bottom-right.png' })
  const report = { cat, linkDocY, linkBox, overlapCinemaLink: linkBox ? overlap(cat, linkBox) : -1 }
  writeFileSync('test-results/home-cinema-occlusion.json', JSON.stringify(report, null, 2))
  console.log('CINEMA-REPORT ' + JSON.stringify(report))
})
