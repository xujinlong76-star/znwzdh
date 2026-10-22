import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { safeDecodeParam } from '@/lib/server/route-params'
import { AUTHOR_KEY_RE, loadPluginAuthor } from '@/lib/server/plugin-author'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { siteOrigin } from '@/lib/seo/origin'
import { profilePageLd } from '@/lib/seo/json-ld'
import { JsonLd } from '@/components/json-ld'
import AuthorPluginsView from './author-plugins-view'

/**
 * 公开作者页的服务端入口。
 *
 * 旧实现是纯客户端页：未知 key 也返回 200 + 空态，且所有作者共享一个静态
 * title。这里先校验 key 格式，再用三态 probe 区分「确认不存在」与「中枢抖动」；
 * 只有前者 notFound()，后者保留降级渲染。
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>
}): Promise<Metadata> {
  const { key } = await params
  const safeKey = safeDecodeParam(key)
  if (!safeKey || !AUTHOR_KEY_RE.test(safeKey)) notFound()

  const probe = await loadPluginAuthor(safeKey)
  if (probe.status === 'miss') notFound()

  const canonical = `/marketplace/author/${encodeURIComponent(safeKey)}`
  if (probe.status === 'failed') {
    return {
      title: '作者主页与插件作品',
      description: '查看作者在插件市场公开发布的全部插件与主页资料',
      alternates: { canonical },
      ...(await pageShareMetadata({
        url: canonical,
        title: '作者主页与插件作品',
        description: '查看作者在插件市场公开发布的全部插件与主页资料',
      })),
    }
  }

  const data = probe.data
  const title = `「${data.author}」的插件主页`
  const description = `${data.author} 在插件市场发布 ${data.stats.plugins} 个插件，累计 ${data.stats.installs} 次安装。查看全部作品与更新记录。`
  return {
    title,
    description,
    alternates: { canonical },
    // og/twitter 走工厂：补齐根层默认的 siteName/locale/images/type
    ...(await pageShareMetadata({ url: canonical, title, description })),
  }
}

export default async function PluginAuthorPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = await params
  const safeKey = safeDecodeParam(key)
  if (!safeKey || !AUTHOR_KEY_RE.test(safeKey)) notFound()

  const probe = await loadPluginAuthor(safeKey)
  if (probe.status === 'miss') notFound()

  const origin = await siteOrigin()
  const canonical = `/marketplace/author/${encodeURIComponent(safeKey)}`
  const ld =
    probe.status === 'ok' && origin
      ? profilePageLd(origin, {
          name: probe.data.author,
          path: canonical,
          description: `插件作者公开主页：已上架 ${probe.data.stats.plugins} 个插件。`,
        })
      : null

  return (
    <>
      {ld ? <JsonLd data={ld} /> : null}
      <AuthorPluginsView
        ownerKey={safeKey}
        initialData={probe.status === 'ok' ? probe.data : null}
      />
    </>
  )
}
