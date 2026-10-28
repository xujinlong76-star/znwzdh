import { describe, expect, it } from 'vitest'
import { mergeSettings, normalizeSettings, siteSettingsPatchSchema } from '../src/lib/site-settings'

describe('站点品牌设置', () => {
  it('保留合法的 Apple Touch Icon，并拒绝可执行协议', () => {
    const settings = normalizeSettings({
      basic: { title: 'NavHub', description: '一个足够长的网站描述' },
      appearance: {
        logo: '/api/site/asset/logo-0123456789.png',
        appleTouchIcon: '/api/site/asset/appleTouchIcon-0123456789.png',
        favicon: 'javascript:alert(1)',
      },
    })
    expect(settings.appearance.appleTouchIcon).toBe('/api/site/asset/appleTouchIcon-0123456789.png')
    expect(settings.appearance.favicon).toBe('')
  })

  it('按分组合并并允许显式清空 Apple Touch Icon', () => {
    const current = normalizeSettings({
      basic: { title: 'NavHub', description: '一个足够长的网站描述', ogImage: '/og.png' },
      appearance: { appleTouchIcon: '/apple.png', logo: '/logo.png' },
    })
    const cleared = mergeSettings(current, { appearance: { appleTouchIcon: null } })
    expect(cleared.appearance.appleTouchIcon).toBe('')
    expect(cleared.appearance.logo).toBe('/logo.png')
    expect(cleared.basic.ogImage).toBe('/og.png')
  })

  it('上传字段只接受 http(s) 或站内路径', () => {
    expect(siteSettingsPatchSchema.safeParse({ appearance: { appleTouchIcon: '/apple.png' } }).success).toBe(true)
    expect(siteSettingsPatchSchema.safeParse({ appearance: { appleTouchIcon: 'data:image/png;base64,AA==' } }).success).toBe(false)
  })

  const pwaKinds = ['pwaIcon192', 'pwaIcon512', 'pwaMaskable512'] as const
  it.each(pwaKinds)('%s 仅接受同 kind 的上传 PNG URL', (kind) => {
    const url = `/api/site/asset/${kind}-0123456789.png`
    expect(siteSettingsPatchSchema.parse({ appearance: { [kind]: ` ${url} ` } }).appearance?.[kind]).toBe(url)
    expect(normalizeSettings({ appearance: { [kind]: url } }).appearance[kind]).toBe(url)
    const wrongKind = kind === 'pwaIcon192' ? 'pwaIcon512' : 'pwaIcon192'
    for (const invalid of [
      `https://example.com${url}`, `//example.com${url}`, '/icons/icon-512.png',
      `/api/site/asset/${wrongKind}-0123456789.png`, '/api/site/asset/logo-0123456789.png',
      url.replace('.png', '.webp'), url.replace('.png', 'Xpng'), url.replace('0123456789', '012345678'),
      `${url}?bypass=1`, `${url}#icon`, `/prefix/..${url}`, url.replace('pwa', '%70wa'),
      'data:image/png;base64,AA==', 'javascript:alert(1)', 123, {},
    ]) {
      const parsed = siteSettingsPatchSchema.safeParse({ appearance: { [kind]: invalid } })
      expect(parsed.success, String(invalid)).toBe(false)
      if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(['appearance', kind])
      expect(normalizeSettings({ appearance: { [kind]: invalid } }).appearance[kind]).toBe('')
    }
  })

  it.each(pwaKinds)('%s 支持空串/null 清空，未提交字段保留', (kind) => {
    const appearance = Object.fromEntries(pwaKinds.map((key) => [key, `/api/site/asset/${key}-0123456789.png`]))
    const current = normalizeSettings({ appearance: { ...appearance, logo: '/logo.png' }, basic: { ogImage: '/og.png' } })
    expect(mergeSettings(current, { navigation: { linkTarget: '_self' } }).appearance).toEqual(current.appearance)
    expect(mergeSettings(current, { appearance: { [kind]: undefined } }).appearance[kind]).toBe(appearance[kind])
    for (const empty of ['', null]) {
      const patch = siteSettingsPatchSchema.parse({ appearance: { [kind]: empty } })
      const cleared = mergeSettings(current, { appearance: patch.appearance })
      expect(cleared.appearance[kind]).toBe('')
      expect(cleared.appearance.logo).toBe('/logo.png')
      expect(cleared.basic.ogImage).toBe('/og.png')
      for (const other of pwaKinds.filter((key) => key !== kind)) expect(cleared.appearance[other]).toBe(appearance[other])
    }
    expect(normalizeSettings({}).appearance[kind]).toBe('')
    expect(normalizeSettings({ appearance: { [kind]: null } }).appearance[kind]).toBe('')
  })
})
