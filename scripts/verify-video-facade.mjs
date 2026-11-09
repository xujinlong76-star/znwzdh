
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const third = new Set()
  page.on('request', r => { const u = r.url(); if (!u.startsWith('http://localhost:3000') && !u.startsWith('data:') && !u.startsWith('blob:')) third.add(new URL(u).host) })
  await page.goto('http://localhost:3000/videos/v/video_cursor_mastery', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  const before = await page.evaluate(() => ({
    iframe: document.querySelectorAll('iframe').length,
    facadeText: document.body.innerText.includes('点击加载'),
    notice: document.body.innerText.includes('加载后将与'),
    h1: document.querySelector('h1')?.textContent?.trim().slice(0, 40),
    jsonLd: !!document.querySelector('script[type="application/ld+json"]'),
    videoObject: (document.querySelector('script[type="application/ld+json"]')?.textContent || '').includes('VideoObject')
  }))
  console.log('首屏:', JSON.stringify(before))
  console.log('首屏第三方域名:', JSON.stringify([...third]))

  // 点击门面
  const btn = await page.$('button[aria-label*="播放"]')
  console.log('门面按钮存在:', !!btn)
  if (btn) {
    await btn.click()
    await page.waitForTimeout(3500)
    const after = await page.evaluate(() => ({
      iframe: document.querySelectorAll('iframe').length,
      iframeSrc: document.querySelector('iframe')?.src.slice(0, 90)
    }))
    console.log('点击后:', JSON.stringify(after))
    console.log('点击后第三方域名:', JSON.stringify([...third]))
  }
  await browser.close()
})()
