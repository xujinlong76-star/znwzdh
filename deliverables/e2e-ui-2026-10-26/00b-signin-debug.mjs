import { launch, BASE } from './lib.mjs'

const { browser, page } = await launch()
await page.goto(BASE + '/auth/signin?callbackUrl=/admin', { waitUntil: 'domcontentloaded', timeout: 120_000 })
await page.waitForLoadState('load', { timeout: 90_000 }).catch(() => {})
await page.waitForTimeout(3000)

const info = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map((b, i) => ({
    i,
    text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
    aria: b.getAttribute('aria-label'),
    type: b.type,
    form: !!b.form,
    value: b.value || '',
    rect: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)] })(),
  }))
  return { btns, hydrated: !!document.querySelector('script[src*="next"]'), url: location.href }
})
console.log(JSON.stringify(info, null, 1))

const target = page.locator('button', { hasText: '一键进入' }).first()
console.log('[count]', await page.locator('button', { hasText: '一键进入' }).count())
const [resp] = await Promise.all([
  page.waitForNavigation({ timeout: 25_000 }).catch((e) => 'no-nav:' + e.message.slice(0, 60)),
  target.click().catch((e) => 'click-err:' + e.message.slice(0, 120)),
])
await page.waitForTimeout(6000)
console.log('[after click]', page.url(), '| nav=', String(resp).slice(0, 120))
console.log('[session]', (await page.evaluate(async () => (await fetch('/api/auth/session')).text())).slice(0, 200))
await page.screenshot({ path: 'shots/00b-signin.png', fullPage: true })
await browser.close()
