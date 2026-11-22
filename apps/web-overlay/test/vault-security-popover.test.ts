/**
 * 零知识金库「人话化信任弹窗」与导出表单微交互。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，组件 effect 跑不起来，
 * 所以按能真实跑到的层次分三层钉死，不拿源码 toContain 充数）：
 *
 *  1. 真行为（纯函数）：getVaultPasswordStrength 计分表、countVaultQuicklinks
 *     按 templateUrl 判定（与 hooks/useFavorites 口径一致）。
 *  2. 真渲染（renderToString）：VaultSecurityPopoverContent 的 3 条清单；
 *     FavoritesVaultPanels 导出态的强度条、确认密码不一致提示、导出前提醒
 *     （N、M 取传入的真实数量）。
 *  3. 接线守卫：收藏页 Header 的 AES 徽标真的换成可点击的 VaultSecurityPopover；
 *     面板真的收到 quicklinkCount。
 *
 * 未覆盖、需浏览器复核的缺口：点击徽标后 Popover 真的打开/关闭、Esc 与外点关闭、
 * 强度条随输入实时变化——由 Playwright 走查验证（Radix Portal 不参与 SSR）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, createRef } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { VaultSecurityPopoverContent } from '../src/components/vault-security-popover'
import {
  FavoritesVaultPanels,
  type FavoritesVaultPanelsProps,
} from '../src/components/user-center/favorites-vault-panels'
import { countVaultQuicklinks, getVaultPasswordStrength } from '../src/lib/favorites-vault'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * renderToString 会在 JSX 文本与插值之间插入 `<!-- -->` 注释分隔符
 * （如 `导出将含 <!-- -->3<!-- --> 条收藏…`），断言可见文案前先去掉它——
 * 组件本身无问题，纯属序列化格式（2026-11-21 实测：1 处断言因此假失败）。
 */
const visibleText = (html: string): string => html.replace(/<!-- -->/g, '')

describe('getVaultPasswordStrength', () => {
  it.each([
    ['', 0, '未输入'],
    ['123456', 1, '弱'],
    ['abcd1234', 2, '一般'],
    ['Abcd1234', 3, '良好'],
    ['Abcd1234!', 4, '很强'],
    ['Abcdef123456!', 4, '很强'],
  ])('密码 %s → %i 分「%s」', (password, score, label) => {
    expect(getVaultPasswordStrength(password)).toEqual({ score, label })
  })
})

describe('countVaultQuicklinks', () => {
  it('只按 templateUrl 判定（quickPrefix 单独存在不算）', () => {
    expect(
      countVaultQuicklinks([
        { templateUrl: 'https://github.com/search?q=%s' },
        { quickPrefix: 'gh' },
        {},
        { quickPrefix: 'so', templateUrl: 'https://stackoverflow.com/search?q=%s' },
      ]),
    ).toBe(2)
  })

  it('空列表为 0', () => {
    expect(countVaultQuicklinks([])).toBe(0)
  })
})

describe('VaultSecurityPopoverContent', () => {
  it('3 条清单讲清：本机存放、本地加解密、忘密不找回', () => {
    const html = renderToString(createElement(VaultSecurityPopoverContent))
    expect(html).toContain('零知识金库')
    expect(html).toContain('收藏默认只留在本机浏览器')
    expect(html).toContain('.navhub.vault')
    expect(html).toContain('全程在本地浏览器完成加解密')
    expect(html).toContain('服务器永不接触密码')
    expect(html).toContain('忘记加密密码将无法找回，请妥善保管')
  })
})

function exportProps(overrides: Partial<FavoritesVaultPanelsProps> = {}): FavoritesVaultPanelsProps {
  return {
    mode: 'export',
    onClose: () => {},
    itemCount: 3,
    quicklinkCount: 1,
    password: 'Abcd1234!',
    onPasswordChange: () => {},
    confirmPassword: 'Abcd1234!',
    onConfirmPasswordChange: () => {},
    showPassword: false,
    onToggleShowPassword: () => {},
    exporting: false,
    onExport: () => {},
    payload: '',
    onPayloadChange: () => {},
    passphrase: '',
    onPassphraseChange: () => {},
    onPickFile: () => {},
    fileInputRef: createRef<HTMLInputElement>(),
    onFileChange: () => {},
    importing: false,
    onImport: () => {},
    ...overrides,
  }
}

describe('FavoritesVaultPanels 导出态微交互', () => {
  it('强密码显示强度条「很强」，导出提醒报真实 N、M', () => {
    const html = renderToString(createElement(FavoritesVaultPanels, exportProps()))
    expect(html).toContain('密码强度：很强')
    expect(visibleText(html)).toContain('导出将含 3 条收藏与 1 条快捷模板')
    expect(html).not.toContain('两次输入的密码不一致')
  })

  it('确认密码不一致时就地提示，不等点导出才报错', () => {
    const html = renderToString(
      createElement(FavoritesVaultPanels, exportProps({ confirmPassword: 'Abcd1234?' })),
    )
    expect(html).toContain('两次输入的密码不一致')
  })

  it('弱密码显示「弱」并给加固建议', () => {
    const html = renderToString(
      createElement(FavoritesVaultPanels, exportProps({ password: '123456', confirmPassword: '123456' })),
    )
    expect(html).toContain('密码强度：弱')
    expect(html).toContain('建议 8 位以上')
  })

  it('空密码不渲染强度条', () => {
    const html = renderToString(
      createElement(FavoritesVaultPanels, exportProps({ password: '', confirmPassword: '' })),
    )
    expect(html).not.toContain('密码强度：')
  })
})

describe('收藏页接线守卫', () => {
  it('Header 的 AES 徽标已换成可点击的 VaultSecurityPopover', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('<VaultSecurityPopover />')
    expect(page).toContain("from '@/components/vault-security-popover'")
  })

  it('面板收到 quicklinkCount（真实数量，非写死）', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('quicklinkCount={countVaultQuicklinks(favorites.items)}')
    const panels = read('src/components/user-center/favorites-vault-panels.tsx')
    expect(panels).toContain('quicklinkCount: number')
    expect(panels).toContain('getVaultPasswordStrength')
  })
})
