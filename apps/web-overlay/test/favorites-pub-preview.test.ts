/**
 * /favorites「公开导航页」价值可视化（PublicNavPreviewCard + 匿名态 CTA）。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，组件 effect 跑不起来，
 * 所以按能真实跑到的层次分三层钉死，不拿源码 toContain 充数）：
 *
 *  1. 真渲染（renderToString）：PublicNavPreviewCard 默认与自定义 props——
 *     标题、站数、后缀、12 条站点骨架、只读标记、实时更新脚注。
 *  2. 接线守卫：PublicPageManager 匿名态真的挂了预览卡 + 卖点文案 + 高感知 CTA，
 *     CTA 真的指向登录页（callback 回 /favorites）。
 *  3. 诚实守卫：旧的两行冷冰冰限制提示（“需登录并同步到云端收藏后才能发布”）
 *     不再是主要文案——源码里不得再出现该句。
 *
 * 未覆盖、需浏览器复核的缺口：三档视口下的首屏可见性、预览卡与悬浮小猫的
 * 零重叠、CTA 点击后真的走到登录页——由 Playwright 走查验证。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PublicNavPreviewCard } from '../src/components/public-nav-preview-card'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * renderToString 会在 JSX 文本与插值之间插入 `<!-- -->` 注释分隔符
 * （如 `12<!-- --> 个精选站点`），断言可见文案前先去掉它——组件本身无问题，
 * 纯属序列化格式（2026-11-21 实测：3 处断言因此假失败）。
 */
const visibleText = (html: string): string => html.replace(/<!-- -->/g, '')

describe('PublicNavPreviewCard', () => {
  it('默认渲染：标题、12 站、后缀与只读标记齐全', () => {
    const html = renderToString(createElement(PublicNavPreviewCard))
    expect(html).toContain('你的专属技术栈导航')
    expect(visibleText(html)).toContain('12 个精选站点')
    expect(visibleText(html)).toContain('shanyanghu.com/pub/your-name')
    expect(html).toContain('只读公开页')
    expect(html).toContain('随收藏实时更新')
    for (const name of ['GitHub', 'Figma', 'Vercel', 'MDN Web Docs', 'Stack Overflow', 'Notion']) {
      expect(html).toContain(name)
    }
  })

  it('自定义 props：标题/站数/后缀按传入值渲染，站数截断演示列表', () => {
    const html = renderToString(
      createElement(PublicNavPreviewCard, { title: '设计师工具箱', siteCount: 3, slug: 'design' }),
    )
    expect(html).toContain('设计师工具箱')
    expect(visibleText(html)).toContain('3 个精选站点')
    expect(visibleText(html)).toContain('shanyanghu.com/pub/design')
    expect(html).toContain('GitHub')
    expect(html).not.toContain('Notion')
  })

  it('骨架是示例不是真数据：文案点明预览属性，不冒充用户真实收藏', () => {
    const html = renderToString(createElement(PublicNavPreviewCard))
    expect(html).toContain('公开页预览')
  })
})

describe('PublicPageManager 匿名态接线', () => {
  const source = () => read('src/components/public-page-manager.tsx')

  it('存在卖点说明 + 预览卡 + 高感知 CTA', () => {
    const src = source()
    expect(src).toContain('把你的私藏文件夹发布成免登只读公开页')
    expect(src).toContain('随收藏实时更新、随时可下线')
    expect(src).toContain('<PublicNavPreviewCard')
    expect(src).toContain('登录并发布我的首个公开导航页')
  })

  it('CTA 指向登录页，登录后回 /favorites（不是点了才告诉不行的假按钮）', () => {
    const src = source()
    expect(src).toContain('href="/auth/signin?callbackUrl=/favorites"')
  })

  it('旧的两行冷冰冰限制提示不再是主要文案', () => {
    const src = source()
    expect(src).not.toContain('需登录并同步到云端收藏后才能发布')
  })

  it('组件文件与页面接线真实存在（防 import 悬空）', () => {
    expect(existsSync(join(ROOT, 'src/components/public-nav-preview-card.tsx'))).toBe(true)
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('PublicPageManager')
  })
})
