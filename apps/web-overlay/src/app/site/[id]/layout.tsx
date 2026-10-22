/**
 * 纯布局层：标题/描述已由 page.tsx 的 generateMetadata 逐站产出。
 *
 * 这里刻意不再保留静态 metadata——页面级 metadata 会覆盖 layout 的同名字段，
 * 留着只会让后来者误以为标题来源在这；错误边界页的品牌后缀由根 layout 兜底。
 */
export default function SiteDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
