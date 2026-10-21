import type { Metadata } from 'next'
import { getFileContent } from '@/lib/github'

/**
 * 合集段的标题层：`page.tsx` 是客户端组件（'use client'），无法导出
 * metadata，因此由这一层 server layout 提供。
 *
 * title 为什么是 `{ default, template }` 而不是裸字符串（2026-10-21 实测）：
 * 根 layout 的 `title.template` 向孙级传递时会被中间层的字符串 title
 * 截断——曾经的 `title: '合集'` 让 `/collections/[slug]` 全部拿不到品牌
 * 后缀（实测「合集详情」光杆；/tags、/marketplace 同病，/site/[id] 因
 * 父层无 title 而正常）。改成「default 供本层、template 供子层」后：
 * - 本层渲染「合集 - 站点名」；
 * - `[slug]` 的 generateMetadata 返回的标题由**本层 template** 追加后缀
 *   （Next 的嵌套模板语义：最近一层的 template 生效，不叠床架屋）。
 *
 * template 里的站点名与根 layout 同源取数（site.json 的 basic.title），
 * 不硬编码品牌——根 layout 注释里记着硬编码 'NavSphere' 的历史教训。
 */
const SITE_PATH = 'src/navsphere/content/site.json'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getFileContent<{ basic?: { title?: string } }>(SITE_PATH)
  const siteName = site?.basic?.title ?? 'NavHub'
  return {
    title: { default: '合集', template: '%s - ' + siteName },
    description: '按主题整理的站点合集',
  }
}

export default function CollectionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
