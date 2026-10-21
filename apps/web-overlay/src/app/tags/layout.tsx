/**
 * 标签云段的透传 layout——**刻意不定义 metadata**。
 *
 * 为什么把标题搬去 page.tsx（2026-10-21 实测 Next 16 语义）：
 * 根 layout 的 `title.template`（'%s - 站点名'）会向孙级传递，
 * 但**中间层一旦定义字符串 title，传递即被截断**——本文件曾经的
 * `title: '标签总览'` 让全部 369 个 `/tags/[slug]` 页的 <title>
 * 拿不到品牌后缀（实测「合集详情」「插件详情与安装」同病，
 * 它们的父层 /collections、/marketplace 也定义了 title；
 * 而 /site/[id] 父层无 title，后缀正常）。
 *
 * 修正：标题移到 `page.tsx` 的 metadata export（Batch B 起 page 就是
 * 服务端组件，旧注释「客户端组件无法导出 metadata」已不成立），
 * 本层不留任何 title 定义，模板从而贯通到 [slug] 页。
 */
export default function TagsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
