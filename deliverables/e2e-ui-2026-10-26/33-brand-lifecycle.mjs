import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'

const base = 'http://127.0.0.1:3411'
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const sharp = requireWeb('sharp')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const results = {}
const errors = []
let original
const uploaded = []
try {
  const csrf = await (await context.request.get(base + '/api/auth/csrf')).json()
  await context.request.post(base + '/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, bypass: 'true', callbackUrl: base + '/admin/site' } })
  original = (await (await context.request.get(base + '/api/site')).json()).settings
  assert.ok(original.appearance.logo)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base + '/admin/site', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByRole('tab', { name: '外观设置' }).click()
  await expect(page.getByRole('button', { name: '保存更改', exact: true })).toBeEnabled()
  const bitmap = (size) => sharp({ create: { width: size, height: size, channels: 4, background: { r: 77, g: 139, b: 198, alpha: 1 } } }).png().toBuffer()
  const field = (kind) => page.locator(`input[name="appearance.${kind}"]`)
  const fileInput = (kind) => field(kind).locator('..').locator('input[type=file]')
  const badResponse = page.waitForResponse((res) => res.url().endsWith('/api/site/asset') && res.request().method() === 'POST')
  await fileInput('pwaIcon192').setInputFiles({ name: 'wrong-size.png', mimeType: 'image/png', buffer: await bitmap(180) })
  assert.equal((await badResponse).status(), 400)
  await expect(field('pwaIcon192')).toHaveAttribute('aria-invalid', 'true')
  results.wrongSizeFieldError = true

  for (const [kind, size] of [['pwaIcon192', 192], ['pwaIcon512', 512], ['pwaMaskable512', 512], ['appleTouchIcon', 180]]) {
    const response = page.waitForResponse((res) => res.url().endsWith('/api/site/asset') && res.request().method() === 'POST')
    await fileInput(kind).setInputFiles({ name: kind + '.png', mimeType: 'image/png', buffer: await bitmap(size) })
    const res = await response
    assert.equal(res.status(), 200)
    const value = await res.json()
    uploaded.push(value.url)
    await expect(field(kind)).toHaveValue(value.url)
    assert.equal(value.width, size)
    assert.equal(value.height, size)
    await expect(page.getByRole('button', { name: '刷新清单', exact: true })).toBeEnabled()
    assert.equal((await context.request.get(base + value.url)).status(), 200)
  }
  const save = async () => {
    const response = page.waitForResponse((res) => res.url().endsWith('/api/site') && res.request().method() === 'POST')
    await page.getByRole('button', { name: '保存更改', exact: true }).click()
    assert.equal((await response).status(), 200)
    await expect(page.getByRole('button', { name: '保存更改', exact: true })).toBeEnabled()
  }
  await save()
  const manifest = await (await context.request.get(base + '/manifest.webmanifest')).json()
  assert.deepEqual(manifest.icons.map((icon) => icon.src), uploaded.slice(0, 3))
  results.manifestAllIcons = true
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await expect(page.locator('link[rel="apple-touch-icon"]').first()).toHaveAttribute('href', uploaded[3])
  results.appleUpdatesOnReload = true

  await page.goto(base + '/admin/site', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '外观设置' }).click()
  const name = uploaded[0].split('/').pop()
  const row = page.locator('div.flex.flex-col.gap-3.rounded-lg.border').filter({ has: page.getByText(name, { exact: true }) })
  await field('pwaIcon192').fill('')
  await expect(row).toContainText('已保存配置引用：appearance.pwaIcon192')
  await expect(row.getByRole('button', { name: '清理孤儿' })).toHaveCount(0)
  const path = 'src/navsphere/content/assets/' + name + '.json'
  const blocked = await context.request.delete(base + '/api/hub/storage', { data: { path } })
  assert.equal(blocked.status(), 409)
  results.unsavedClearProtected = true
  await save()
  await row.getByRole('button', { name: '清理孤儿' }).click()
  await expect(row.getByRole('button', { name: '确认永久删除' })).toBeVisible()
  const deletion = page.waitForResponse((res) => res.url().endsWith('/api/hub/storage') && res.request().method() === 'DELETE')
  await row.getByRole('button', { name: '确认永久删除' }).click()
  assert.equal((await deletion).status(), 200)
  await expect(row).toHaveCount(0)
  assert.equal((await context.request.get(base + uploaded[0], { headers: { 'cache-control': 'no-cache' } })).status(), 404)
  const staleSave = await context.request.post(base + '/api/site', { data: { appearance: { pwaIcon192: uploaded[0] } } })
  assert.equal(staleSave.status(), 409)
  results.deleteFresh404AndStaleSave409 = true
  results.pageErrors = errors
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(results, null, 2))
} finally {
  if (original) {
    const restored = await context.request.post(base + '/api/site', { data: { appearance: {
      ...original.appearance,
      pwaIcon192: original.appearance.pwaIcon192 || null,
      pwaIcon512: original.appearance.pwaIcon512 || null,
      pwaMaskable512: original.appearance.pwaMaskable512 || null,
      appleTouchIcon: original.appearance.appleTouchIcon || null,
    } } })
    if (!restored.ok()) console.error('隔离测试配置恢复失败', restored.status())
    else for (const url of uploaded) {
      if (Object.values(original.appearance).includes(url)) continue
      await context.request.delete(base + '/api/hub/storage', { data: { path: 'src/navsphere/content/assets/' + url.split('/').pop() + '.json' } })
    }
  }
  await browser.close()
}
