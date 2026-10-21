import { jsonLdScript } from '@/lib/seo/json-ld'

/**
 * JSON-LD 挂载点（服务端组件）。
 *
 * 数据一律先过 `jsonLdScript()`：站点标题等字段来自数据库、管理员可改，
 * 裸 JSON.stringify 拼 `</script>` 可以越狱脚本上下文（XSS）。
 *
 * 用法：
 *   const origin = await siteOrigin()
 *   {origin ? <JsonLd data={webSiteLd(origin, title)} /> : null}
 *
 * `origin` 为 null 时不渲染：拿不到 origin 就拼不出绝对 URL，
 * 而相对 URL 的 JSON-LD 是无效的，宁缺勿错。
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  )
}
