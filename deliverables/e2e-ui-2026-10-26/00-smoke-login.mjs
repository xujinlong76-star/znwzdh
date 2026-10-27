import { launch, loginAsAdmin, BASE, STATE, save } from './lib.mjs'

const { browser, context, page } = await launch()
const res = await loginAsAdmin(page)
console.log('[login]', JSON.stringify(res).slice(0, 900))
if (res.ok) {
  const session = await page.evaluate(async () => (await fetch('/api/auth/session')).text())
  console.log('[session]', session.slice(0, 300))
  await context.storageState({ path: STATE })
  await page.screenshot({ path: 'shots/00-signin-after-login.png' })
  console.log('[state saved]', STATE)
} else {
  console.log('[url]', page.url())
  console.log('[buttons]', (await page.locator('button').allInnerTexts()).join(' / ').slice(0, 500))
  await page.screenshot({ path: 'shots/00-signin-fail.png', fullPage: true })
}
await browser.close()
