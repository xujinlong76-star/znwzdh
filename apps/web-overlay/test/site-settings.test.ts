import { describe, expect, it } from 'vitest'
// 读侧归一化/合并与展示辅助来自客户端安全模块；写侧 schema 单独成模块（它依赖 zod）。
import { externalLinkRelAttr, isAnnouncementVisible, mergeSettings, normalizeSettings } from '../src/lib/site-settings'
import { siteSettingsPatchSchema } from '../src/lib/site-settings.schema'

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

  describe('外链权重策略（externalLinkRel）', () => {
    it('缺省与脏值都收敛到 nofollow，dofollow 显式保留', () => {
      expect(normalizeSettings({}).navigation.externalLinkRel).toBe('nofollow')
      expect(normalizeSettings({ navigation: { externalLinkRel: 'dofollow' } }).navigation.externalLinkRel).toBe('dofollow')
      expect(normalizeSettings({ navigation: { externalLinkRel: 'follow' } }).navigation.externalLinkRel).toBe('nofollow')
      expect(normalizeSettings({ navigation: { externalLinkRel: 1 } }).navigation.externalLinkRel).toBe('nofollow')
    })

    it('patch schema 只接受两个合法值，并按分组合并保留其它导航字段', () => {
      expect(siteSettingsPatchSchema.safeParse({ navigation: { externalLinkRel: 'dofollow' } }).success).toBe(true)
      expect(siteSettingsPatchSchema.safeParse({ navigation: { externalLinkRel: 'nofollow' } }).success).toBe(true)
      for (const invalid of ['follow', 'ugc', true, 0, '']) {
        expect(siteSettingsPatchSchema.safeParse({ navigation: { externalLinkRel: invalid } }).success, String(invalid)).toBe(false)
      }
      const current = normalizeSettings({ navigation: { linkTarget: '_self', externalLinkRel: 'dofollow' } })
      const merged = mergeSettings(current, { navigation: { externalLinkRel: 'nofollow' } })
      expect(merged.navigation.externalLinkRel).toBe('nofollow')
      expect(merged.navigation.linkTarget).toBe('_self')
    })

    it('rel 属性始终保留 noopener noreferrer，权重开关只增减 nofollow', () => {
      expect(externalLinkRelAttr('nofollow')).toBe('nofollow noopener noreferrer')
      expect(externalLinkRelAttr('dofollow')).toBe('noopener noreferrer')
      for (const dirty of [undefined, null, '', 'other', {}, 1]) {
        expect(externalLinkRelAttr(dirty)).toBe('nofollow noopener noreferrer')
      }
    })
  })

  describe('公告 / 功能开关 / 首页编排 / 标语', () => {
    it('缺省：公告关、功能全开、首页默认序、无标语', () => {
      const s = normalizeSettings(null)
      expect(s.announcement).toEqual({ enabled: false, text: '' })
      expect(Object.values(s.features).every(Boolean)).toBe(true)
      expect(s.home.order).toEqual(['aiFinder', 'dramaCinema', 'onboarding'])
      expect(s.basic.tagline).toBeUndefined()
    })

    it('features 只有显式 false 才关，脏值按开处理', () => {
      const s = normalizeSettings({ features: { dramaCinema: false, aiFinder: 'no', xiaomaomao: 0 } })
      expect(s.features.dramaCinema).toBe(false)
      expect(s.features.aiFinder).toBe(true)
      expect(s.features.xiaomaomao).toBe(true)
    })

    it('home.order 去重、丢未知键、缺失键按默认序补齐', () => {
      const s = normalizeSettings({ home: { order: ['onboarding', 'bogus', 'onboarding', 'aiFinder'] } })
      expect(s.home.order).toEqual(['onboarding', 'aiFinder', 'dramaCinema'])
    })

    it('公告开但无文案时归一化为关；定时窗口由 isAnnouncementVisible 判断', () => {
      const empty = normalizeSettings({ announcement: { enabled: true, text: '  ' } })
      expect(empty.announcement.enabled).toBe(false)
      const timed = normalizeSettings({
        announcement: { enabled: true, text: '限时公告', startAt: 1_000, endAt: 2_000 },
      })
      expect(isAnnouncementVisible(timed, 500)).toBe(false)
      expect(isAnnouncementVisible(timed, 1_500)).toBe(true)
      expect(isAnnouncementVisible(timed, 2_500)).toBe(false)
    })

    it('合并：只关短剧不清其他段；标语可写可清', () => {
      const current = normalizeSettings({
        basic: { title: 'NavHub', description: '一个足够长的网站描述', tagline: '旧标语' },
        announcement: { enabled: true, text: '公告' },
      })
      const merged = mergeSettings(current, { features: { dramaCinema: false } })
      expect(merged.features.dramaCinema).toBe(false)
      expect(merged.features.aiFinder).toBe(true)
      expect(merged.announcement.text).toBe('公告')
      expect(mergeSettings(merged, { basic: { tagline: null } }).basic.tagline).toBeUndefined()
    })

    it('写侧 schema：拒绝伪协议公告链接与未知功能键', () => {
      expect(siteSettingsPatchSchema.safeParse({ announcement: { linkUrl: 'javascript:alert(1)' } }).success).toBe(false)
      expect(siteSettingsPatchSchema.safeParse({ announcement: { linkUrl: '/videos' } }).success).toBe(true)
      expect(siteSettingsPatchSchema.safeParse({ features: { nope: true } }).success).toBe(false)
      expect(siteSettingsPatchSchema.safeParse({ home: { order: ['dramaCinema', 'aiFinder'] } }).success).toBe(true)
    })
  })
})
