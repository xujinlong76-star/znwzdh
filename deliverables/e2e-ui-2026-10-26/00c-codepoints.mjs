import { launch, BASE } from './lib.mjs'
const { browser, page } = await launch()
await page.goto('http://localhost:3200/auth/signin?callbackUrl=/admin', { waitUntil: 'domcontentloaded', timeout: 120_000 })
await page.waitForLoadState('load', { timeout: 90_000 }).catch(() => {})
await page.waitForTimeout(2500)
const dump = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('进入'))
  const t = b ? b.textContent.trim() : ''
  return { text: t, cps: [...t].map((c) => c.codePointAt(0).toString(16)), count: document.querySelectorAll('button').length }
})
console.log(JSON.stringify(dump))
const mine = '一键进入'
console.log('mine cps', [...mine].map((c) => c.codePointAt(0).toString(16)).join(','))
console.log('pw text count', await page.locator('button', { hasText: '进入' }).count())
console.log('pw role count', await page.getByRole('button', { name: /进入/ }).count())
await browser.close()
